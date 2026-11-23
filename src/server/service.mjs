import { randomUUID } from 'node:crypto';
import { getPool, transaction } from './db.mjs';
import { cookies, createSession, getIdentity, hash, localMode, opaque, requireOrigin, secureTransport, sessionCookie, signSyncToken, verifySyncToken } from './auth.mjs';
import { sendVerificationEmail } from './email.mjs';
import {
  getCharacterReputation,
  notifyBankRequestStatus,
  notifyBankRequestSubmitted,
  notifyFavoritesRestocked,
  notifyHelpingHand,
  notifyManualContribution,
  notifyNewDonations,
  notifyNewsPublished,
  notifyReputationPromotion,
  notifyTitleAssigned,
} from './notifications.mjs';
import { applyBattleNetGuildProfessions, fetchBattleNetGuildProfessions, getBattleNetClientToken, safeLocalPath, syncBattleNetGuildProfessions } from './battlenet.mjs';
import { authorizeSnapshot, characterKey, InputError, mergeSnapshot, normalize, validateSnapshot, visibleBank } from './domain.mjs';
import { donationHonorPoints, helpingPointsForLevel, reputationStanding } from './reputation.mjs';
import { percentileQualityClass } from './rarity.mjs';
import { loadAccountCharacterProfessions, loadGuildState, saveGuildState } from './guildStore.mjs';
import { sanitizeNewsHtml, stripHtmlText } from './sanitizeHtml.mjs';
import { fetchForeverAhSnapshot, formatCopper, importBankTransactions, loadAhPriceMap, lookupMissingVendorPrices, prefetchVendorPrices, refreshGuildTransactionPrices, resolveGuildAhContext, saveFetchedCatalogItems } from './itemPrices.mjs';
const empty = () => ({account:null,guild:null,characters:[],roster:[],bank:[],bankTransactions:[],bankContributions:[],requests:[],professions:[],tokens:[],syncs:[],commendations:[],activityFeed:[],isGuildMaster:false,permissions:{approveBankRequests:false,assignTitles:false,manageGuildSync:false,manageAnnouncements:false},ranks:[],motd:null,guildInfo:null,news:[],macros:[],designatedBanks:[]});
const ALL_PERMISSIONS = {approveBankRequests:true,assignTitles:true,manageGuildSync:true,manageAnnouncements:true};
const NO_PERMISSIONS = {approveBankRequests:false,assignTitles:false,manageGuildSync:false,manageAnnouncements:false};
function resolveRanks(state) {
  const config = state?.rankConfig && typeof state.rankConfig === 'object' ? state.rankConfig : {};
  const indices = new Set([0, 1, 2, 3]);
  for (const key of Object.keys(config)) { const n = Number(key); if (Number.isSafeInteger(n) && n >= 0 && n <= 9) indices.add(n); }
  for (const member of state?.roster ?? []) { if (Number.isSafeInteger(member?.guildRankIndex) && member.guildRankIndex >= 0 && member.guildRankIndex <= 9) indices.add(member.guildRankIndex); }
  return [...indices].sort((a,b) => a - b).map(rankIndex => {
    const entry = config[String(rankIndex)];
    const defaultName = rankIndex === 0 ? 'Guild Master' : `Rank ${rankIndex}`;
    const name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : defaultName;
    const permissions = rankIndex === 0 ? {...ALL_PERMISSIONS} : {
      approveBankRequests: Boolean(entry?.permissions?.approveBankRequests),
      assignTitles: Boolean(entry?.permissions?.assignTitles),
      manageGuildSync: Boolean(entry?.permissions?.manageGuildSync),
      manageAnnouncements: Boolean(entry?.permissions?.manageAnnouncements)
    };
    return {rankIndex,name,permissions};
  });
}
function rankNameFor(state, rankIndex, fallback = null) {
  if (!Number.isSafeInteger(rankIndex)) return fallback;
  const configured = state?.rankConfig?.[String(rankIndex)]?.name;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return rankIndex === 0 ? 'Guild Master' : (fallback || `Rank ${rankIndex}`);
}
function resolveAccess(identity, characters, state, activeGuildId) {
  const selected = characters.find(c => c.isMain && c.verified) ?? null;
  if (!activeGuildId) return {isGuildMaster:false,permissions:{...NO_PERMISSIONS},selected};
  if (identity.testAccount) {
    const isGuildMaster = identity.role === 'owner' && (!selected || selected.guildRank === 'Guild Master');
    const permissions = identity.role === 'owner' ? {...ALL_PERMISSIONS} : {...NO_PERMISSIONS};
    return {isGuildMaster,permissions,selected};
  }
  const selectedGuildId = selected?.guildSlug ? `bnet:${selected.region || 'us'}:${selected.guildSlug}` : null;
  if (!selected || selectedGuildId !== activeGuildId) return {isGuildMaster:false,permissions:{...NO_PERMISSIONS},selected};
  if (activeGuildId.startsWith('bnet:')) {
    if (!state?.blizzardGuildId || !selected.guildId || Number(state.blizzardGuildId) !== Number(selected.guildId)) {
      return {isGuildMaster:false,permissions:{...NO_PERMISSIONS},selected};
    }
  }
  const isGuildMaster = selected.guildRankIndex === 0;
  if (isGuildMaster) return {isGuildMaster:true,permissions:{...ALL_PERMISSIONS},selected};
  if (Number.isSafeInteger(selected.guildRankIndex)) {
    const entry = state?.rankConfig?.[String(selected.guildRankIndex)]?.permissions;
    return {
      isGuildMaster:false,
      permissions:{
        approveBankRequests: Boolean(entry?.approveBankRequests),
        assignTitles: Boolean(entry?.assignTitles),
        manageGuildSync: Boolean(entry?.manageGuildSync),
        manageAnnouncements: Boolean(entry?.manageAnnouncements)
      },
      selected
    };
  }
  return {isGuildMaster:false,permissions:{...NO_PERMISSIONS},selected};
}
function guildSummary(guild) {
  const updatedMs = guild.logo_updated_at instanceof Date ? guild.logo_updated_at.getTime() : (guild.logo_updated_at ? Date.parse(guild.logo_updated_at) : null);
  return {
    id: guild.id,
    name: guild.display_name || guild.name,
    rawName: guild.name,
    displayName: guild.display_name || '',
    logoName: guild.logo_name || '',
    hasCustomLogo: Boolean(guild.logo_mime && updatedMs),
    logoUrl: guild.logo_mime && updatedMs ? `/api/guild-logo/${encodeURIComponent(guild.id)}?v=${updatedMs}` : null
  };
}
async function resolveActiveGuildId(db, identity, accountCharactersRaw) {
  if (identity.testAccount) return identity.guildId ?? null;
  const selected = accountCharactersRaw.find(c => c.isMain && c.verified) ?? null;
  if (!selected?.guildSlug) return null;
  const candidate = `bnet:${selected.region || 'us'}:${selected.guildSlug}`;
  const membership = (await db.query(
    `SELECT m.guild_id, m.role, g.blizzard_guild_id
     FROM memberships m
     JOIN guilds g ON g.id = m.guild_id
     WHERE m.account_id=$1 AND m.guild_id=$2 AND m.active=true`,
    [identity.id, candidate]
  )).rows[0];
  if (!membership) return null;
  if (candidate.startsWith('bnet:')) {
    if (membership.blizzard_guild_id === null || membership.blizzard_guild_id === undefined) return null;
    if (!selected.guildId || Number(membership.blizzard_guild_id) !== Number(selected.guildId)) return null;
  }
  identity.role = membership.role;
  return membership.guild_id;
}
function matchesPortalGuild(c, activeGuildSlug, guildRegion, blizzardGuildId) {
  if (!activeGuildSlug) return true;
  if (c.guildSlug !== activeGuildSlug) return false;
  if (c.region && c.region !== guildRegion) return false;
  if (blizzardGuildId !== null && blizzardGuildId !== undefined) {
    if (c.guildId === null || c.guildId === undefined || Number(c.guildId) !== Number(blizzardGuildId)) return false;
  }
  return true;
}
export function battleNetConfigured() { return Boolean(process.env.BNET_CLIENT_ID && process.env.BNET_CLIENT_SECRET && process.env.BNET_REDIRECT_URI); }
function guildSlugFromRow(guild) {
  if (!guild) return '';
  if (typeof guild.id === 'string' && guild.id.startsWith('bnet:')) {
    const slug = guild.id.split(':').slice(2).join(':');
    if (slug) return slug;
  }
  return String(guild.name || guild.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
async function findGuildBySlugOrId(db, slugOrId) {
  const key = typeof slugOrId === 'string' ? slugOrId.trim().toLowerCase() : '';
  if (!key || key.length > 160) return null;
  const rows = (await db.query(
    `SELECT id, name, realm, region, display_name, logo_name, logo_mime, logo_updated_at FROM guilds`
  )).rows;
  return rows.find(g => g.id.toLowerCase() === key || guildSlugFromRow(g).toLowerCase() === key) ?? null;
}
export async function getGuildNewsItem(guildId, newsId) {
  if (!guildId || !newsId) return null;
  const row = (await getPool().query(
    `SELECT id, title, body, published_at AS "publishedAt", author_name AS "authorName"
     FROM guild_news WHERE guild_id=$1 AND id=$2`,
    [guildId, newsId]
  )).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    html: sanitizeNewsHtml(row.body),
    publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : row.publishedAt,
    authorName: row.authorName,
  };
}
export async function getGuildFeedbackData(request, slugOrId) {
  const guildRow = await findGuildBySlugOrId(getPool(), slugOrId);
  if (!guildRow) {
    return { guild: null, account: null, ownCharacters: [], members: [], battleNetConfigured: battleNetConfigured(), localTestLogin: localMode(request) };
  }
  const guild = { ...guildSummary(guildRow), slug: guildSlugFromRow(guildRow) };
  const identity = await getIdentity(request);
  if (!identity) {
    return { guild, account: null, ownCharacters: [], members: [], battleNetConfigured: battleNetConfigured(), localTestLogin: localMode(request) };
  }
  const ownCharsRows = (await getPool().query(
    `SELECT id, name, realm, level, class_name AS "className", is_main AS "isMain", verified FROM account_characters WHERE account_id=$1 AND verified=true ORDER BY is_main DESC, level DESC NULLS LAST, name ASC`,
    [identity.id]
  )).rows;
  const ownIds = new Set(ownCharsRows.map(c => c.id));
  const ownNames = new Set(ownCharsRows.map(c => normalize(c.name)));
  const rosterRows = (await getPool().query(
    `SELECT id, name FROM guild_roster_members WHERE guild_id=$1
     UNION
     SELECT id, name FROM guild_characters WHERE guild_id=$1 AND active=true`,
    [guildRow.id]
  )).rows;
  const byNorm = new Map();
  for (const r of rosterRows) {
    const n = normalize(r.name);
    if (!n || ownIds.has(r.id) || ownNames.has(n)) continue;
    if (!byNorm.has(n)) byNorm.set(n, { id: r.id, name: r.name, rank: '', level: null });
  }
  const members = [...byNorm.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    guild,
    account: { id: identity.id, battleTag: identity.battleTag, testAccount: identity.testAccount },
    ownCharacters: ownCharsRows,
    members,
    battleNetConfigured: battleNetConfigured(),
    localTestLogin: localMode(request)
  };
}
export async function getPortalData(request) {
  const output = {...empty(),localTestLogin:localMode(request),battleNetConfigured:battleNetConfigured()};
  const identity = await getIdentity(request);
  if (!identity) return output;
  const safeCharacter = (c, state = null, activeGuildSlug = null) => {
    const inActiveGuild = activeGuildSlug ? c.guildSlug === activeGuildSlug : true;
    return {id:c.id,name:c.name,realm:c.realm,region:c.region ?? 'us',ruleset:c.ruleset ?? null,level:c.level ?? null,className:c.className ?? null,raceName:c.raceName ?? null,faction:c.faction ?? null,guildName:c.guildName ?? null,guildSlug:c.guildSlug ?? null,guildId:c.guildId ?? null,guildRank:(state && inActiveGuild) ? rankNameFor(state,c.guildRankIndex,c.guildRank ?? null) : (c.guildRank ?? null),guildRankIndex:c.guildRankIndex ?? null,equippedItemLevel:c.equippedItemLevel ?? null,averageItemLevel:c.averageItemLevel ?? null,lastLoginAt:c.lastLoginAt instanceof Date ? c.lastLoginAt.toISOString() : (c.lastLoginAt ?? null),professions:Array.isArray(c.professions) ? c.professions : [],isMain:Boolean(c.isMain),verified:Boolean(c.verified),titles:c.titles ?? [],updatedAt:c.updatedAt instanceof Date ? c.updatedAt.toISOString() : (c.updatedAt ?? null)};
  };
  const accountCharactersRows = (await getPool().query(`SELECT id,name,realm,region,ruleset,level,class_name AS "className",race_name AS "raceName",faction,guild_name AS "guildName",guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",equipped_item_level AS "equippedItemLevel",average_item_level AS "averageItemLevel",last_login_at AS "lastLoginAt",is_main AS "isMain",verified,updated_at AS "updatedAt" FROM account_characters WHERE account_id=$1 ORDER BY level DESC NULLS LAST,name ASC`,[identity.id])).rows;
  const acctProfMap = await loadAccountCharacterProfessions(getPool(), accountCharactersRows.map(c => c.id));
  const accountCharactersRaw = accountCharactersRows.map(c => ({ ...c, professions: acctProfMap.get(c.id) ?? [] }));
  const activeGuildId = await resolveActiveGuildId(getPool(), identity, accountCharactersRaw);
  const notifRows = (await getPool().query(
    `SELECT id, title, body, link, read_at AS "readAt", created_at AS "createdAt" FROM account_notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [identity.id]
  )).rows.map(n => ({
    ...n,
    readAt: n.readAt instanceof Date ? n.readAt.toISOString() : (n.readAt ?? null),
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
  }));
  const unreadNotificationCount = (await getPool().query(
    `SELECT count(*)::int AS count FROM account_notifications WHERE account_id=$1 AND read_at IS NULL`,
    [identity.id]
  )).rows[0]?.count ?? 0;
  output.account = {id:identity.id,battleTag:identity.battleTag,role:activeGuildId ? (identity.role ?? null) : null,testAccount:identity.testAccount,charactersSyncedAt:identity.charactersSyncedAt instanceof Date ? identity.charactersSyncedAt.toISOString() : (identity.charactersSyncedAt ?? null),charactersSyncError:identity.charactersSyncError ?? null,email:identity.email ?? null,emailVerified:Boolean(identity.emailVerified),emailOptedOut:Boolean(identity.emailOptedOut),notifications:notifRows,unreadNotificationCount};
  if (!activeGuildId) { output.characters = accountCharactersRaw.map(c => safeCharacter(c)); return output; }
  const result = await getPool().query('SELECT id,name,realm,region,display_name,logo_name,logo_mime,logo_updated_at,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1',[activeGuildId]);
  const guild = result.rows[0]; if (!guild) { output.characters = accountCharactersRaw.map(c => safeCharacter(c)); return output; }
  const state = await loadGuildState(getPool(), activeGuildId, guild);
  const activeGuildSlug = activeGuildId.startsWith('bnet:') ? activeGuildId.split(':').slice(2).join(':') : null;
  output.guild = guildSummary(guild);
  const accountCharacters = accountCharactersRaw.map(c => {
    const guildChar = state.characters.find(gc => gc.id === c.id || (gc.accountId === identity.id && characterKey(gc) === characterKey(c)));
    return safeCharacter(guildChar ? { ...c, titles: guildChar.titles ?? [] } : c, state, activeGuildSlug);
  });
  const guildCharacters = state.characters.filter(c => c.accountId === identity.id && c.active !== false).map(c => safeCharacter(c, state, activeGuildSlug));
  output.characters = identity.testAccount ? guildCharacters : (accountCharacters.length ? accountCharacters : guildCharacters);
  const membershipPrimaryRows = (await getPool().query(
    `SELECT account_id AS "accountId", primary_character_id AS "primaryCharacterId" FROM memberships WHERE guild_id=$1 AND active=true`,
    [guild.id]
  )).rows;
  const primaryByAccountId = new Map(membershipPrimaryRows.filter(r => r.primaryCharacterId).map(r => [r.accountId, r.primaryCharacterId]));
  const ownGuildChars = output.characters.filter(c => activeGuildSlug ? c.guildSlug === activeGuildSlug : true);
  const ownStoredPrimary = primaryByAccountId.get(identity.id) ?? null;
  const ownPrimaryValid = ownStoredPrimary && ownGuildChars.some(c => c.id === ownStoredPrimary) ? ownStoredPrimary : null;
  const needsPrimaryChoice = Boolean(!identity.testAccount && ownGuildChars.length > 0 && !ownPrimaryValid);
  output.account = {
    ...output.account,
    primaryCharacterId: ownPrimaryValid,
    needsPrimaryChoice,
    needsEmailPrompt: Boolean(!identity.testAccount && !needsPrimaryChoice && !identity.emailPromptedAt && !identity.emailVerified && !identity.emailOptedOut),
    guildCharacters: ownGuildChars.map(c => ({ id: c.id, name: c.name, level: c.level, className: c.className, guildRank: c.guildRank }))
  };
  const guildAcctCharsRows = activeGuildSlug
    ? (await getPool().query(
        `SELECT id, account_id AS "accountId", name, level, class_name AS "className", guild_rank AS "guildRank", guild_rank_index AS "guildRankIndex" FROM account_characters WHERE guild_slug=$1 AND region=$2 AND verified=true`,
        [activeGuildSlug, guild.region]
      )).rows
    : [];
  const accountIdByCharId = new Map();
  const accountIdByCharNorm = new Map();
  for (const gc of state.characters) {
    if (gc.accountId && gc.active !== false) {
      accountIdByCharId.set(gc.id, gc.accountId);
      accountIdByCharNorm.set(normalize(gc.name), gc.accountId);
    }
  }
  for (const ac of guildAcctCharsRows) {
    if (ac.accountId) {
      accountIdByCharId.set(ac.id, ac.accountId);
      accountIdByCharNorm.set(normalize(ac.name), ac.accountId);
    }
  }
  const access = resolveAccess(identity, output.characters, state, activeGuildId);
  output.isGuildMaster = access.isGuildMaster;
  output.permissions = access.permissions;
  const pendingBankRequestCount = access.permissions.approveBankRequests
    ? state.requests.filter(r => r.status === 'pending' || r.status === 'approved').length
    : 0;
  output.pendingBankRequestCount = pendingBankRequestCount;
  output.guild = { ...output.guild, pendingBankRequestCount };
  output.ranks = resolveRanks(state);
  output.motd = state.motd ?? null;
  output.guildInfo = state.guildInfo ?? null;
  output.news = (Array.isArray(state.news) ? state.news : []).map(item => ({
    ...item,
    html: sanitizeNewsHtml(item.body)
  }));
  output.macros = (await getPool().query(
    `SELECT id, title, body, created_at AS "createdAt" FROM guild_macros WHERE guild_id=$1 ORDER BY sort_order ASC, created_at ASC LIMIT 50`,
    [guild.id]
  )).rows.map(m => ({ ...m, createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt }));
  output.designatedBanks = Array.isArray(state.designatedBanks) ? state.designatedBanks : [];
  const rawCommendations = (await getPool().query(
    `SELECT id, character_id AS "characterId", character_name AS "characterName", author_account_id AS "authorAccountId", author_character_id AS "authorCharacterId", author_name AS "authorName", message, created_at AS "createdAt" FROM guild_commendations WHERE guild_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
    [guild.id]
  )).rows;
  const recipientRows = rawCommendations.length
    ? (await getPool().query(
        `SELECT commendation_id AS "commendationId", character_id AS "characterId", character_name AS "characterName" FROM guild_commendation_recipients WHERE guild_id=$1 AND commendation_id = ANY($2::text[]) ORDER BY character_name ASC`,
        [guild.id, rawCommendations.map(c => c.id)]
      )).rows
    : [];
  const recipientsByComm = new Map();
  for (const r of recipientRows) {
    const list = recipientsByComm.get(r.commendationId) ?? [];
    list.push({ characterId: r.characterId, characterName: r.characterName });
    recipientsByComm.set(r.commendationId, list);
  }
  output.commendations = rawCommendations.map(({ authorAccountId, createdAt, ...entry }) => {
    const recipients = recipientsByComm.get(entry.id) ?? (entry.characterId ? [{ characterId: entry.characterId, characterName: entry.characterName }] : []);
    return {
      ...entry,
      recipients,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
      canDelete: authorAccountId === identity.id || access.isGuildMaster || access.permissions.manageAnnouncements
    };
  });
  const repRows = (await getPool().query(
    `SELECT r.character_id AS "characterId",
            lower(btrim(r.character_name)) AS "normName",
            count(*)::int AS count,
            COALESCE(sum(r.points_awarded), 0)::int AS points
     FROM guild_commendation_recipients r
     JOIN guild_commendations c ON c.guild_id = r.guild_id AND c.id = r.commendation_id
     WHERE r.guild_id=$1 AND c.deleted_at IS NULL
     GROUP BY r.character_id, lower(btrim(r.character_name))`,
    [guild.id]
  )).rows;
  const donationAggRows = (await getPool().query(
    `SELECT lower(btrim(actor_name)) AS "normName", count(*)::int AS count, COALESCE(sum(total_vendor_copper), 0)::numeric::text AS copper FROM guild_bank_transactions WHERE guild_id=$1 AND is_donation=true AND actor_name IS NOT NULL GROUP BY lower(btrim(actor_name))`,
    [guild.id]
  )).rows;
  const donationByNorm = new Map(donationAggRows.map(r => [r.normName, { count: r.count, copperBig: BigInt(r.copper || '0') }]));
  const canManageContributions = access.isGuildMaster || access.permissions.approveBankRequests || access.permissions.manageGuildSync;
  const withdrawAggRows = canManageContributions
    ? (await getPool().query(
        `SELECT lower(btrim(actor_name)) AS "normName", count(*)::int AS count, COALESCE(sum(total_vendor_copper), 0)::numeric::text AS copper FROM guild_bank_transactions WHERE guild_id=$1 AND tx_type IN ('withdraw', 'money-withdraw') AND actor_name IS NOT NULL GROUP BY lower(btrim(actor_name))`,
        [guild.id]
      )).rows
    : [];
  const withdrawByNorm = new Map(withdrawAggRows.map(r => [r.normName, { count: r.count, copperBig: BigInt(r.copper || '0') }]));
  const formatSignedCopper = value => {
    const big = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value) || 0));
    return `${big < 0n ? '-' : ''}${formatCopper(big < 0n ? -big : big)}`;
  };
  const clampSafeInt = big => big > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : (big < BigInt(Number.MIN_SAFE_INTEGER) ? Number.MIN_SAFE_INTEGER : Number(big));
  const contribRows = (await getPool().query(
    `SELECT id, character_id AS "characterId", character_name AS "characterName", copper, reason, awarded_by_name AS "awardedByName", created_at AS "createdAt" FROM guild_bank_contributions WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 500`,
    [guild.id]
  )).rows;
  const contribAggRows = (await getPool().query(
    `SELECT character_id AS "characterId", lower(btrim(character_name)) AS "normName", count(*)::int AS count, COALESCE(sum(copper), 0)::numeric::text AS copper FROM guild_bank_contributions WHERE guild_id=$1 GROUP BY character_id, lower(btrim(character_name))`,
    [guild.id]
  )).rows;
  output.bankContributions = contribRows.map(r => ({
    ...r,
    copper: Number(r.copper),
    formatted: formatSignedCopper(BigInt(r.copper)),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    canDelete: canManageContributions
  }));
  const manualContribStats = (charId, normName) => {
    let count = 0;
    let copperBig = 0n;
    let matchedById = false;
    for (const row of contribAggRows) {
      if (charId && row.characterId === charId) {
        count += row.count;
        copperBig += BigInt(row.copper || '0');
        matchedById = true;
      }
    }
    if (!matchedById && normName) {
      for (const row of contribAggRows) {
        if (!row.characterId && row.normName === normName) {
          count += row.count;
          copperBig += BigInt(row.copper || '0');
        }
      }
    }
    return { count, copperBig };
  };
  const commendationStats = (charId, charName) => {
    const normName = normalize(charName);
    let count = 0;
    let points = 0;
    for (const row of repRows) {
      if (row.characterId === charId || (normName && row.normName === normName)) {
        count += row.count;
        points += Number(row.points ?? 0);
      }
    }
    return { count, points };
  };
  const baseRoster = state.roster.map(c => {
    const charMatch = state.characters.find(ch => ch.id === c.id)
      ?? state.characters.find(ch => ch.active !== false && characterKey(ch) === characterKey(c))
      ?? state.characters.find(ch => ch.active !== false && normalize(ch.name) === normalize(c.name));
    const resolvedId = charMatch?.id ?? c.id;
    const norm = normalize(c.name);
    const donationStats = donationByNorm.get(norm) ?? { count: 0, copperBig: 0n };
    const manualStats = manualContribStats(resolvedId, norm);
    const rawTotalBig = donationStats.copperBig + manualStats.copperBig;
    const totalContributionBig = rawTotalBig > 0n ? rawTotalBig : 0n;
    const totalContributionCopper = clampSafeInt(totalContributionBig);
    const withdrawStats = canManageContributions ? (withdrawByNorm.get(norm) ?? { count: 0, copperBig: 0n }) : null;
    const netBig = withdrawStats ? totalContributionBig - withdrawStats.copperBig : null;
    const safeChar = safeCharacter(c, state);
    const { count: commendationCount, points: helpingPoints } = commendationStats(resolvedId, c.name);
    const donationPoints = donationHonorPoints(totalContributionBig);
    const reputation = reputationStanding(helpingPoints + donationPoints);
    return {
      ...safeChar,
      id: resolvedId,
      verified: Boolean(charMatch?.verified || c.verified),
      className: c.className ?? charMatch?.className ?? null,
      online: Boolean(c.online ?? charMatch?.online),
      zone: c.zone ?? charMatch?.zone ?? null,
      titles: charMatch?.titles ?? [],
      commendationCount,
      helpingPoints,
      donationPoints,
      reputationCount: reputation.count,
      reputation,
      donationCount: donationStats.count + manualStats.count,
      donatedCopper: totalContributionCopper,
      donatedFormatted: formatCopper(totalContributionBig),
      manualContributionCopper: clampSafeInt(manualStats.copperBig),
      ...(withdrawStats ? {
        withdrawnCount: withdrawStats.count,
        withdrawnCopper: clampSafeInt(withdrawStats.copperBig),
        withdrawnFormatted: formatCopper(withdrawStats.copperBig),
        netContributionCopper: clampSafeInt(netBig),
        netContributionFormatted: formatSignedCopper(netBig)
      } : {}),
      professions: (charMatch?.professions ?? []).map(p => ({ id: p.id, name: p.name, rank: p.rank, maxRank: p.maxRank, recipeCount: (p.recipes ?? []).length }))
    };
  });
  const positiveDonations = baseRoster.map(m => m.donatedCopper).filter(v => v > 0);
  const positiveReps = baseRoster.map(m => m.reputationCount).filter(v => v > 0);
  const rosterWithAccount = baseRoster.map(m => {
    const ownerAccountId = accountIdByCharId.get(m.id) ?? accountIdByCharNorm.get(normalize(m.name)) ?? null;
    return {
      ...m,
      _ownerAccountId: ownerAccountId,
      donatedQualityClass: percentileQualityClass(m.donatedCopper, positiveDonations),
      reputationQualityClass: percentileQualityClass(m.reputationCount, positiveReps),
    };
  });
  const membersByAccount = new Map();
  for (const m of rosterWithAccount) {
    if (!m._ownerAccountId) continue;
    const list = membersByAccount.get(m._ownerAccountId) ?? [];
    list.push(m);
    membersByAccount.set(m._ownerAccountId, list);
  }
  output.roster = rosterWithAccount.map(({ _ownerAccountId, ...m }) => {
    const primaryId = _ownerAccountId ? (primaryByAccountId.get(_ownerAccountId) ?? null) : null;
    const peers = _ownerAccountId ? (membersByAccount.get(_ownerAccountId) ?? []) : [];
    const primaryPeer = primaryId ? (peers.find(p => p.id === primaryId) ?? null) : null;
    const isGuildPrimary = Boolean(primaryPeer && primaryPeer.id === m.id);
    const alts = isGuildPrimary
      ? peers
          .filter(p => p.id !== m.id)
          .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name))
          .map(p => ({ id: p.id, name: p.name, level: p.level, className: p.className, guildRank: p.guildRank, guildRankIndex: p.guildRankIndex }))
      : [];
    const primaryCharacter = !isGuildPrimary && primaryPeer
      ? { id: primaryPeer.id, name: primaryPeer.name, level: primaryPeer.level, className: primaryPeer.className }
      : null;
    return { ...m, isGuildPrimary, alts, primaryCharacter };
  });
  const rosterIdByNorm = new Map(output.roster.map(m => [normalize(m.name), m.id]));
  const txRows = (await getPool().query(
    `SELECT id, tx_type AS "txType", bank_name AS "bankName", actor_name AS "actorName", item_id AS "itemId", suffix_id AS "suffixId", item_name AS "itemName", quantity, money_copper AS "moneyCopper", unit_vendor_copper AS "unitVendorCopper", total_vendor_copper::text AS "totalVendorCopper", is_donation AS "isDonation", note, occurred_at AS "occurredAt"
     FROM guild_bank_transactions
     WHERE guild_id=$1
       AND ($2::boolean OR tx_type NOT IN ('requested','cancelled','reopened'))
     ORDER BY occurred_at DESC, id ASC
     LIMIT 300`,
    [guild.id, Boolean(access.permissions.approveBankRequests)]
  )).rows;
  output.bankTransactions = txRows.map(t => ({
    ...t,
    note: (access.permissions.approveBankRequests || t.isDonation) ? t.note : null,
    totalVendorCopper: Number(t.totalVendorCopper ?? 0),
    vendorFormatted: formatCopper(t.totalVendorCopper ?? '0'),
    moneyFormatted: formatCopper(t.moneyCopper ?? 0),
    actorCharacterId: t.actorName ? (rosterIdByNorm.get(normalize(t.actorName)) ?? null) : null,
    occurredAt: t.occurredAt instanceof Date ? t.occurredAt.toISOString() : t.occurredAt
  }));
  output.activityFeed = [
    ...output.commendations.map(c => ({ kind: 'commendation', ...c })),
    ...output.bankTransactions
      .filter(t => t.isDonation)
      .map(t => ({ kind: 'donation', createdAt: t.occurredAt, ...t })),
    ...output.bankTransactions
      .filter(t => !t.isDonation && t.txType !== 'mailed' && Boolean(t.actorName))
      .map(t => ({ kind: 'bank', createdAt: t.occurredAt, ...t })),
    ...output.bankContributions.filter(c => c.copper > 0).map(c => ({
      kind: 'donation',
      id: `contrib:${c.id}`,
      txType: 'money-deposit',
      bankName: 'Guild Bank',
      actorName: c.characterName,
      actorCharacterId: c.characterId,
      itemName: c.reason,
      quantity: 1,
      moneyCopper: c.copper,
      moneyFormatted: `${c.formatted} (${c.reason})`,
      totalVendorCopper: c.copper,
      vendorFormatted: c.formatted,
      isDonation: true,
      createdAt: c.createdAt
    })),
    ...state.requests.filter(r => access.permissions.approveBankRequests || r.accountId === identity.id).map(r => ({
      kind: 'bank',
      id: `req:${r.id}`,
      txType: `request-${r.status}`,
      bankName: 'Guild Bank',
      actorName: r.characterName,
      actorCharacterId: rosterIdByNorm.get(normalize(r.characterName)) ?? null,
      itemName: r.itemName,
      quantity: r.quantity,
      moneyCopper: 0,
      moneyFormatted: '0c',
      totalVendorCopper: 0,
      vendorFormatted: '0c',
      isDonation: false,
      note: r.note || null,
      createdAt: r.createdAt
    }))
  ].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  const rawBank = visibleBank(state,identity.id);
  const bankItemIds = [...new Set(rawBank.map(i => i.itemId).filter(id => Number.isSafeInteger(id) && id > 0))];
  const catalogRows = bankItemIds.length
    ? (await getPool().query(
        `SELECT item_id AS "itemId", quality, item_class AS "itemClass", item_subclass AS "itemSubclass", inventory_type AS "inventoryType", item_level AS "itemLevel", required_level AS "requiredLevel", sell_price_copper AS "sellPriceCopper" FROM item_catalog WHERE item_id = ANY($1::int[])`,
        [bankItemIds]
      )).rows
    : [];
  const catalogById = new Map(catalogRows.map(r => [r.itemId, r]));
  const ahContext = await resolveGuildAhContext(getPool(), guild);
  const ahPriceMap = bankItemIds.length ? await loadAhPriceMap(getPool(), bankItemIds, ahContext) : new Map();
  const qualityNames = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'];
  output.bank = rawBank.map(item => {
    const meta = catalogById.get(item.itemId);
    const ahCopper = ahPriceMap.get(item.itemId) ?? null;
    const qualityName = meta?.quality ?? (Number.isSafeInteger(item.quality) ? qualityNames[item.quality] ?? null : null);
    return {
      ...item,
      qualityName,
      itemClass: meta?.itemClass ?? null,
      itemSubclass: meta?.itemSubclass ?? null,
      inventoryType: meta?.inventoryType && meta.inventoryType !== 'Non-equippable' ? meta.inventoryType : null,
      itemLevel: meta?.itemLevel ?? null,
      requiredLevel: meta?.requiredLevel ?? null,
      ahPriceCopper: ahCopper,
      ahPriceFormatted: ahCopper ? formatCopper(ahCopper) : null,
      vendorPriceCopper: meta?.sellPriceCopper ?? null,
      vendorPriceFormatted: meta?.sellPriceCopper ? formatCopper(meta.sellPriceCopper) : null
    };
  });
  output.requests = state.requests.filter(r => access.permissions.approveBankRequests || r.accountId === identity.id).map(({accountId,...r})=>r);
  output.professions = state.characters.filter(c => c.active !== false).flatMap(char => (char.professions ?? []).map(prof => ({characterId:char.id,characterName:char.name,name:prof.name,rank:prof.rank,maxRank:prof.maxRank,online:Boolean(char.online),zone:char.zone ?? null,titles:char.titles ?? [],updatedAt:prof.updatedAt ?? null,recipes:(prof.recipes ?? []).map(recipe => ({...recipe,recipeKey:`${char.id}:${prof.id}:${recipe.id}`,canEdit:char.accountId === identity.id}))})));
  output.tokens = (await getPool().query(`SELECT id,scope,created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",last_used_at AS "lastUsedAt" FROM sync_tokens WHERE account_id=$1 AND guild_id=$2 ORDER BY created_at DESC LIMIT 100`,[identity.id,guild.id])).rows.map(r => Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?v.toISOString():v])));
  output.syncs = state.syncs.filter(s => access.permissions.manageGuildSync || s.accountId === identity.id).map(({accountId,...s})=>s);
  return output;
}
export async function readJson(request, limit) {
  const reader = request.body?.getReader(); if (!reader) throw new InputError('Provide a JSON request.');
  const chunks = []; let total = 0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    total += value.byteLength; if (total > limit) { await reader.cancel(); throw new InputError('The upload exceeds the size limit.',413); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('The request contains invalid JSON.'); }
}
function need(condition,message,status=403) { if (!condition) throw new InputError(message,status); }
async function computeCommendationAwards(db, guildId, authorAccountId, authorLevel, resolvedTargets) {
  const bnetParts = typeof guildId === 'string' && guildId.startsWith('bnet:') ? guildId.split(':') : null;
  const guildRegion = bnetParts ? (bnetParts[1] || null) : null;
  const guildSlug = bnetParts ? (bnetParts.slice(2).join(':') || null) : null;
  const basePoints = helpingPointsForLevel(authorLevel);
  const awards = new Map();
  const seenTargetAccounts = new Set();
  for (const target of resolvedTargets) {
    const norm = normalize(target.name);
    const acctRow = (await db.query(
      `SELECT account_id AS "accountId" FROM guild_characters WHERE guild_id=$1 AND account_id IS NOT NULL AND active=true AND (id=$2 OR lower(btrim(name))=$3) ORDER BY (id=$2) DESC, account_id ASC LIMIT 1`,
      [guildId, target.id, norm]
    )).rows[0] ?? (guildSlug ? (await db.query(
      `SELECT account_id AS "accountId" FROM account_characters WHERE guild_slug=$1 AND ($4::text IS NULL OR region=$4) AND verified=true AND (id=$2 OR lower(btrim(name))=$3) ORDER BY (id=$2) DESC, account_id ASC LIMIT 1`,
      [guildSlug, target.id, norm, guildRegion]
    )).rows[0] : null);
    const targetAccountId = acctRow?.accountId ?? null;
    if (targetAccountId) {
      need(!seenTargetAccounts.has(targetAccountId), `You can only thank ${target.name}'s account once per day.`, 429);
      seenTargetAccounts.add(targetAccountId);
    }
    const charIds = new Set([target.id]);
    const charNorms = new Set([norm]);
    if (targetAccountId) {
      const peerRows = (await db.query(
        `SELECT id, lower(btrim(name)) AS norm FROM guild_characters WHERE guild_id=$1 AND account_id=$2
         UNION
         SELECT id, lower(btrim(name)) AS norm FROM account_characters WHERE account_id=$2 AND verified=true AND ($3::text IS NULL OR guild_slug=$3) AND ($4::text IS NULL OR region=$4)`,
        [guildId, targetAccountId, guildSlug, guildRegion]
      )).rows;
      for (const p of peerRows) {
        if (p.id) charIds.add(p.id);
        if (p.norm) charNorms.add(p.norm);
      }
    }
    // Intentionally includes soft-deleted rows so deleting & re-posting cannot bypass 24h cooldown or diminishing returns.
    const hist = (await db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE c.created_at > now() - interval '24 hours')::int AS recent
       FROM guild_commendations c
       JOIN guild_commendation_recipients r ON r.guild_id = c.guild_id AND r.commendation_id = c.id
       WHERE c.guild_id = $1
         AND c.author_account_id = $2
         AND (r.character_id = ANY($3::text[]) OR lower(btrim(r.character_name)) = ANY($4::text[]))`,
      [guildId, authorAccountId, [...charIds], [...charNorms]]
    )).rows[0];
    need(Number(hist?.recent ?? 0) === 0, `You can only thank ${target.name} (or their alts) once per day.`, 429);
    const priorCount = Number(hist?.total ?? 0);
    const points = priorCount >= 30 ? 0 : Math.floor(basePoints / Math.pow(2, priorCount));
    awards.set(target.id, points);
  }
  return awards;
}
export async function handleAction(request, address) {
  requireOrigin(request);
  const body = await readJson(request,65536);
  need(body && typeof body === 'object' && typeof body.action === 'string','Choose an action.',400);
  if (body.action === 'local-login') {
    need(address !== undefined && localMode(request,address),'Local test login requires a loopback development connection.');
    need(['owner','member'].includes(body.persona),'Choose a test account.',400);
    return transaction(async db => {
      const accountId = `fixture-${body.persona}`;
      need((await db.query('SELECT 1 FROM accounts WHERE id=$1 AND test_account=true',[accountId])).rowCount,'Seed the local test accounts before signing in.',409);
      const old = cookies(request).hh_session;
      if (old) await db.query('DELETE FROM sessions WHERE id_hash=$1',[hash(old)]);
      const id = await createSession(db,accountId);
      return {ok:true,message:'Signed in to the local test account.',redirect:'/account',cookie:sessionCookie(id,request)};
    });
  }
  const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
  // Reserve email cooldown in its own short transaction BEFORE calling SMTP so failed/timed-out deliveries cannot bypass rate limits.
  if (body.action === 'set-notification-email') {
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    need(rawEmail.length >= 5 && rawEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail),'Enter a valid email address.',400);
    const { account, emailRev } = await transaction(async db => {
      const acct = await getIdentity(request, db);
      need(acct,'Sign in before using this action.',401);
      const acctEmailRow = (await db.query(
        `SELECT email, email_verify_sent_at AS "sentAt" FROM accounts WHERE id=$1 FOR NO KEY UPDATE`,
        [acct.id]
      )).rows[0];
      if (acctEmailRow?.sentAt) {
        const elapsedMs = Date.now() - new Date(acctEmailRow.sentAt).getTime();
        need(elapsedMs >= 60_000, 'Please wait a minute before sending another verification email.', 429);
      }
      const revRow = (await db.query(
        `UPDATE accounts SET email_verify_sent_at=now(), email_change_rev=email_change_rev + 1 WHERE id=$1 RETURNING email_change_rev`,
        [acct.id]
      )).rows[0];
      return { account: acct, emailRev: Number(revRow?.email_change_rev ?? 1) };
    });
    const token = opaque();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const verifyUrl = `${origin}/auth/verify-email?token=${encodeURIComponent(token)}`;
    const delivery = await sendVerificationEmail({ to: rawEmail, verifyUrl, battleTag: account.battleTag, request });
    const smtpConfigured = Boolean(process.env.SMTP_HOST?.trim()) || process.env.NODE_ENV === 'production';
    if (smtpConfigured && !delivery.sent && !delivery.devUrl) {
      throw new InputError('Could not send verification email right now. Please try again shortly.', 502);
    }
    // Only apply if no newer email change or opt-out occurred while SMTP was in flight
    await getPool().query(
      `UPDATE accounts SET email=$2, email_verified=false, email_opted_out=false, email_prompted_at=now(), email_verify_token_hash=$3, email_verify_expires_at=$4 WHERE id=$1 AND email_change_rev=$5`,
      [account.id, rawEmail, hash(token), expiresAt, emailRev]
    );
    return {
      ok: true,
      message: delivery.sent
        ? `Verification link sent to ${rawEmail}. Check your inbox to verify.`
        : `Saved ${rawEmail}. Open the verification link to confirm your email.`,
      ...(delivery.devUrl ? { verificationUrl: delivery.devUrl } : {})
    };
  }
  // Fetch Battle.net data OUTSIDE guild write locks to prevent pool starvation and lock contention.
  if (body.action === 'refresh-vendor-prices' || body.action === 'refresh-guild-professions') {
    const pre = await (async () => {
      const db = getPool();
      const acct = await getIdentity(request, db);
      need(acct,'Sign in before using this action.',401);
      const acctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[acct.id])).rows;
      const activeGuildId = await resolveActiveGuildId(db, acct, acctChars);
      need(activeGuildId,'Select a verified guild character before using this action.');
      const member = (await db.query('SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true',[acct.id,activeGuildId])).rows[0];
      need(member,'Your guild access has ended.'); acct.role = member.role;
      const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1',[activeGuildId])).rows[0];
      need(guild,'Guild not found.',404);
      const state = await loadGuildState(db, activeGuildId, guild);
      const guildChars = state.characters.filter(c => c.accountId === acct.id && c.active !== false);
      const activeChars = acct.testAccount ? guildChars : (acctChars.length ? acctChars : guildChars);
      const access = resolveAccess(acct, activeChars, state, activeGuildId);
      need(access.isGuildMaster || access.permissions.manageGuildSync, body.action === 'refresh-vendor-prices' ? 'Your selected character cannot refresh bank item vendor prices.' : 'Your selected character cannot refresh guild professions from Battle.net.');
      if (body.action === 'refresh-guild-professions') {
        need(guild.id.startsWith('bnet:'),'Battle.net profession refresh is only available for Battle.net guilds.',400);
        return { guild, roster: state.roster ?? [] };
      }
      const txRows = (await db.query(`SELECT DISTINCT item_id FROM guild_bank_transactions WHERE guild_id=$1 AND item_id IS NOT NULL`, [guild.id])).rows;
      const stockRows = (await db.query(`SELECT DISTINCT item_id FROM guild_bank_items WHERE guild_id=$1 AND item_id IS NOT NULL`, [guild.id])).rows;
      return { guild, itemIds: [...new Set([...txRows.map(r => r.item_id), ...stockRows.map(r => r.item_id)])] };
    })();
    if (body.action === 'refresh-vendor-prices') {
      const ahContext = await resolveGuildAhContext(getPool(), pre.guild);
      const [prefetchedPrices, ahSnap] = await Promise.all([
        prefetchVendorPrices(pre.itemIds, pre.guild.region, fetch, { requireMetadata: true }),
        fetchForeverAhSnapshot({ ...ahContext, force: true }),
      ]);
      return transaction(async db => {
        const acct = await getIdentity(request, db);
        need(acct,'Sign in before using this action.',401);
        const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[pre.guild.id])).rows[0];
        need(guild,'Guild not found.',404);
        const member = (await db.query('SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true FOR SHARE',[acct.id,guild.id])).rows[0];
        need(member,'Your guild access has ended.'); acct.role = member.role;
        const acctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[acct.id])).rows;
        const state = await loadGuildState(db, guild.id, guild, { includeRequests: false });
        const guildChars = state.characters.filter(c => c.accountId === acct.id && c.active !== false);
        const access = resolveAccess(acct, acct.testAccount ? guildChars : (acctChars.length ? acctChars : guildChars), state, guild.id);
        need(access.isGuildMaster || access.permissions.manageGuildSync,'Your selected character cannot refresh bank item prices.');
        const result = await refreshGuildTransactionPrices(db, guild.id, guild.region, fetch, prefetchedPrices, ahContext);
        const ahNote = ahSnap.ok ? ` (${result.ahPriced} AH, ${result.vendorPriced} vendor fallback)` : ' (vendor fallback — AH unavailable)';
        return {ok:true,message:`Priced ${result.itemsPriced} items${ahNote} across ${result.transactionsUpdated} bank entries.`};
      });
    }
    const profFetchStartedAt = new Date();
    const token = await getBattleNetClientToken();
    const fetchedProfs = await fetchBattleNetGuildProfessions(pre.roster, pre.guild.region, token);
    return transaction(async db => {
      const acct = await getIdentity(request, db);
      need(acct,'Sign in before using this action.',401);
      const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[pre.guild.id])).rows[0];
      need(guild,'Guild not found.',404);
      const member = (await db.query('SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true FOR SHARE',[acct.id,guild.id])).rows[0];
      need(member,'Your guild access has ended.'); acct.role = member.role;
      const acctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[acct.id])).rows;
      const state = await loadGuildState(db, guild.id, guild, { includeRequests: false });
      const guildChars = state.characters.filter(c => c.accountId === acct.id && c.active !== false);
      const access = resolveAccess(acct, acct.testAccount ? guildChars : (acctChars.length ? acctChars : guildChars), state, guild.id);
      need(access.isGuildMaster || access.permissions.manageGuildSync,'Your selected character cannot refresh guild professions from Battle.net.');
      const count = await applyBattleNetGuildProfessions(db, guild.id, fetchedProfs, profFetchStartedAt);
      return {ok:true,message:`Refreshed professions for ${count} guild characters from Battle.net.`};
    });
  }
  const postCommit = [];
  const txResult = await transaction(async db => {
    const account = await getIdentity(request,db);
    need(account,'Sign in before using this action.',401);
    if (body.action === 'logout') {
      await db.query('DELETE FROM sessions WHERE id_hash=$1',[hash(cookies(request).hh_session)]);
      return {ok:true,message:'Signed out.',redirect:'/',cookie:sessionCookie('',request,0)};
    }
    if (body.action === 'opt-out-email') {
      await db.query(
        `UPDATE accounts SET email=NULL, email_verified=false, email_opted_out=true, email_prompted_at=now(), email_verify_token_hash=NULL, email_verify_expires_at=NULL, email_change_rev=email_change_rev + 1 WHERE id=$1`,
        [account.id]
      );
      return { ok: true, message: 'Email notifications disabled.' };
    }
    if (body.action === 'mark-notifications-read') {
      if (typeof body.id === 'string' && body.id.trim()) {
        await db.query(`UPDATE account_notifications SET read_at=now() WHERE id=$1 AND account_id=$2 AND read_at IS NULL`, [body.id.trim(), account.id]);
      } else {
        await db.query(`UPDATE account_notifications SET read_at=now() WHERE account_id=$1 AND read_at IS NULL`, [account.id]);
      }
      return { ok: true, message: 'Notifications marked as read.' };
    }
    if (body.action === 'add-external-commendation') {
      need(typeof body.guildId === 'string' && body.guildId.trim().length > 0,'Choose a guild.',400);
      const targetGuild = await findGuildBySlugOrId(db, body.guildId.trim());
      need(targetGuild,'That guild could not be found.',404);
      // Lock the guild row to serialize concurrent external/internal commendations against the 24h cooldown and diminishing returns.
      await db.query('SELECT id FROM guilds WHERE id=$1 FOR UPDATE', [targetGuild.id]);
      const rawIds = Array.isArray(body.characterIds)
        ? body.characterIds
        : (typeof body.characterId === 'string' ? [body.characterId] : []);
      const targetIds = [...new Set(rawIds.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean))];
      need(targetIds.length >= 1 && targetIds.length <= 40,'Choose at least one guild member to thank (up to 40).',400);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      need(message.length > 0 && message.length <= 500 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message),'Describe how they helped you (up to 500 characters).',400);
      const ownChars = (await db.query(
        `SELECT id, name, level, is_main AS "isMain", verified FROM account_characters WHERE account_id=$1 AND verified=true ORDER BY is_main DESC, name ASC`,
        [account.id]
      )).rows;
      const ownGuildChars = (await db.query(
        `SELECT id, name, level FROM guild_characters WHERE guild_id=$1 AND account_id=$2 AND active=true`,
        [targetGuild.id, account.id]
      )).rows;
      const ownIds = new Set([...ownChars.map(c => c.id), ...ownGuildChars.map(c => c.id)]);
      const ownNames = new Set([...ownChars.map(c => normalize(c.name)), ...ownGuildChars.map(c => normalize(c.name))]);
      const rosterMembers = (await db.query(
        `SELECT id, name, NULL::text AS account_id FROM guild_roster_members WHERE guild_id=$1
         UNION
         SELECT id, name, account_id FROM guild_characters WHERE guild_id=$1 AND active=true`,
        [targetGuild.id]
      )).rows;
      const resolvedTargets = [];
      const seenTargetIds = new Set();
      for (const targetId of targetIds) {
        const match = rosterMembers.find(m => m.id === targetId) ?? null;
        need(match,'One of the selected characters is not on the guild roster.',404);
        const isOwn = match.account_id === account.id || ownIds.has(match.id) || ownNames.has(normalize(match.name));
        need(!isOwn,'You cannot leave a helping-hand note on your own character.',400);
        if (!seenTargetIds.has(match.id)) {
          seenTargetIds.add(match.id);
          resolvedTargets.push({ id: match.id, name: match.name });
        }
      }
      const chosenAuthor = typeof body.authorCharacterId === 'string'
        ? (ownChars.find(c => c.id === body.authorCharacterId.trim()) ?? null)
        : null;
      const authorChar = chosenAuthor ?? ownChars[0] ?? ownGuildChars[0] ?? null;
      const authorLabel = authorChar?.name || account.battleTag;
      const authorLevel = Number.isSafeInteger(authorChar?.level) && authorChar.level > 0 ? authorChar.level : 1;
      const awards = await computeCommendationAwards(db, targetGuild.id, account.id, authorLevel, resolvedTargets);
      const beforeStandings = new Map();
      for (const target of resolvedTargets) {
        beforeStandings.set(target.id, (await getCharacterReputation(db, targetGuild.id, target.id, target.name)).standing);
      }
      const commId = randomUUID();
      await db.query(
        `INSERT INTO guild_commendations(id, guild_id, character_id, character_name, author_account_id, author_character_id, author_name, author_level, message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [commId, targetGuild.id, resolvedTargets[0].id, resolvedTargets[0].name, account.id, authorChar?.id ?? null, authorLabel, authorLevel, message]
      );
      for (const target of resolvedTargets) {
        await db.query(
          `INSERT INTO guild_commendation_recipients(commendation_id, guild_id, character_id, character_name, points_awarded) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [commId, targetGuild.id, target.id, target.name, awards.get(target.id) ?? 0]
        );
      }
      const guildDisplayName = targetGuild.display_name || targetGuild.name;
      postCommit.push(() => notifyHelpingHand({ guildId: targetGuild.id, guildName: guildDisplayName, recipients: resolvedTargets, authorName: authorLabel, message, origin }));
      for (const target of resolvedTargets) {
        const afterRep = await getCharacterReputation(db, targetGuild.id, target.id, target.name);
        const beforeStanding = beforeStandings.get(target.id);
        if (afterRep.standing !== beforeStanding) {
          postCommit.push(() => notifyReputationPromotion({ guildId: targetGuild.id, guildName: guildDisplayName, characterId: target.id, characterName: target.name, oldStanding: beforeStanding, newStanding: afterRep.standing, newPoints: afterRep.count, origin }));
        }
      }
      return { ok: true, message: 'Thank-you note submitted! It has been added to the guild activity feed.' };
    }
    if (body.action === 'set-main') {
      need(typeof body.characterId === 'string','Choose one of your verified characters.',400);
      // Lock ALL affected guilds for this account in sorted ID order FIRST, then accounts (universal lock order).
      const memGuilds = (await db.query('SELECT guild_id FROM memberships WHERE account_id=$1 AND active=true', [account.id])).rows.map(r => r.guild_id);
      const lockGuildIds = [...new Set([...(account.guildId ? [account.guildId] : []), ...memGuilds])].sort();
      for (const gid of lockGuildIds) {
        await db.query('SELECT id FROM guilds WHERE id=$1 FOR UPDATE', [gid]);
      }
      await db.query('SELECT id FROM accounts WHERE id=$1 FOR NO KEY UPDATE', [account.id]);
      const acctOwned = await db.query('SELECT id FROM account_characters WHERE id=$1 AND account_id=$2 AND verified=true',[body.characterId,account.id]);
      if (acctOwned.rowCount) {
        await db.query('UPDATE account_characters SET is_main=false,updated_at=now() WHERE account_id=$1 AND is_main=true',[account.id]);
        await db.query('UPDATE account_characters SET is_main=true,updated_at=now() WHERE id=$1 AND account_id=$2',[body.characterId,account.id]);
        if (account.guildId) {
          await db.query('UPDATE guild_characters SET is_main=(id=$1) WHERE guild_id=$2 AND account_id=$3',[body.characterId,account.guildId,account.id]);
        }
        return {ok:true,message:'Saved.'};
      }
      // Never fall through to another guild lock after acquiring the account lock; only fixture accounts use guild_characters directly.
      if (!account.testAccount || !account.guildId) throw new InputError('Choose one of your verified characters.',403);
      const fixOwned = await db.query('SELECT id FROM guild_characters WHERE guild_id=$1 AND id=$2 AND account_id=$3 AND verified=true AND active=true',[account.guildId,body.characterId,account.id]);
      need(fixOwned.rowCount,'Choose one of your verified guild characters.',403);
      await db.query('UPDATE guild_characters SET is_main=(id=$1) WHERE guild_id=$2 AND account_id=$3',[body.characterId,account.guildId,account.id]);
      return {ok:true,message:'Saved.'};
    }
    const initialAcctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[account.id])).rows;
    const activeGuildId = await resolveActiveGuildId(db, account, initialAcctChars);
    need(activeGuildId,'Select a verified guild character before using this action.');
    // Lock guilds FIRST (consistent lock order with Battle.net refresh and sync) before locking memberships or reading ranks.
    const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[activeGuildId])).rows[0];
    need(guild,'Guild not found.',404);
    const memberLock = body.action === 'set-guild-primary' ? 'FOR UPDATE' : 'FOR SHARE';
    const member = (await db.query(`SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true ${memberLock}`,[account.id,activeGuildId])).rows[0];
    need(member,'Your guild access has ended.'); account.role = member.role;
    // Re-read account characters AFTER acquiring guild + membership locks so ranks/membership cannot be stale.
    const acctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[account.id])).rows;
    const state = await loadGuildState(db, activeGuildId, guild);
    const activeGuildSlug = guild.id.startsWith('bnet:') ? guild.id.split(':').slice(2).join(':') : null;
    const guildChars = state.characters.filter(c => c.accountId === account.id && c.active !== false);
    const activeChars = account.testAccount ? guildChars : (acctChars.length ? acctChars : guildChars);
    const access = resolveAccess(account, activeChars, state, activeGuildId);
    const requirePermission = (key, message) => need(access.isGuildMaster || access.permissions[key], message);
    const ownCharacter = id => activeChars.find(c => c.id === id && c.verified && matchesPortalGuild(c, activeGuildSlug, guild.region, guild.blizzard_guild_id));
    if (body.action === 'issue-token') {
      need(['member','guild'].includes(body.scope),'Choose a token scope.',400);
      if (body.scope === 'guild') need(access.isGuildMaster,'Only the verified Guild Master can create a guild sync token.');
      need(activeChars.some(c => c.verified),'Verify a character before creating a sync token.');
      const count = await db.query('SELECT count(*) FROM sync_tokens WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>now()',[account.id]);
      need(Number(count.rows[0].count) < 20,'Revoke an unused token before creating another.',409);
      const id = randomUUID(); const now = new Date(); const exp = new Date(now.getTime()+30*86400000);
      const token = signSyncToken({iss:'helping-hand',aud:'helping-hand-sync',sub:account.id,jti:id,guild:guild.id,scope:body.scope,iat:Math.floor(now.getTime()/1000),exp:Math.floor(exp.getTime()/1000)});
      await db.query('INSERT INTO sync_tokens(id,account_id,guild_id,scope,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,account.id,guild.id,body.scope,now,exp]);
      return {ok:true,message:'Copy this token now. This page will not show it again.',token};
    }
    if (body.action === 'revoke-token') {
      need(typeof body.id === 'string','Choose a token.',400);
      const result = await db.query('UPDATE sync_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND account_id=$2 AND guild_id=$3',[body.id,account.id,guild.id]);
      need(result.rowCount,'The token is unavailable.',404); return {ok:true,message:'Token revoked.'};
    }
    const bank = visibleBank(state,account.id);
    const reservedForItem = (item, excludeRequestId = null) => {
      // Count approved requests plus fulfilled requests not yet reconciled by a complete bank scan.
      return state.requests
        .filter(r => r.itemKey === item.itemKey && r.id !== excludeRequestId && (
          r.status === 'approved'
          || (r.status === 'fulfilled' && r.fulfilledAt && !r.reconciledAt)
        ))
        .reduce((n, r) => n + r.quantity, 0);
    };
    if (body.action === 'favorite') {
      need(bank.some(i => i.itemKey === body.itemKey),'The item is unavailable.',404);
      const exists = await db.query('SELECT 1 FROM guild_bank_favorites WHERE guild_id=$1 AND account_id=$2 AND item_key=$3',[guild.id,account.id,body.itemKey]);
      if (exists.rowCount) await db.query('DELETE FROM guild_bank_favorites WHERE guild_id=$1 AND account_id=$2 AND item_key=$3',[guild.id,account.id,body.itemKey]);
      else await db.query('INSERT INTO guild_bank_favorites(guild_id,account_id,item_key) VALUES($1,$2,$3)',[guild.id,account.id,body.itemKey]);
    } else if (body.action === 'request-item') {
      if (typeof body.guildId === 'string' && body.guildId.trim()) {
        need(body.guildId.trim() === guild.id, 'Your active guild changed. Reload the bank page and try again.', 409);
      }
      const item = bank.find(i => i.itemKey === body.itemKey);
      need(item,'The item is unavailable.',404);
      const requestableStock = item.banks.filter(b => !b.viewOnly).reduce((n,b)=>n+b.count,0);
      const reservedStock = reservedForItem(item);
      const availableStock = Math.max(0, requestableStock - reservedStock);
      need(Number.isSafeInteger(body.quantity) && body.quantity > 0 && body.quantity <= availableStock,'Choose a quantity from available requestable stock.',400);
      const char = ownCharacter(body.characterId); need(char,'Choose one of your verified guild characters.');
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      need(note.length <= 300 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note),'Request note must be 300 characters or fewer.',400);
      const openCounts = (await db.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE account_id=$2)::int AS own
         FROM guild_bank_requests
         WHERE guild_id=$1 AND status IN ('pending','approved')`,
        [guild.id, account.id]
      )).rows[0];
      need(Number(openCounts?.own ?? 0) < 20,'You already have 20 open bank requests. Wait for existing requests to be processed.',409);
      need(Number(openCounts?.total ?? 0) < 1000,'The guild open request limit has been reached. Process existing requests first.',409);
      await db.query(
        `INSERT INTO guild_bank_requests(id,guild_id,account_id,item_key,item_name,quantity,character_id,character_name,requester_name,status,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,now())`,
        [randomUUID(),guild.id,account.id,item.itemKey,item.name,body.quantity,char.id,char.name,account.battleTag,note || null]
      );
      postCommit.push(() => notifyBankRequestSubmitted({
        guildId: guild.id,
        guildName: guild.display_name || guild.name,
        itemName: item.name,
        quantity: body.quantity,
        characterName: char.name,
        note: note || null,
        requesterAccountId: account.id,
        state,
        origin,
      }));
    } else if (body.action === 'update-request') {
      requirePermission('approveBankRequests','Your selected character cannot approve bank requests.');
      need(['approved','declined','fulfilled'].includes(body.status),'Choose a request status.',400);
      const target = state.requests.find(r => r.id === body.id); need(target,'The request is unavailable.',404);
      const transitions = {pending:['approved','declined'],approved:['fulfilled','declined']};
      need(transitions[target.status]?.includes(body.status),'This request cannot move to that status.',409);
      if (body.status === 'approved') {
        const reqMember = (await db.query('SELECT 1 FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true',[target.accountId,guild.id])).rowCount;
        need(reqMember > 0,'The requester is no longer an active guild member. Decline this request instead.',409);
        if (activeGuildSlug) {
          const stillOwned = target.characterId
            ? (await db.query(
                `SELECT 1 FROM account_characters WHERE id=$1 AND account_id=$2 AND verified=true AND guild_slug=$3 AND region=$4 AND ($5::bigint IS NULL OR guild_id=$5)`,
                [target.characterId, target.accountId, activeGuildSlug, guild.region, guild.blizzard_guild_id ?? null]
              )).rowCount
            : (await db.query(
                `SELECT 1 FROM account_characters WHERE account_id=$1 AND verified=true AND guild_slug=$2 AND region=$3 AND lower(btrim(name))=$4 AND ($5::bigint IS NULL OR guild_id=$5)`,
                [target.accountId, activeGuildSlug, guild.region, normalize(target.characterName), guild.blizzard_guild_id ?? null]
              )).rowCount;
          need(stillOwned > 0,'The requested character is no longer verified in this guild. Decline this request instead.',409);
        }
        const item = bank.find(i => i.itemKey === target.itemKey);
        const requestableStock = item ? item.banks.filter(b => !b.viewOnly).reduce((n,b)=>n+b.count,0) : 0;
        const alreadyReserved = item ? reservedForItem(item, target.id) : 0;
        const availableStock = Math.max(0, requestableStock - alreadyReserved);
        need(target.quantity <= availableStock, 'Not enough requestable stock remains to approve this request.', 409);
      }
      if (body.status === 'fulfilled') {
        let fulfilledBankName = null;
        let fulfilledBankRealm = null;
        const reqItem = bank.find(i => i.itemKey === target.itemKey);
        // Only record a single supplying bank when that bank holds enough stock to fulfill the entire request.
        const supplyingCandidates = reqItem ? reqItem.banks.filter(b => !b.viewOnly && b.count >= target.quantity) : [];
        if (typeof body.bankName === 'string' && body.bankName.trim()) {
          const matchedBank = supplyingCandidates.find(b => normalize(b.name) === normalize(body.bankName));
          if (matchedBank) {
            fulfilledBankName = matchedBank.name;
            fulfilledBankRealm = matchedBank.realm || guild.realm;
          }
        } else if (supplyingCandidates.length === 1 && reqItem.banks.filter(b => !b.viewOnly && b.count > 0).length === 1) {
          fulfilledBankName = supplyingCandidates[0].name;
          fulfilledBankRealm = supplyingCandidates[0].realm || guild.realm;
        }
        await db.query(
          'UPDATE guild_bank_requests SET status=$1, fulfilled_at=clock_timestamp(), fulfilled_bank_name=$5, fulfilled_bank_realm=$6 WHERE id=$2 AND guild_id=$3 AND status=$4',
          [body.status, body.id, guild.id, target.status, fulfilledBankName, fulfilledBankRealm]
        );
      } else {
        await db.query('UPDATE guild_bank_requests SET status=$1 WHERE id=$2 AND guild_id=$3 AND status=$4',[body.status,body.id,guild.id,target.status]);
      }
      postCommit.push(() => notifyBankRequestStatus({
        guildId: guild.id,
        accountId: target.accountId,
        guildName: guild.display_name || guild.name,
        itemName: target.itemName,
        quantity: target.quantity,
        characterName: target.characterName,
        status: body.status,
        origin,
      }));
    } else if (body.action === 'set-main') {
      const char = ownCharacter(body.characterId); need(char,'Choose one of your verified guild characters.');
      await db.query('UPDATE guild_characters SET is_main=(id=$1) WHERE guild_id=$2 AND account_id=$3',[char.id,guild.id,account.id]);
    } else if (body.action === 'set-guild-primary') {
      need(typeof body.characterId === 'string' && body.characterId.trim().length > 0,'Choose your primary character.',400);
      const targetId = body.characterId.trim();
      const acctMatch = acctChars.find(c => c.id === targetId && c.verified && matchesPortalGuild(c, activeGuildSlug, guild.region, guild.blizzard_guild_id));
      const allowGuildFallback = account.testAccount || !acctChars.length;
      const guildMatch = allowGuildFallback ? state.characters.find(c => c.id === targetId && c.accountId === account.id && c.active !== false) : null;
      need(Boolean(acctMatch || guildMatch),'Choose one of your characters in this guild.',403);
      const resolvedCharId = acctMatch?.id || guildMatch?.id;
      await db.query('UPDATE memberships SET primary_character_id=$3 WHERE account_id=$1 AND guild_id=$2',[account.id,guild.id,resolvedCharId]);
      return { ok: true, message: 'Primary character saved.' };
    } else if (body.action === 'set-offer') {
      need(typeof body.offered === 'boolean','Choose an offer status.',400);
      let found = null;
      for (const char of state.characters.filter(c=>c.accountId === account.id && c.verified && c.active !== false)) for (const prof of char.professions ?? []) for (const recipe of prof.recipes ?? []) {
        if (`${char.id}:${prof.id}:${recipe.id}` === body.recipeKey) found = { charId: char.id, profId: prof.id, recipeId: recipe.id };
      }
      need(found,'Choose one of your known recipes.');
      await db.query('UPDATE guild_character_recipes SET offered=$1 WHERE guild_id=$2 AND character_id=$3 AND profession_id=$4 AND recipe_id=$5',[body.offered,guild.id,found.charId,found.profId,found.recipeId]);
      await db.query('INSERT INTO guild_recipe_offers(guild_id,recipe_key,offered) VALUES($1,$2,$3) ON CONFLICT(guild_id,recipe_key) DO UPDATE SET offered=excluded.offered',[guild.id,body.recipeKey,body.offered]);
    } else if (body.action === 'set-title') {
      requirePermission('assignTitles','Your selected character cannot assign guild profession titles.');
      need(typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 80 && !/[\x00-\x1f]/.test(body.title) && typeof body.assigned === 'boolean','Enter a guild profession title.',400);
      let char = state.characters.find(c => c.id === body.characterId && c.active !== false);
      if (!char) {
        const rosterMember = (state.roster ?? []).find(r => r.id === body.characterId);
        need(rosterMember,'The character is unavailable.',404);
        await db.query(
          `INSERT INTO guild_characters(guild_id,id,account_id,name,realm,verified,active,is_main) VALUES($1,$2,NULL,$3,$4,false,true,false) ON CONFLICT DO NOTHING`,
          [guild.id,rosterMember.id,rosterMember.name,rosterMember.realm || guild.realm]
        );
        char = {id:rosterMember.id,titles:[]};
      }
      const title = body.title.trim();
      if (body.assigned) {
        need((char.titles ?? []).length < 30,'The character has too many titles.',400);
        const insertedTitle = await db.query('INSERT INTO guild_character_titles(guild_id,character_id,title) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[guild.id,char.id,title]);
        if (insertedTitle.rowCount) {
          const charName = char.name || (state.roster ?? []).find(r => r.id === char.id)?.name || 'Your character';
          postCommit.push(() => notifyTitleAssigned({ guildId: guild.id, guildName: guild.display_name || guild.name, characterId: char.id, characterName: charName, title, origin }));
        }
      } else {
        await db.query('DELETE FROM guild_character_titles WHERE guild_id=$1 AND character_id=$2 AND title=$3',[guild.id,char.id,title]);
      }
    } else if (body.action === 'save-rank-permissions') {
      need(access.isGuildMaster,'Only the Guild Master can change rank permissions.');
      need(Number.isSafeInteger(body.rankIndex) && body.rankIndex >= 1 && body.rankIndex <= 9,'Choose a rank between 1 and 9.',400);
      need(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.trim().length <= 60 && !/[\x00-\x1f]/.test(body.name),'Enter a valid rank name.',400);
      await db.query(
        `INSERT INTO guild_ranks(guild_id,rank_index,name,approve_bank_requests,assign_titles,manage_guild_sync,manage_announcements)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(guild_id,rank_index) DO UPDATE SET name=excluded.name,approve_bank_requests=excluded.approve_bank_requests,assign_titles=excluded.assign_titles,manage_guild_sync=excluded.manage_guild_sync,manage_announcements=excluded.manage_announcements`,
        [guild.id,body.rankIndex,body.name.trim(),Boolean(body.approveBankRequests),Boolean(body.assignTitles),Boolean(body.manageGuildSync),Boolean(body.manageAnnouncements)]
      );
      await db.query('UPDATE guild_roster_members SET guild_rank=$1 WHERE guild_id=$2 AND guild_rank_index=$3',[body.name.trim(),guild.id,body.rankIndex]);
    } else if (body.action === 'save-motd') {
      requirePermission('manageAnnouncements','Your selected character cannot update guild announcements.');
      const motdText = typeof body.motd === 'string' ? body.motd.trim() : '';
      const infoText = typeof body.guildInfo === 'string' ? body.guildInfo.trim() : '';
      need(motdText.length <= 500 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(motdText),'The message of the day must be 500 characters or fewer.',400);
      need(infoText.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(infoText),'Guild info must be 2000 characters or fewer.',400);
      const now = new Date().toISOString();
      const author = access.selected?.name || account.battleTag;
      await db.query(
        `UPDATE guilds SET motd_text=$2,motd_updated_at=$3,motd_updated_by=$4,guild_info_text=$5,guild_info_updated_at=$6,guild_info_updated_by=$7 WHERE id=$1`,
        [guild.id,motdText || null,motdText ? now : null,motdText ? author : null,infoText || null,infoText ? now : null,infoText ? author : null]
      );
    } else if (body.action === 'publish-news' || body.action === 'edit-news') {
      requirePermission('manageAnnouncements','Your selected character cannot manage guild news.');
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const rawContent = typeof body.body === 'string' ? body.body.trim() : '';
      need(title.length > 0,'Enter a news title.',400);
      need(title.length <= 120,`News title must be 120 characters or fewer (currently ${title.length}).`,400);
      need(!/[\x00-\x1f]/.test(title),'News title contains unsupported control characters.',400);
      need(rawContent.length > 0,'Enter the news body.',400);
      need(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(rawContent),'News body contains unsupported control characters.',400);
      need(rawContent.length <= 40000,'Formatted news HTML is too large (max 40,000 characters). Try clearing extra formatting.',400);
      const sanitized = sanitizeNewsHtml(rawContent);
      const visibleText = stripHtmlText(sanitized);
      need(visibleText.length > 0,'Enter the news body.',400);
      need(visibleText.length <= 4000,`News body is too long (${visibleText.length.toLocaleString()} / 4,000 characters).`,400);
      need(sanitized.length <= 24000,'Formatted news HTML is too large after sanitization (max 24,000 characters).',400);
      if (body.action === 'edit-news') {
        need(typeof body.id === 'string' && body.id.trim().length > 0,'Choose a news post to edit.',400);
        const updated = await db.query('UPDATE guild_news SET title=$3, body=$4 WHERE id=$1 AND guild_id=$2',[body.id.trim(),guild.id,title,sanitized]);
        need(updated.rowCount > 0,'That news post could not be found.',404);
      } else {
        const newsId = randomUUID();
        const authorName = access.selected?.name || account.battleTag;
        await db.query('INSERT INTO guild_news(id,guild_id,title,body,published_at,author_name) VALUES($1,$2,$3,$4,now(),$5)',[newsId,guild.id,title,sanitized,authorName]);
        postCommit.push(() => notifyNewsPublished({ guildId: guild.id, guildName: guild.display_name || guild.name, newsId, title, excerpt: visibleText, authorName, authorAccountId: account.id, origin }));
      }
    } else if (body.action === 'delete-news') {
      requirePermission('manageAnnouncements','Your selected character cannot manage guild news.');
      need(typeof body.id === 'string','Choose a news post.',400);
      await db.query('DELETE FROM guild_news WHERE id=$1 AND guild_id=$2',[body.id,guild.id]);
      const safeRedirect = safeLocalPath(body.redirect, origin);
      if (safeRedirect) {
        return { ok: true, message: 'Post deleted.', redirect: safeRedirect };
      }
    } else if (body.action === 'add-macro') {
      need(access.isGuildMaster,'Only the Guild Master can manage guild macros.');
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const macroBody = typeof body.body === 'string' ? body.body.trim() : '';
      need(title.length > 0 && title.length <= 80 && !/[\x00-\x1f]/.test(title),'Enter a macro title (up to 80 characters).',400);
      need(macroBody.length > 0 && macroBody.length <= 500 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(macroBody),'Enter macro text (up to 500 characters).',400);
      await db.query('INSERT INTO guild_macros(id,guild_id,title,body) VALUES($1,$2,$3,$4)',[randomUUID(),guild.id,title,macroBody]);
    } else if (body.action === 'delete-macro') {
      need(access.isGuildMaster,'Only the Guild Master can manage guild macros.');
      need(typeof body.id === 'string' && body.id.trim().length > 0,'Choose a macro.',400);
      await db.query('DELETE FROM guild_macros WHERE id=$1 AND guild_id=$2',[body.id.trim(),guild.id]);
    } else if (body.action === 'add-commendation') {
      const rawIds = Array.isArray(body.characterIds)
        ? body.characterIds
        : (typeof body.characterId === 'string' ? [body.characterId] : []);
      const targetIds = [...new Set(rawIds.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean))];
      need(targetIds.length >= 1 && targetIds.length <= 40,'Choose at least one guild member to thank (up to 40).',400);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      need(message.length > 0 && message.length <= 500 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message),'Describe how they helped you (up to 500 characters).',400);
      const resolvedTargets = [];
      const seenTargetIds = new Set();
      for (const targetId of targetIds) {
        const targetChar = (state.characters ?? []).find(c => c.id === targetId && c.active !== false) ?? null;
        const targetRoster = (state.roster ?? []).find(r => r.id === targetId || (targetChar && (characterKey(r) === characterKey(targetChar) || normalize(r.name) === normalize(targetChar.name)))) ?? null;
        need(targetChar || targetRoster,'One of the selected characters is not on the guild roster.',404);
        const targetName = targetChar?.name || targetRoster?.name;
        const resolvedTargetId = targetChar?.id || targetRoster?.id;
        const isOwn = targetChar?.accountId === account.id || activeChars.some(c => c.id === resolvedTargetId || normalize(c.name) === normalize(targetName));
        need(!isOwn,'You cannot leave a helping-hand note on your own character.',400);
        if (!seenTargetIds.has(resolvedTargetId)) {
          seenTargetIds.add(resolvedTargetId);
          resolvedTargets.push({ id: resolvedTargetId, name: targetName });
        }
      }
      const authorChar = access.selected ?? activeChars.find(c => c.verified) ?? activeChars[0] ?? null;
      const authorLabel = authorChar?.name || account.battleTag;
      const authorLevel = Number.isSafeInteger(authorChar?.level) && authorChar.level > 0 ? authorChar.level : 1;
      const awards = await computeCommendationAwards(db, guild.id, account.id, authorLevel, resolvedTargets);
      const beforeStandings = new Map();
      for (const target of resolvedTargets) {
        beforeStandings.set(target.id, (await getCharacterReputation(db, guild.id, target.id, target.name)).standing);
      }
      const commId = randomUUID();
      await db.query(
        `INSERT INTO guild_commendations(id, guild_id, character_id, character_name, author_account_id, author_character_id, author_name, author_level, message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [commId, guild.id, resolvedTargets[0].id, resolvedTargets[0].name, account.id, authorChar?.id ?? null, authorLabel, authorLevel, message]
      );
      for (const target of resolvedTargets) {
        await db.query(
          `INSERT INTO guild_commendation_recipients(commendation_id, guild_id, character_id, character_name, points_awarded) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [commId, guild.id, target.id, target.name, awards.get(target.id) ?? 0]
        );
      }
      const guildDisplayName = guild.display_name || guild.name;
      postCommit.push(() => notifyHelpingHand({ guildId: guild.id, guildName: guildDisplayName, recipients: resolvedTargets, authorName: authorLabel, message, origin }));
      for (const target of resolvedTargets) {
        const afterRep = await getCharacterReputation(db, guild.id, target.id, target.name);
        const beforeStanding = beforeStandings.get(target.id);
        if (afterRep.standing !== beforeStanding) {
          postCommit.push(() => notifyReputationPromotion({ guildId: guild.id, guildName: guildDisplayName, characterId: target.id, characterName: target.name, oldStanding: beforeStanding, newStanding: afterRep.standing, newPoints: afterRep.count, origin }));
        }
      }
      return {ok:true,message:'Posted to the activity feed.'};
    } else if (body.action === 'delete-commendation') {
      need(typeof body.id === 'string' && body.id.trim().length > 0,'Choose a commendation to remove.',400);
      const existing = (await db.query(`SELECT id, author_account_id AS "authorAccountId" FROM guild_commendations WHERE id=$1 AND guild_id=$2 AND deleted_at IS NULL`, [body.id, guild.id])).rows[0];
      need(existing,'That activity entry is unavailable.',404);
      need(existing.authorAccountId === account.id || access.isGuildMaster || access.permissions.manageAnnouncements,'You can only remove your own entries unless you have officer permission.',403);
      await db.query(`UPDATE guild_commendations SET deleted_at=now() WHERE id=$1 AND guild_id=$2 AND deleted_at IS NULL`, [body.id, guild.id]);
      return {ok:true,message:'Removed.'};
    } else if (body.action === 'save-designated-banks') {
      requirePermission('manageGuildSync','Your selected character cannot manage designated bank characters.');
      const raw = typeof body.bankNames === 'string' ? body.bankNames : '';
      const names = [...new Set(raw.split(/\r?\n/).map(v => v.trim()).filter(Boolean))];
      need(names.length <= 100 && names.every(n => n.length <= 120 && !/[\x00-\x1f]/.test(n)),'Enter up to 100 valid bank character names, one per line.',400);
      await db.query('DELETE FROM guild_designated_banks WHERE guild_id=$1',[guild.id]);
      for (const name of names) {
        await db.query('INSERT INTO guild_designated_banks(guild_id,name,realm) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[guild.id,name,guild.realm]);
      }
      if (names.length) {
        await db.query('DELETE FROM guild_banks WHERE guild_id=$1 AND NOT (lower(btrim(name)) = ANY($2::text[]))',[guild.id, names.map(normalize)]);
      } else {
        await db.query('DELETE FROM guild_banks WHERE guild_id=$1',[guild.id]);
      }
    } else if (body.action === 'save-guild-branding') {
      need(access.isGuildMaster,'Only the Guild Master of this guild can update its branding.');
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const logoName = typeof body.logoName === 'string' ? body.logoName.trim() : '';
      need(displayName.length <= 100 && !/[\x00-\x1f]/.test(displayName),'Enter a valid guild display name.',400);
      need(logoName.length <= 100 && !/[\x00-\x1f]/.test(logoName),'Enter a valid logo name.',400);
      await db.query('UPDATE guilds SET display_name=$2,logo_name=$3 WHERE id=$1',[guild.id,displayName || null,logoName || null]);
      return {ok:true,message:'Branding saved.'};
    } else if (body.action === 'remove-guild-logo') {
      need(access.isGuildMaster,'Only the Guild Master of this guild can remove its logo.');
      await db.query('UPDATE guilds SET logo_bytes=NULL,logo_mime=NULL,logo_updated_at=NULL WHERE id=$1',[guild.id]);
      return {ok:true,message:'Logo reset to default.'};
    } else if (body.action === 'add-bank-contribution') {
      need(access.isGuildMaster || access.permissions.approveBankRequests || access.permissions.manageGuildSync, 'Your selected character cannot record bank contributions.');
      need(typeof body.characterId === 'string' && body.characterId.trim().length > 0, 'Choose a guild member.', 400);
      const targetId = body.characterId.trim();
      const targetChar = (state.characters ?? []).find(c => c.id === targetId && c.active !== false) ?? null;
      const targetRoster = (state.roster ?? []).find(r => r.id === targetId || (targetChar && (characterKey(r) === characterKey(targetChar) || normalize(r.name) === normalize(targetChar.name)))) ?? null;
      need(targetChar || targetRoster, 'That character is not on the guild roster.', 404);
      const gold = Math.max(0, Math.floor(Number(body.gold) || 0));
      const silver = Math.max(0, Math.floor(Number(body.silver) || 0));
      const copperVal = Math.max(0, Math.floor(Number(body.copper) || 0));
      const totalCopper = gold * 10000 + silver * 100 + copperVal;
      need(Number.isSafeInteger(totalCopper) && totalCopper > 0 && totalCopper <= 2000000000, 'Enter a gold, silver, or copper amount greater than 0.', 400);
      const signedCopper = body.direction === 'subtract' ? -totalCopper : totalCopper;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      need(reason.length > 0 && reason.length <= 300 && !/[\x00-\x1f]/.test(reason), 'Enter a short reason (up to 300 characters).', 400);
      const authorName = access.selected?.name || account.battleTag;
      const resolvedCharId = targetChar?.id || targetRoster?.id;
      const resolvedCharName = targetChar?.name || targetRoster?.name;
      const beforeRep = signedCopper > 0 ? await getCharacterReputation(db, guild.id, resolvedCharId, resolvedCharName) : null;
      await db.query(
        `INSERT INTO guild_bank_contributions(id, guild_id, character_id, character_name, copper, reason, awarded_by_account_id, awarded_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), guild.id, resolvedCharId, resolvedCharName, signedCopper, reason, account.id, authorName]
      );
      if (signedCopper > 0) {
        const guildDisplayName = guild.display_name || guild.name;
        postCommit.push(() => notifyManualContribution({ guildId: guild.id, guildName: guildDisplayName, characterId: resolvedCharId, characterName: resolvedCharName, copper: signedCopper, reason, awardedByName: authorName, origin }));
        const afterRep = await getCharacterReputation(db, guild.id, resolvedCharId, resolvedCharName);
        if (beforeRep && afterRep.standing !== beforeRep.standing) {
          postCommit.push(() => notifyReputationPromotion({ guildId: guild.id, guildName: guildDisplayName, characterId: resolvedCharId, characterName: resolvedCharName, oldStanding: beforeRep.standing, newStanding: afterRep.standing, newPoints: afterRep.count, origin }));
        }
      }
      return {ok:true,message:'Bank contribution saved.'};
    } else if (body.action === 'delete-bank-contribution') {
      need(access.isGuildMaster || access.permissions.approveBankRequests || access.permissions.manageGuildSync, 'Your selected character cannot remove bank contributions.');
      need(typeof body.id === 'string' && body.id.trim().length > 0, 'Choose a contribution entry.', 400);
      const res = await db.query(`DELETE FROM guild_bank_contributions WHERE id=$1 AND guild_id=$2`, [body.id, guild.id]);
      need(res.rowCount, 'Contribution entry not found.', 404);
      return {ok:true,message:'Contribution removed.'};
    } else throw new InputError('Unknown action.');
    return {ok:true,message:'Saved.'};
  });
  if (postCommit.length) {
    void Promise.allSettled(postCommit.map(fn => fn()));
  }
  return txResult;
}
export async function handleSync(request, address) {
  secureTransport(request);
  const auth = request.headers.get('authorization');
  const isBearer = Boolean(auth?.startsWith('Bearer '));
  let bearerClaims = null;
  if (isBearer) {
    bearerClaims = verifySyncToken(auth.slice(7));
  } else {
    requireOrigin(request);
    const preAccount = await getIdentity(request);
    need(preAccount, 'Sign in with Battle.net before syncing.', 401);
  }
  const value = validateSnapshot(await readJson(request,5*1024*1024));
  const digest = hash(JSON.stringify(value));
  const queueSyncNotifications = async (db, guild, prevState, mergedState, txImportResult, beforeDonorReps, postCommit, origin) => {
    const guildDisplayName = guild.display_name || guild.name;
    const prevVisible = new Map(visibleBank(prevState).map(i => [i.itemKey, i.count]));
    const nextVisible = visibleBank(mergedState);
    const restockedItems = nextVisible
      .filter(i => i.count > (prevVisible.get(i.itemKey) ?? 0))
      .map(i => ({ itemKey: i.itemKey, name: i.name, beforeCount: prevVisible.get(i.itemKey) ?? 0, afterCount: i.count }));
    if (restockedItems.length) {
      postCommit.push(() => notifyFavoritesRestocked({ guildId: guild.id, guildName: guildDisplayName, restockedItems, origin }));
    }
    const newDonations = txImportResult?.newDonations ?? [];
    if (newDonations.length) {
      postCommit.push(() => notifyNewDonations({ guildId: guild.id, guildName: guildDisplayName, newDonations, origin }));
      const donorByNorm = new Map();
      for (const d of newDonations) {
        const norm = normalize(d.actorName || '');
        if (norm && !donorByNorm.has(norm)) donorByNorm.set(norm, d.actorName);
      }
      const notifiedAccounts = new Set();
      for (const [norm, donorName] of donorByNorm.entries()) {
        const beforeStanding = beforeDonorReps.get(norm);
        if (!beforeStanding) continue;
        const charMatch = (mergedState.characters ?? []).find(c => normalize(c.name) === norm)
          ?? (mergedState.roster ?? []).find(r => normalize(r.name) === norm);
        const afterRep = await getCharacterReputation(db, guild.id, charMatch?.id || '', donorName);
        const dedupeKey = afterRep.accountId ? `acct:${afterRep.accountId}` : `char:${norm}`;
        if (notifiedAccounts.has(dedupeKey)) continue;
        if (afterRep.standing !== beforeStanding) {
          notifiedAccounts.add(dedupeKey);
          postCommit.push(() => notifyReputationPromotion({
            guildId: guild.id,
            guildName: guildDisplayName,
            characterId: afterRep.primaryId || charMatch?.id || '',
            characterName: afterRep.primaryName || donorName,
            oldStanding: beforeStanding,
            newStanding: afterRep.standing,
            newPoints: afterRep.count,
            origin,
          }));
        }
      }
    }
  };
  const captureBeforeDonorReps = async (db, guildId, mergedState, bankLog = []) => {
    const before = new Map();
    const seen = new Set();
    for (const raw of bankLog ?? []) {
      const name = typeof raw?.from === 'string' && raw.from.trim() ? raw.from.trim() : (typeof raw?.actorName === 'string' && raw.actorName.trim() ? raw.actorName.trim() : '');
      const norm = normalize(name);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      const charMatch = (mergedState.characters ?? []).find(c => normalize(c.name) === norm)
        ?? (mergedState.roster ?? []).find(r => normalize(r.name) === norm);
      const rep = await getCharacterReputation(db, guildId, charMatch?.id || '', name);
      before.set(norm, rep.standing);
    }
    return before;
  };
  const filterDesignatedBankLog = (bankLog, designatedBanks) => {
    if (!Array.isArray(bankLog) || !bankLog.length) return { eligible: [], skipped: 0 };
    const designatedNames = new Set((designatedBanks ?? []).map(b => normalize(b.name)));
    const eligible = [];
    let skipped = 0;
    for (const entry of bankLog) {
      const bankName = entry.type === 'requested' && typeof entry.to === 'string' && entry.to.trim()
        ? entry.to.trim()
        : (entry.bankName ?? entry.name ?? '').trim();
      if (designatedNames.has(normalize(bankName))) eligible.push(entry);
      else skipped += 1;
    }
    return { eligible, skipped };
  };
  // Reconcile fulfilled bank request reservations per request:
  // - Native banks require a complete scan with observedAt > fulfilled_at.
  // - Ultimate Bank banks publish complete visible stock with capturedAt (no per-container observedAt), so capturedAt > fulfilled_at reconciles them.
  // - A supplying bank toggled to viewOnly is NOT treated as absent (so toggling viewOnly and scanning another bank never clears its reservation).
  const reconcileFulfilledRequests = async (db, guildId, mergedState) => {
    const openFulfilled = (await db.query(
      `SELECT id, item_key AS "itemKey", fulfilled_at AS "fulfilledAt", fulfilled_bank_name AS "fulfilledBankName"
       FROM guild_bank_requests
       WHERE guild_id=$1 AND status='fulfilled' AND reconciled_at IS NULL AND fulfilled_at IS NOT NULL`,
      [guildId]
    )).rows;
    if (!openFulfilled.length) return;
    const desigNames = new Set((mergedState.designatedBanks ?? []).map(b => normalize(b.name)));
    const designatedBanks = (mergedState.banks ?? []).filter(b => !desigNames.size || desigNames.has(normalize(b.name)));
    const reqBanks = designatedBanks.filter(b => !b.viewOnly);
    const bankByNorm = new Map(designatedBanks.map(b => [normalize(b.name), b]));
    // Track ALL designated banks holding each item variant (including viewOnly banks) so toggling a holding bank
    // to viewOnly without refreshing its stock can never prematurely clear a split/unattributed reservation.
    const banksHoldingItem = new Map();
    for (const b of designatedBanks) {
      for (const item of b.items ?? []) {
        if ((item.count ?? 0) <= 0) continue;
        const key = `${item.itemId}:${item.suffixId ?? 0}:${item.enchantId ?? 0}`;
        const list = banksHoldingItem.get(key) ?? [];
        list.push(b);
        banksHoldingItem.set(key, list);
      }
    }
    const isFreshAfter = (b, fulfilledMs) => {
      if (b.sourceKind === 'ultimate-bank') {
        return Boolean(Number.isSafeInteger(b.stockChangedAt) && b.stockChangedAt > 0 && b.stockChangedAt * 1000 > fulfilledMs);
      }
      return Boolean(b.complete && Number.isSafeInteger(b.observedAt) && b.observedAt > 0 && b.observedAt * 1000 > fulfilledMs);
    };
    const reconcileIds = [];
    for (const req of openFulfilled) {
      const fulfilledMs = Date.parse(req.fulfilledAt);
      if (!Number.isFinite(fulfilledMs)) continue;
      if (req.fulfilledBankName) {
        const sourceBank = bankByNorm.get(normalize(req.fulfilledBankName));
        // Only clear if the supplying bank was removed from designated banks completely or has a fresh post-fulfillment scan.
        if (!sourceBank || isFreshAfter(sourceBank, fulfilledMs)) {
          reconcileIds.push(req.id);
        }
      } else {
        const holders = banksHoldingItem.get(req.itemKey) ?? [];
        if (!holders.length) {
          if (reqBanks.some(b => isFreshAfter(b, fulfilledMs))) reconcileIds.push(req.id);
        } else if (holders.every(b => isFreshAfter(b, fulfilledMs))) {
          reconcileIds.push(req.id);
        }
      }
    }
    if (reconcileIds.length) {
      await db.query(
        `UPDATE guild_bank_requests
         SET reconciled_at = clock_timestamp()
         WHERE guild_id=$1 AND id = ANY($2::text[]) AND reconciled_at IS NULL`,
        [guildId, reconcileIds]
      );
    }
  };
  // Pre-authorize (using exact resolveAccess), verify non-duplicate, and validate snapshot scope BEFORE fetching Battle.net prices.
  // Defer item_catalog writes until AFTER the locked upload passes authorization and claims sync_uploads.
  let prefetchedPrices = new Map();
  let prefetchedCatalogItems = [];
  let prefetchedAhContext = null;
  if ((value.banks ?? []).length || (value.bankLog ?? []).length) {
    const preDb = getPool();
    let preAccount = null;
    let preGuildId = null;
    if (isBearer) {
      if (bearerClaims.scope === 'guild') {
        const preTok = (await preDb.query(
          `SELECT t.account_id, t.guild_id, a.test_account, m.role FROM sync_tokens t JOIN accounts a ON a.id=t.account_id JOIN memberships m ON m.account_id=t.account_id AND m.guild_id=t.guild_id WHERE t.id=$1 AND t.account_id=$2 AND t.guild_id=$3 AND t.scope='guild' AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() AND m.active=true`,
          [bearerClaims.jti, bearerClaims.sub, bearerClaims.guild]
        )).rows[0];
        if (preTok) { preAccount = { id: preTok.account_id, role: preTok.role, testAccount: Boolean(preTok.test_account) }; preGuildId = preTok.guild_id; }
      }
    } else {
      const preAcct = await getIdentity(request, preDb);
      if (preAcct) {
        const preChars = (await preDb.query(`SELECT id,guild_slug AS "guildSlug",guild_id AS "guildId",region,is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`, [preAcct.id])).rows;
        const gid = await resolveActiveGuildId(preDb, preAcct, preChars);
        if (gid) {
          const preMem = (await preDb.query(`SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true`, [preAcct.id, gid])).rows[0];
          if (preMem) { preAccount = { ...preAcct, role: preMem.role }; preGuildId = gid; }
        }
      }
    }
    if (preAccount && preGuildId) {
      const dupCheck = await preDb.query('SELECT 1 FROM sync_uploads WHERE account_id=$1 AND snapshot_id=$2', [preAccount.id, value.snapshotId]);
      if (!dupCheck.rowCount) {
        const preGuild = (await preDb.query('SELECT id,name,realm,region,blizzard_guild_id FROM guilds WHERE id=$1', [preGuildId])).rows[0];
        if (preGuild) {
          const preState = await loadGuildState(preDb, preGuild.id, preGuild, { includeRequests: false });
          const preSlug = preGuild.id.startsWith('bnet:') ? preGuild.id.split(':').slice(2).join(':') : null;
          const preAcctChars = preAccount.testAccount ? [] : (await preDb.query(
            `SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1 AND verified=true`,
            [preAccount.id]
          )).rows.filter(c => matchesPortalGuild(c, preSlug, preGuild.region, preGuild.blizzard_guild_id));
          const preGuildChars = preState.characters.filter(c => c.accountId === preAccount.id && c.active !== false);
          const preAccess = resolveAccess(preAccount, preAccount.testAccount ? preGuildChars : (preAcctChars.length ? preAcctChars : preGuildChars), preState, preGuild.id);
          if (preAccess.isGuildMaster) {
            const preAuthState = preAccount.testAccount ? preState : {
              ...preState,
              characters: [
                ...preState.characters.filter(c => c.accountId !== preAccount.id || preAcctChars.some(ac => ac.id === c.id)),
                ...preAcctChars.filter(ac => !preState.characters.some(gc => gc.id === ac.id)).map(c => ({ ...c, accountId: preAccount.id, active: true }))
              ]
            };
            let preAuthorized = false;
            try {
              authorizeSnapshot(value, { id: preAccount.id }, preGuild, preAuthState, 'guild');
              preAuthorized = true;
            } catch { preAuthorized = false; }
            if (preAuthorized) {
              const desigNames = new Set((preState.designatedBanks ?? []).map(b => normalize(b.name)));
              const eligibleBankIds = (value.banks ?? [])
                .filter(b => desigNames.has(normalize(b.name)))
                .flatMap(b => (b.items ?? []).map(i => i.itemId));
              const { eligible: preLog } = filterDesignatedBankLog(value.bankLog, preState.designatedBanks);
              const logItemIds = preLog.map(e => e.itemId ?? e.itemID).filter(Boolean);
              const cappedIds = [...new Set([...eligibleBankIds, ...logItemIds])].slice(0, 200);
              if (cappedIds.length) {
                prefetchedAhContext = await resolveGuildAhContext(preDb, preGuild);
                const [prefetched] = await Promise.all([
                  prefetchVendorPrices(cappedIds, preGuild.region, fetch, { requireMetadata: eligibleBankIds.length > 0, deferCatalogWrite: true }),
                  fetchForeverAhSnapshot({ ...prefetchedAhContext, force: false }),
                ]);
                prefetchedPrices = prefetched.priceMap;
                prefetchedCatalogItems = prefetched.fetchedItems;
              }
            }
          }
        }
      }
    }
  }
  if (isBearer) {
    const claims = bearerClaims;
    const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
    const postCommit = [];
    const txResult = await transaction(async db => {
      // Lock guilds FIRST (same lock order as revoke-token and membership refresh) to prevent deadlocks.
      const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[claims.guild])).rows[0];
      need(guild,'The sync token no longer has access.',401);
      const result = await db.query(
        `SELECT t.*,a.test_account,m.role FROM sync_tokens t
         JOIN accounts a ON a.id=t.account_id
         JOIN memberships m ON m.account_id=t.account_id AND m.guild_id=t.guild_id
         WHERE t.id=$1 AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() AND m.active=true
         FOR UPDATE OF t`,
        [claims.jti]
      );
      const token = result.rows[0];
      need(token && token.account_id === claims.sub && token.guild_id === claims.guild && token.scope === claims.scope && claims.exp > Math.floor(Date.now() / 1000),'The sync token no longer has access.',401);
      need(!token.test_account || (address !== undefined && localMode(request,address)),'Local fixture tokens require a loopback development connection.');
      const guildState = await loadGuildState(db, guild.id, guild, { includeRequests: false });
      const activeGuildSlug = guild.id.startsWith('bnet:') ? guild.id.split(':').slice(2).join(':') : null;
      const acctChars = token.test_account
        ? []
        : (await db.query(
            `SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified
             FROM account_characters WHERE account_id=$1 AND verified=true`,
            [claims.sub]
          )).rows;
      const scopedAcctChars = acctChars.filter(c => matchesPortalGuild(c, activeGuildSlug, guild.region, guild.blizzard_guild_id));
      const guildChars = guildState.characters.filter(c => c.accountId === claims.sub && c.active !== false);
      const activeChars = token.test_account ? guildChars : (scopedAcctChars.length ? scopedAcctChars : guildChars);
      const access = resolveAccess({ id: claims.sub, role: token.role, testAccount: token.test_account }, activeChars, guildState, guild.id);
      need(claims.scope !== 'guild' || access.isGuildMaster,'Only the verified Guild Master can run guild-wide sync uploads.');
      const stateForAuth = token.test_account
        ? guildState
        : {
            ...guildState,
            characters: [
              ...guildState.characters.filter(c => c.accountId !== claims.sub || scopedAcctChars.some(ac => ac.id === c.id)),
              ...scopedAcctChars
                .filter(ac => !guildState.characters.some(gc => gc.id === ac.id))
                .map(c => ({ ...c, accountId: claims.sub, active: true }))
            ]
          };
      authorizeSnapshot(value,{id:claims.sub},guild,stateForAuth,claims.scope);
      const claimedUpload = await db.query(
        'INSERT INTO sync_uploads(account_id,snapshot_id,digest) VALUES($1,$2,$3) ON CONFLICT(account_id,snapshot_id) DO NOTHING RETURNING snapshot_id',
        [claims.sub,value.snapshotId,digest]
      );
      if (!claimedUpload.rowCount) {
        const existing = (await db.query('SELECT digest FROM sync_uploads WHERE account_id=$1 AND snapshot_id=$2',[claims.sub,value.snapshotId])).rows[0];
        need(existing?.digest === digest,'This snapshot ID already contains different data.',409);
        return {ok:true,message:'This snapshot already synced.',duplicate:true};
      }
      const now = new Date().toISOString();
      const merged = mergeSnapshot(guildState,value,now,claims.sub);
      const saveOpts = claims.scope === 'member'
        ? { skipRanks: true, skipRoster: true, skipBanks: true, skipFavorites: true, onlyCharacterIds: merged.characters.filter(c => c.accountId === claims.sub).map(c => c.id) }
        : { skipFavorites: true, skipBanks: !Array.isArray(value.banks) || !value.banks.length, skipRoster: !value.roster, skipRanks: !value.roster };
      await saveGuildState(db, guild.id, merged, saveOpts);
      if (Array.isArray(value.banks) && value.banks.length) {
        await reconcileFulfilledRequests(db, guild.id, merged);
      }
      const { eligible: eligibleBankLog, skipped: skippedBankLog } = filterDesignatedBankLog(value.bankLog, guildState.designatedBanks);
      const beforeDonorReps = eligibleBankLog.length
        ? await captureBeforeDonorReps(db, guild.id, merged, eligibleBankLog)
        : new Map();
      let txImportResult = null;
      if (eligibleBankLog.length) {
        const ahCtx = prefetchedAhContext ?? await resolveGuildAhContext(db, guild);
        txImportResult = await importBankTransactions(db, guild.id, eligibleBankLog, guild.region, fetch, prefetchedPrices, ahCtx);
      }
      await db.query('UPDATE sync_tokens SET last_used_at=$1 WHERE id=$2',[now,claims.jti]);
      await queueSyncNotifications(db, guild, guildState, merged, txImportResult, beforeDonorReps, postCommit, origin);
      return {ok:true,message:'Snapshot synced.',...(skippedBankLog ? {skippedBankLog} : {})};
    });
    if (prefetchedCatalogItems.length && !txResult?.duplicate) {
      await saveFetchedCatalogItems(prefetchedCatalogItems);
    }
    if (postCommit.length) void Promise.allSettled(postCommit.map(fn => fn()));
    return txResult;
  }
  requireOrigin(request);
  const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
  const postCommit = [];
  const txResult = await transaction(async db => {
    const account = await getIdentity(request, db);
    need(account,'Sign in with Battle.net before syncing.',401);
    const initialAcctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[account.id])).rows;
    const activeGuildId = await resolveActiveGuildId(db, account, initialAcctChars);
    need(activeGuildId,'Select a verified guild character before syncing.',403);
    // Lock guilds FIRST, then re-read memberships and account_characters under the lock.
    const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[activeGuildId])).rows[0];
    need(guild,'Guild not found.',404);
    const member = (await db.query('SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true FOR SHARE',[account.id,activeGuildId])).rows[0];
    need(member,'Your guild access has ended.',403);
    account.role = member.role;
    const acctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[account.id])).rows;
    const guildState = await loadGuildState(db, guild.id, guild, { includeRequests: false });
    const activeGuildSlug = guild.id.startsWith('bnet:') ? guild.id.split(':').slice(2).join(':') : null;
    const scopedAcctChars = acctChars.filter(c => c.verified && matchesPortalGuild(c, activeGuildSlug, guild.region, guild.blizzard_guild_id));
    const guildChars = guildState.characters.filter(c => c.accountId === account.id && c.active !== false);
    const activeChars = account.testAccount ? guildChars : (scopedAcctChars.length ? scopedAcctChars : guildChars);
    const access = resolveAccess(account, activeChars, guildState, activeGuildId);
    const scope = access.isGuildMaster ? 'guild' : 'member';
    const stateForAuth = account.testAccount
      ? guildState
      : {
          ...guildState,
          characters: [
            ...guildState.characters.filter(c => c.accountId !== account.id || scopedAcctChars.some(ac => ac.id === c.id)),
            ...scopedAcctChars
              .filter(ac => !guildState.characters.some(gc => gc.id === ac.id))
              .map(c => ({ ...c, accountId: account.id, active: true }))
          ]
        };
    authorizeSnapshot(value, { id: account.id }, guild, stateForAuth, scope);
    const claimedUpload = await db.query(
      'INSERT INTO sync_uploads(account_id,snapshot_id,digest) VALUES($1,$2,$3) ON CONFLICT(account_id,snapshot_id) DO NOTHING RETURNING snapshot_id',
      [account.id,value.snapshotId,digest]
    );
    if (!claimedUpload.rowCount) {
      const existing = (await db.query('SELECT digest FROM sync_uploads WHERE account_id=$1 AND snapshot_id=$2',[account.id,value.snapshotId])).rows[0];
      need(existing?.digest === digest,'This snapshot ID already contains different data.',409);
      return {ok:true,message:'This snapshot already synced.',duplicate:true};
    }
    const now = new Date().toISOString();
    // Always merge into full guildState (not filtered stateForAuth) so existing titles/professions are never deleted.
    const merged = mergeSnapshot(guildState, value, now, account.id);
    const saveOpts = scope === 'member'
      ? { skipRanks: true, skipRoster: true, skipBanks: true, skipFavorites: true, onlyCharacterIds: merged.characters.filter(c => c.accountId === account.id).map(c => c.id) }
      : { skipFavorites: true, skipBanks: !Array.isArray(value.banks) || !value.banks.length, skipRoster: !value.roster, skipRanks: !value.roster };
    await saveGuildState(db, guild.id, merged, saveOpts);
    if (Array.isArray(value.banks) && value.banks.length) {
      await reconcileFulfilledRequests(db, guild.id, merged);
    }
    const { eligible: eligibleBankLog, skipped: skippedBankLog } = filterDesignatedBankLog(value.bankLog, guildState.designatedBanks);
    const beforeDonorReps = eligibleBankLog.length
      ? await captureBeforeDonorReps(db, guild.id, merged, eligibleBankLog)
      : new Map();
    let txImportResult = null;
    if (eligibleBankLog.length) {
      const ahCtx = prefetchedAhContext ?? await resolveGuildAhContext(db, guild);
      txImportResult = await importBankTransactions(db, guild.id, eligibleBankLog, guild.region, fetch, prefetchedPrices, ahCtx);
    }
    await queueSyncNotifications(db, guild, guildState, merged, txImportResult, beforeDonorReps, postCommit, origin);
    return {ok:true,message:'Snapshot synced.',...(skippedBankLog ? {skippedBankLog} : {})};
  });
  if (prefetchedCatalogItems.length && !txResult?.duplicate) {
    await saveFetchedCatalogItems(prefetchedCatalogItems);
  }
  if (postCommit.length) void Promise.allSettled(postCommit.map(fn => fn()));
  return txResult;
}
export async function handleGuildLogoUpload(request) {
  requireOrigin(request);
  const form = await request.formData();
  const file = form.get('logo');
  const logoNameRaw = form.get('logoName');
  const displayNameRaw = form.get('displayName');
  need(file && typeof file !== 'string' && typeof file.arrayBuffer === 'function','Choose an image file to upload.',400);
  need(file.size > 0 && file.size <= 5 * 1024 * 1024,'The logo image must be 5 MB or smaller.',413);
  const logoName = typeof logoNameRaw === 'string' ? logoNameRaw.trim() : '';
  const displayName = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : '';
  need(logoName.length <= 100 && !/[\x00-\x1f]/.test(logoName),'Enter a valid logo name.',400);
  need(displayName.length <= 100 && !/[\x00-\x1f]/.test(displayName),'Enter a valid guild display name.',400);
  const input = Buffer.from(await file.arrayBuffer());
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const sharpPath = require.resolve('sharp', { paths: [process.cwd() + '/node_modules/.pnpm/node_modules', process.cwd() + '/node_modules'] });
  const sharp = (await import(sharpPath)).default;
  let processed;
  try {
    processed = await sharp(input)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    throw new InputError('Upload a valid PNG, WebP, or JPEG image.', 400);
  }
  return transaction(async db => {
    const account = await getIdentity(request, db);
    need(account,'Sign in before uploading a guild logo.',401);
    const initialAcctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[account.id])).rows;
    const activeGuildId = await resolveActiveGuildId(db, account, initialAcctChars);
    need(activeGuildId,'Select a Guild Master character before uploading a guild logo.',403);
    const guild = (await db.query('SELECT id,name,display_name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[activeGuildId])).rows[0];
    need(guild,'Guild not found.',404);
    const member = (await db.query('SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true FOR SHARE',[account.id,activeGuildId])).rows[0];
    need(member,'Your guild access has ended.',403);
    account.role = member.role;
    const acctChars = (await db.query(`SELECT id,name,realm,region,level,guild_slug AS "guildSlug",guild_id AS "guildId",guild_rank AS "guildRank",guild_rank_index AS "guildRankIndex",is_main AS "isMain",verified FROM account_characters WHERE account_id=$1`,[account.id])).rows;
    const guildState = await loadGuildState(db, guild.id, guild, { includeRequests: false });
    const guildChars = guildState.characters.filter(c => c.accountId === account.id && c.active !== false);
    const access = resolveAccess(account, account.testAccount ? guildChars : (acctChars.length ? acctChars : guildChars), guildState, activeGuildId);
    need(access.isGuildMaster,'Only the Guild Master of this guild can upload its logo.',403);
    await db.query(
      'UPDATE guilds SET logo_bytes=$2,logo_mime=$3,logo_updated_at=now(),logo_name=COALESCE(NULLIF($4,\'\'),logo_name),display_name=COALESCE(NULLIF($5,\'\'),display_name) WHERE id=$1',
      [guild.id,processed,'image/webp',logoName,displayName]
    );
    return {ok:true,message:'Guild logo uploaded.'};
  });
}
export function jsonResponse(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store',...extra}});
}
export function errorResponse(error, request = null) {
  const requestId = randomUUID().slice(0, 8);
  if (error instanceof InputError) {
    return jsonResponse({
      ok: false,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.field ? { field: error.field } : {}),
      ...(error.details ? { details: error.details } : {}),
      status: error.status,
      requestId,
    }, error.status);
  }
  const route = request ? `${request.method} ${new URL(request.url).pathname}` : 'request';
  console.error(`[${requestId}] Unhandled error in ${route}:`, error instanceof Error ? (error.stack || error.message) : error);
  return jsonResponse({
    ok: false,
    code: 'SERVER_ERROR',
    message: `The server could not complete this request (ref: ${requestId}). Check server logs for details.`,
    status: 500,
    requestId,
  }, 500);
}
