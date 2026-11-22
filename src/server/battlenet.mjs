import { createHash } from 'node:crypto';
import { createSession, getIdentity, hash, opaque, requireOrigin, secureTransport, sessionCookie } from './auth.mjs';
import { getPool, transaction } from './db.mjs';
import { InputError, normalize } from './domain.mjs';
import { loadGuildState, replaceAccountCharacterProfessions, saveGuildState } from './guildStore.mjs';
const TERMS_VERSION = '2026-11-21';
const REGIONS = new Set(['us','eu','kr','tw']);
function oauthBase() { return (process.env.BNET_OAUTH_BASE || 'https://oauth.battle.net').replace(/\/+$/, ''); }
function apiBase(region) { return (process.env.BNET_API_BASE || `https://${region}.api.blizzard.com`).replace(/\/+$/, ''); }
function resolveClientIp(request, address) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  return (forwarded || realIp || address || '127.0.0.1').slice(0, 100);
}
function regionCode() {
  const value = (process.env.BNET_REGION || 'us').trim().toLowerCase();
  return REGIONS.has(value) ? value : 'us';
}
export function configuredGuildSlug() {
  const value = (process.env.BNET_GUILD_SLUG ?? 'band-of-the-helping-hand').trim().toLowerCase();
  return value || null;
}
function localized(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    if (typeof value.en_US === 'string' && value.en_US.trim()) return value.en_US.trim();
    const first = Object.values(value).find(v => typeof v === 'string' && v.trim());
    if (first) return first.trim();
  }
  return null;
}
function fullCharacterName(character) {
  const first = typeof character?.name === 'string' ? character.name.trim() : '';
  if (!first) return null;
  const surname = typeof character?.surname === 'string' ? character.surname.trim() : '';
  if (surname && !first.toLocaleLowerCase('en-US').endsWith(surname.toLocaleLowerCase('en-US'))) return `${first} ${surname}`;
  return first;
}
export function characterSlug(name) {
  return String(name).trim().toLocaleLowerCase('en-US').replace(/\s+/g, '-');
}
function positiveInt(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function positiveInt32(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647 ? value : null;
}
function nonNegInt32(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647 ? value : null;
}
export function parseBattleNetProfessionsDetailed(payload) {
  const list = [];
  const seenProfIds = new Set();
  const entryByProfId = new Map();
  const hasPrimaries = Array.isArray(payload?.primaries);
  const hasSecondaries = Array.isArray(payload?.secondaries);
  let complete = hasPrimaries && hasSecondaries;
  for (const [category, entries] of [['primary', payload?.primaries], ['secondary', payload?.secondaries]]) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        complete = false;
        continue;
      }
      const id = positiveInt32(entry?.profession?.id);
      if (id && seenProfIds.has(id)) {
        // Duplicate profession ID (regardless of whether the first or second entry lacked a name):
        // mark incomplete, invalidate any earlier entry's recipesKnown, and skip this duplicate.
        complete = false;
        const earlier = entryByProfId.get(id);
        if (earlier) {
          earlier.recipesKnown = false;
          earlier.recipes = [];
          earlier.recipeCount = 0;
        }
        continue;
      }
      if (id) seenProfIds.add(id);
      const name = localized(entry?.profession?.name);
      if (!id || !name) {
        complete = false;
        continue;
      }
      const hasTiers = Array.isArray(entry?.tiers);
      const tiers = hasTiers ? entry.tiers : [];
      const topTier = tiers.length ? tiers[tiers.length - 1] : null;
      const rank = nonNegInt32(topTier?.skill_points) ?? nonNegInt32(entry?.skill_points);
      const maxRank = nonNegInt32(topTier?.max_skill_points) ?? nonNegInt32(entry?.max_skill_points);
      const seenRecipes = new Set();
      const recipes = [];
      let recipesKnown = tiers.length > 0 && tiers.every(t => t && typeof t === 'object' && Array.isArray(t.known_recipes));
      for (const tier of tiers) {
        if (!tier || typeof tier !== 'object' || !Array.isArray(tier.known_recipes)) {
          recipesKnown = false;
          continue;
        }
        for (const r of tier.known_recipes) {
          const rid = positiveInt32(r?.id);
          const rname = localized(r?.name);
          if (!r || typeof r !== 'object' || !rid || !rname) {
            recipesKnown = false;
            continue;
          }
          if (seenRecipes.has(rid)) continue;
          seenRecipes.add(rid);
          recipes.push({ id: rid, name: rname.slice(0, 120), kind: 'spell' });
        }
      }
      const parsedEntry = {
        id,
        name: name.slice(0, 80),
        category,
        rank,
        maxRank,
        recipeCount: recipes.length,
        recipesKnown,
        recipes
      };
      entryByProfId.set(id, parsedEntry);
      list.push(parsedEntry);
    }
  }
  return { professions: list, complete };
}
export function parseBattleNetProfessions(payload) {
  return parseBattleNetProfessionsDetailed(payload).professions;
}
function extractBlizzardIdFromRowId(rowId) {
  if (typeof rowId !== 'string' || !rowId.startsWith('bnet:')) return null;
  const parts = rowId.split(':');
  const last = Number(parts[parts.length - 1]);
  return Number.isSafeInteger(last) && last > 0 ? last : null;
}
export function parseBattleNetCharacters(payload, region) {
  const accounts = Array.isArray(payload?.wow_accounts) ? payload.wow_accounts : [];
  const seen = new Set();
  const characters = [];
  for (const wowAccount of accounts) {
    const accountKey = positiveInt(wowAccount?.id);
    if (!accountKey) continue;
    const list = Array.isArray(wowAccount?.characters) ? wowAccount.characters : [];
    for (const character of list) {
      const name = fullCharacterName(character);
      if (!name) continue;
      const ruleset = localized(character.ruleset?.name) ?? (typeof character.ruleset?.slug === 'string' ? character.ruleset.slug : null);
      const realm = ruleset ?? localized(character.realm?.name) ?? (typeof character.realm?.slug === 'string' ? character.realm.slug : null) ?? `Forever (${region.toUpperCase()})`;
      const blizzardId = positiveInt(character.id);
      const id = blizzardId ? `bnet:${region}:${accountKey}:${blizzardId}` : `bnet:${region}:${normalize(realm)}:${normalize(name)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      characters.push({
        id,
        blizzardId,
        slug: (typeof character.slug === 'string' && character.slug.trim()) ? character.slug.trim().toLowerCase() : characterSlug(name),
        name: name.slice(0, 120),
        realm: realm.slice(0, 120),
        ruleset: ruleset ? ruleset.slice(0, 120) : null,
        region,
        namespace: `profile-forever-${region}`,
        level: Number.isSafeInteger(character.level) && character.level >= 1 && character.level <= 200 ? character.level : null,
        className: localized(character.playable_class?.name) ?? localized(character.character_class?.name),
        raceName: localized(character.playable_race?.name),
        faction: localized(character.faction?.name) ?? (typeof character.faction?.type === 'string' ? character.faction.type : null),
        guildName: null,
        guildSlug: null,
        guildId: null,
        guildRankIndex: null,
        guildRank: null,
        equippedItemLevel: null,
        averageItemLevel: null,
        lastLoginAt: null,
        professions: []
      });
    }
  }
  return characters;
}
export function safeLocalPath(raw, origin) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200 || !trimmed.startsWith('/') || trimmed.startsWith('//') || /[\\\r\n\x00-\x1f]/.test(trimmed)) {
    return null;
  }
  try {
    const base = origin || 'http://localhost';
    const parsed = new URL(trimmed, base);
    if (parsed.origin !== new URL(base).origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

async function fetchJsonDetailed(url, headers, fetcher) {
  try {
    const response = await fetcher(url, {headers,signal:AbortSignal.timeout(10000)});
    if (response.status === 404) return { ok: true, status: 404, data: null };
    if (!response.ok) return { ok: false, status: response.status, data: null };
    return { ok: true, status: response.status, data: await response.json() };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
async function fetchJson(url, headers, fetcher) {
  const res = await fetchJsonDetailed(url, headers, fetcher);
  return res.data;
}
export async function enrichBattleNetCharacters(characters, accessToken, region, fetcher = fetch) {
  const namespace = `profile-forever-${region}`;
  const headers = {authorization:`Bearer ${accessToken}`,accept:'application/json'};
  const base = apiBase(region);
  const qs = `namespace=${encodeURIComponent(namespace)}&locale=en_US`;
  const guilds = new Map();
  let hasProfileFailures = false;
  const candidates = characters.filter(c => (c.level ?? 0) >= 10).slice(0, 25);
  await Promise.all(candidates.map(async (character) => {
    const slug = encodeURIComponent(character.slug || characterSlug(character.name));
    const [profileRes, profsRes] = await Promise.all([
      fetchJsonDetailed(`${base}/profile/wow/character/${slug}?${qs}`, headers, fetcher),
      fetchJsonDetailed(`${base}/profile/wow/character/${slug}/professions?${qs}`, headers, fetcher)
    ]);
    if (!profileRes.ok) {
      character.profileFailed = true;
      hasProfileFailures = true;
    } else if (profileRes.status === 404) {
      character.profileChecked = true;
    }
    const profile = profileRes.data;
    let profileIdMatches = false;
    if (profile && typeof profile === 'object') {
      const profileCharId = positiveInt(profile.id);
      profileIdMatches = Boolean(character.blizzardId && profileCharId && profileCharId === character.blizzardId);
      if (profileIdMatches) {
        character.profileChecked = true;
        const ruleset = localized(profile.ruleset?.name);
        if (ruleset) {
          character.ruleset = ruleset.slice(0, 120);
          if (character.realm === `Forever (${region.toUpperCase()})`) character.realm = character.ruleset;
        }
        if (typeof profile.slug === 'string' && profile.slug.trim()) character.slug = profile.slug.trim().toLowerCase();
        if (typeof profile.equipped_item_level === 'number' && Number.isSafeInteger(profile.equipped_item_level)) character.equippedItemLevel = profile.equipped_item_level;
        if (typeof profile.average_item_level === 'number' && Number.isSafeInteger(profile.average_item_level)) character.averageItemLevel = profile.average_item_level;
        if (typeof profile.last_login_timestamp === 'number' && Number.isSafeInteger(profile.last_login_timestamp) && profile.last_login_timestamp > 0) {
          character.lastLoginAt = new Date(profile.last_login_timestamp).toISOString();
        }
        if (profile.guild && typeof profile.guild === 'object') {
          const gName = localized(profile.guild.name);
          const gSlug = typeof profile.guild.slug === 'string' ? profile.guild.slug.trim().toLowerCase() : null;
          const gId = positiveInt(profile.guild.id);
          if (gSlug && gId) {
            character.guildName = gName ? gName.slice(0, 120) : null;
            character.guildSlug = gSlug;
            character.guildId = gId;
            guilds.set(`${gSlug}:${gId}`, { name: character.guildName, slug: gSlug, id: gId });
          } else {
            character.guildName = null;
            character.guildSlug = null;
            character.guildId = null;
            character.profileGuildInvalid = true;
          }
        } else {
          // Verified profile explicitly has no guild object: do not let another character's roster grant guild membership/rank.
          character.guildName = null;
          character.guildSlug = null;
          character.guildId = null;
          character.profileGuildInvalid = true;
        }
      } else {
        // Mismatched or missing profile character ID: treat as failed lookup so prior membership is preserved (with rank cleared) instead of revoked.
        character.profileFailed = true;
        hasProfileFailures = true;
      }
    } else if (profileRes.ok && profileRes.status !== 404) {
      character.profileFailed = true;
      hasProfileFailures = true;
    }
    if (profileIdMatches && profsRes.ok && profsRes.data && typeof profsRes.data === 'object' && (Array.isArray(profsRes.data.primaries) || Array.isArray(profsRes.data.secondaries))) {
      const profCharId = positiveInt(profsRes.data?.character?.id);
      if (profCharId && profCharId === character.blizzardId) {
        const parsedProfs = parseBattleNetProfessionsDetailed(profsRes.data);
        character.profsChecked = true;
        character.profsComplete = parsedProfs.complete;
        character.professions = parsedProfs.professions;
      }
    }
  }));
  const rosters = new Map();
  const rosterGuildIdsBySlug = new Map();
  const slugGuildCounts = new Map();
  for (const g of guilds.values()) {
    slugGuildCounts.set(g.slug, (slugGuildCounts.get(g.slug) ?? 0) + 1);
  }
  await Promise.all([...guilds.values()].map(async (guild) => {
    if (!guild.id) return;
    const roster = await fetchJson(`${base}/data/wow/guild/${encodeURIComponent(guild.slug)}/roster?${qs}`, headers, fetcher);
    if (!Array.isArray(roster?.members)) return;
    // Always require a verified positive integer guild ID match before accepting the roster as authoritative.
    const rosterGuildId = positiveInt(roster?.guild?.id);
    if (!rosterGuildId || rosterGuildId !== guild.id) return;
    // Require every roster member to have a valid positive Blizzard character ID AND a non-empty name before treating the roster as authoritative.
    if (!roster.members.every(m => {
      const cid = positiveInt(m?.character?.id);
      return Boolean(m && typeof m === 'object' && m.character && typeof m.character === 'object' && cid && fullCharacterName(m.character));
    })) return;
    // Only store in slug-keyed rosters map when the slug maps to a single unambiguous guild ID in this refresh.
    if ((slugGuildCounts.get(guild.slug) ?? 0) === 1) {
      rosters.set(guild.slug, { guild, members: roster.members });
    }
    const idSet = rosterGuildIdsBySlug.get(guild.slug) ?? new Set();
    idSet.add(guild.id);
    rosterGuildIdsBySlug.set(guild.slug, idSet);
    const byId = new Map();
    for (const member of roster.members) {
      const rank = typeof member?.rank === 'number' && Number.isSafeInteger(member.rank) ? member.rank : null;
      const cid = positiveInt(member.character.id);
      if (cid) byId.set(cid, rank);
    }
    for (const character of characters) {
      // Require an exact stable Blizzard ID match on the authoritative roster AND no conflicting/invalid profile guild ID
      if (!character.blizzardId || !byId.has(character.blizzardId)) continue;
      if (character.profileGuildInvalid) continue;
      if (character.guildId && character.guildId !== guild.id) continue;
      const rank = byId.get(character.blizzardId);
      character.guildName = guild.name ?? character.guildName;
      character.guildSlug = guild.slug;
      character.guildId = guild.id;
      character.guildRankIndex = rank;
      character.guildRank = rank === 0 ? 'Guild Master' : rank !== null ? `Rank ${rank}` : null;
      character.confirmedByRoster = true;
    }
  }));
  // If a character's profile named a guild (matching both slug and guild ID) whose fresh roster excluded them, treat as confirmed departure
  for (const character of characters) {
    if (character.guildSlug && character.guildId && rosterGuildIdsBySlug.get(character.guildSlug)?.has(character.guildId) && !character.confirmedByRoster) {
      character.guildName = null;
      character.guildSlug = null;
      character.guildId = null;
      character.guildRankIndex = null;
      character.guildRank = null;
    }
  }
  return { characters, rosters, hasProfileFailures };
}
async function fetchBattleNetCharacters(accessToken, region, fetcher) {
  const namespace = `profile-forever-${region}`;
  const endpoint = `${apiBase(region)}/profile/user/wow?namespace=${encodeURIComponent(namespace)}&locale=en_US`;
  try {
    const response = await fetcher(endpoint, {headers:{authorization:`Bearer ${accessToken}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if (response.status === 404) return {ok:true,namespace,characters:[],rosters:new Map(),hasProfileFailures:false,error:null};
    if (!response.ok) return {ok:false,namespace,characters:[],rosters:new Map(),hasProfileFailures:true,error:`Battle.net character lookup returned HTTP ${response.status}. Try refreshing from Battle.net.`};
    const payload = await response.json();
    const validAccounts = Boolean(
      payload && typeof payload === 'object' && Array.isArray(payload.wow_accounts)
      && payload.wow_accounts.every(a => a && typeof a === 'object' && positiveInt(a.id) && Array.isArray(a.characters) && a.characters.every(c => {
        if (!c || typeof c !== 'object') return false;
        return Boolean(fullCharacterName(c) && positiveInt(c.id));
      }))
    );
    if (!validAccounts) {
      return {ok:false,namespace,characters:[],rosters:new Map(),hasProfileFailures:true,error:'Battle.net returned an incomplete character list. Try refreshing from Battle.net.'};
    }
    const characters = parseBattleNetCharacters(payload, region);
    const { rosters, hasProfileFailures } = await enrichBattleNetCharacters(characters, accessToken, region, fetcher);
    return {ok:true,namespace,characters,rosters,hasProfileFailures,error:null};
  } catch {
    return {ok:false,namespace,characters:[],rosters:new Map(),hasProfileFailures:true,error:'Battle.net character lookup could not be reached. Try refreshing from Battle.net.'};
  }
}
export async function syncBattleNetGuildMembership(db, accountId, region, characters, rosters = new Map(), { fetchStartedAt = new Date(), lockedGuilds = null } = {}) {
  const byGuild = new Map();
  for (const character of characters) {
    if (!character.guildSlug) continue;
    const list = byGuild.get(character.guildSlug) ?? [];
    list.push(character);
    byGuild.set(character.guildSlug, list);
  }
  const activeGuildIds = [...byGuild.keys()].map(slug => `bnet:${region}:${slug}`);
  const activeGuildSet = new Set(activeGuildIds);
  const rosterGuildIds = [...rosters.keys()].map(slug => `bnet:${region}:${slug}`);
  const existingMemRows = (await db.query(
    `SELECT guild_id FROM memberships WHERE account_id=$1 AND guild_id LIKE 'bnet:%' AND active=true`,
    [accountId]
  )).rows;
  const departedGuildIds = existingMemRows.map(r => r.guild_id).filter(gid => !activeGuildSet.has(gid));
  const now = new Date().toISOString();
  const allAffectedGuildIds = [...new Set([...activeGuildIds, ...departedGuildIds, ...rosterGuildIds])].sort();
  for (const guildRowId of allAffectedGuildIds) {
    let guildRow = lockedGuilds?.get(guildRowId) ?? null;
    if (!guildRow) {
      if (activeGuildSet.has(guildRowId)) {
        const guildSlug = guildRowId.split(':').slice(2).join(':');
        const matching = byGuild.get(guildSlug) ?? [];
        const primary = matching.find(c => c.guildRankIndex === 0) ?? matching[0];
        const guildName = primary?.guildName || guildSlug;
        const guildRealm = matching.find(c => c.ruleset)?.ruleset || primary?.realm || `Forever (${region.toUpperCase()})`;
        await db.query(
          `INSERT INTO guilds(id,name,realm,region) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
          [guildRowId,guildName,guildRealm,region]
        );
      }
      guildRow = (await db.query('SELECT id,name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,bnet_roster_synced_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[guildRowId])).rows[0];
    }
    if (!guildRow) continue;
    const guildSlug = guildRowId.split(':').slice(2).join(':');
    const storedBnetGuildId = guildRow.blizzard_guild_id !== null && guildRow.blizzard_guild_id !== undefined ? Number(guildRow.blizzard_guild_id) : null;
    const guildFresh = !guildRow.bnet_roster_synced_at || fetchStartedAt >= new Date(guildRow.bnet_roster_synced_at);
    const rosterEntry = rosters.get(guildSlug);
    const rosterGuildId = rosterEntry?.guild?.id ?? null;
    const rosterIdMatchesStored = !storedBnetGuildId || (rosterGuildId !== null && rosterGuildId === storedBnetGuildId);
    const rosterFresh = Boolean(guildFresh && rosterEntry && Array.isArray(rosterEntry.members) && rosterIdMatchesStored);
    const state = await loadGuildState(db, guildRowId, guildRow, { includeRequests: false });
    state.characters ??= [];
    state.roster ??= [];
    state.rankConfig ??= {};
    state.offers ??= {};

    const isActiveGuild = activeGuildSet.has(guildRowId);
    const allMatching = byGuild.get(guildSlug) ?? [];
    const fallbackPrimary = allMatching.find(c => c.guildRankIndex === 0 && c.guildId) ?? allMatching.find(c => c.guildId) ?? allMatching[0];
    // If this guild row is still unbound (blizzard_guild_id IS NULL), check whether verified characters in DB already
    // report multiple distinct Blizzard guild IDs for this slug+region; if ambiguous, refuse to auto-bind.
    let ambiguousUnbound = false;
    if (storedBnetGuildId === null) {
      const distinctIds = (await db.query(
        `SELECT DISTINCT guild_id FROM account_characters WHERE guild_slug=$1 AND region=$2 AND verified=true AND guild_id IS NOT NULL`,
        [guildSlug, region]
      )).rows.map(r => Number(r.guild_id)).filter(n => Number.isSafeInteger(n) && n > 0);
      if (distinctIds.length > 1) ambiguousUnbound = true;
    }
    // Bind strictly to ONE Blizzard guild ID (stored, else roster's, else primary character's) so characters from
    // two same-slug guilds with different Blizzard IDs are never mixed into the same portal guild.
    const effectiveBnetGuildId = ambiguousUnbound ? null : (storedBnetGuildId ?? rosterGuildId ?? fallbackPrimary?.guildId ?? null);
    const matching = effectiveBnetGuildId
      ? allMatching.filter(c => !c.guildId || Number(c.guildId) === Number(effectiveBnetGuildId))
      : (ambiguousUnbound ? [] : allMatching);
    const primary = matching.find(c => c.guildRankIndex === 0) ?? matching[0];
    const guildName = primary?.guildName || guildRow.name || guildSlug;
    const guildRealm = matching.find(c => c.ruleset)?.ruleset || primary?.realm || guildRow.realm || `Forever (${region.toUpperCase()})`;

    if (guildFresh) {
      if (!isActiveGuild || !matching.length) {
        // Deactivate membership both when departing the slug AND when the account's characters moved to a different Blizzard guild ID sharing the slug.
        await db.query(`UPDATE memberships SET active=false, role='member', primary_character_id=NULL WHERE account_id=$1 AND guild_id=$2`,[accountId,guildRowId]);
        for (const existingChar of state.characters) {
          if (existingChar.accountId === accountId) {
            existingChar.active = false;
            existingChar.verified = false;
          }
        }
      } else {
        await db.query('UPDATE guilds SET name=$2, realm=$3, blizzard_guild_id=COALESCE(blizzard_guild_id, $4) WHERE id=$1', [guildRowId, guildName, guildRealm, effectiveBnetGuildId]);
        const role = matching.some(c => c.guildRankIndex === 0) ? 'owner' : 'member';
        await db.query(
          `INSERT INTO memberships(account_id,guild_id,role,active) VALUES($1,$2,$3,true)
           ON CONFLICT(account_id,guild_id) DO UPDATE SET role=excluded.role,active=true`,
          [accountId,guildRowId,role]
        );
      }
    }

    let rosterChanged = false;
    if (rosterFresh) {
      await db.query('UPDATE guilds SET bnet_roster_synced_at=$2, blizzard_guild_id=COALESCE(blizzard_guild_id, $3) WHERE id=$1', [guildRowId, fetchStartedAt, rosterGuildId]);
      // Match existing verified guild characters strictly by stable Blizzard ID (never by realm+name alone).
      const existingByBlizzardId = new Map();
      for (const c of state.characters) {
        const bid = extractBlizzardIdFromRowId(c.id);
        if (bid && (!existingByBlizzardId.has(bid) || c.verified)) {
          existingByBlizzardId.set(bid, c);
        }
      }
      const rosterPresentIds = new Set();
      const rosterRankByBlizzardId = new Map();
      state.roster = rosterEntry.members.map(m => {
        const first = typeof m?.character?.name === 'string' ? m.character.name.trim() : '';
        const surname = typeof m?.character?.surname === 'string' ? m.character.surname.trim() : '';
        const name = surname && !first.toLocaleLowerCase('en-US').endsWith(surname.toLocaleLowerCase('en-US')) ? `${first} ${surname}` : first;
        const rankIndex = Number.isSafeInteger(m?.rank) ? m.rank : null;
        const cid = Number(m?.character?.id);
        if (Number.isSafeInteger(cid) && cid > 0) {
          rosterPresentIds.add(cid);
          if (rankIndex !== null) rosterRankByBlizzardId.set(cid, rankIndex);
        }
        const rankLabel = state.rankConfig[String(rankIndex)]?.name ?? (rankIndex === 0 ? 'Guild Master' : rankIndex !== null ? `Rank ${rankIndex}` : null);
        const existing = Number.isSafeInteger(cid) && cid > 0 ? existingByBlizzardId.get(cid) : null;
        return {
          id: existing?.id ?? `bnet:${region}:char:${cid}`,
          name,
          slug: (typeof m?.character?.slug === 'string' && m.character.slug.trim()) ? m.character.slug.trim().toLowerCase() : characterSlug(name),
          realm: guildRealm,
          level: Number.isSafeInteger(m?.character?.level) ? m.character.level : null,
          className: existing?.className ?? null,
          guildRankIndex: rankIndex,
          guildRank: rankLabel,
          verified: Boolean(existing?.verified),
          updatedAt: now
        };
      }).filter(r => r.name);

      // Reconcile ALL other linked accounts in this guild against the authoritative Battle.net roster,
      // scoped to matching blizzard guild_id so a same-slug guild with a different ID can never be cleared.
      const linkedChars = (await db.query(
        `SELECT id, account_id AS "accountId", blizzard_id AS "blizzardId"
         FROM account_characters
         WHERE guild_slug=$1 AND region=$2 AND verified=true AND account_id <> $3
           AND ($4::bigint IS NULL OR guild_id IS NULL OR guild_id = $4)`,
        [guildSlug, region, accountId, rosterGuildId]
      )).rows;
      const affectedAccounts = new Set();
      for (const lc of linkedChars) {
        affectedAccounts.add(lc.accountId);
        const bid = lc.blizzardId !== null ? Number(lc.blizzardId) : null;
        if (bid && Number.isSafeInteger(bid) && rosterPresentIds.has(bid)) {
          if (rosterRankByBlizzardId.has(bid)) {
            const newRank = rosterRankByBlizzardId.get(bid);
            const newRankLabel = newRank === 0 ? 'Guild Master' : `Rank ${newRank}`;
            await db.query(
              `UPDATE account_characters SET guild_rank_index=$2, guild_rank=$3, updated_at=now() WHERE id=$1`,
              [lc.id, newRank, newRankLabel]
            );
            const gc = state.characters.find(c => c.id === lc.id);
            if (gc) {
              gc.guildRankIndex = newRank;
              gc.guildRank = newRankLabel;
            }
          } else {
            // Character is present on roster but rank is missing: clear unverifiable elevated rank
            await db.query(
              `UPDATE account_characters SET guild_rank_index=NULL, guild_rank=NULL, updated_at=now() WHERE id=$1`,
              [lc.id]
            );
            const gc = state.characters.find(c => c.id === lc.id);
            if (gc) {
              gc.guildRankIndex = null;
              gc.guildRank = null;
            }
          }
        } else {
          // Confirmed absent from authoritative roster (or lacks verifiable Blizzard ID)
          await db.query(
            `UPDATE account_characters SET guild_name=NULL, guild_slug=NULL, guild_id=NULL, guild_rank_index=NULL, guild_rank=NULL, updated_at=now() WHERE id=$1`,
            [lc.id]
          );
          const gc = state.characters.find(c => c.id === lc.id);
          if (gc) {
            gc.active = false;
            gc.verified = false;
          }
        }
      }
      for (const otherAccountId of affectedAccounts) {
        const remaining = (await db.query(
          `SELECT id, guild_rank_index AS "guildRankIndex" FROM account_characters
           WHERE account_id=$1 AND guild_slug=$2 AND region=$3 AND verified=true
             AND ($4::bigint IS NULL OR guild_id IS NULL OR guild_id = $4)`,
          [otherAccountId, guildSlug, region, rosterGuildId]
        )).rows;
        if (!remaining.length) {
          await db.query(`UPDATE memberships SET active=false, role='member', primary_character_id=NULL WHERE account_id=$1 AND guild_id=$2`, [otherAccountId, guildRowId]);
        } else {
          const otherRole = remaining.some(r => r.guildRankIndex === 0) ? 'owner' : 'member';
          const remainingIds = remaining.map(r => r.id);
          await db.query(
            `UPDATE memberships SET role=$3, primary_character_id=CASE WHEN primary_character_id = ANY($4::text[]) THEN primary_character_id ELSE NULL END WHERE account_id=$1 AND guild_id=$2`,
            [otherAccountId, guildRowId, otherRole, remainingIds]
          );
        }
      }
    }

    if (isActiveGuild && guildFresh) {
      const confirmedIds = new Set(matching.map(c => c.id));
      const confirmedNorms = new Set(matching.map(c => normalize(c.name)));
      for (const existingChar of state.characters) {
        if (existingChar.accountId === accountId && !confirmedIds.has(existingChar.id) && !confirmedNorms.has(normalize(existingChar.name))) {
          existingChar.active = false;
          existingChar.verified = false;
        }
      }
      await db.query(
        `UPDATE memberships SET primary_character_id = NULL
         WHERE account_id=$1 AND guild_id=$2 AND primary_character_id IS NOT NULL AND NOT (primary_character_id = ANY($3::text[]))`,
        [accountId, guildRowId, [...confirmedIds]]
      );
      const fetchObsIso = fetchStartedAt instanceof Date ? fetchStartedAt.toISOString() : now;
      const fetchObsMs = fetchStartedAt instanceof Date ? fetchStartedAt.getTime() : Date.now();
      for (const char of matching) {
        // Match verified characters by stable ID or exact Blizzard ID alias only (never by name alone)
        const bnetAliasId = char.blizzardId ? `bnet:${region}:char:${char.blizzardId}` : null;
        let existing = state.characters.find(c => c.id === char.id)
          ?? (bnetAliasId ? state.characters.find(c => c.id === bnetAliasId) : null);
        if (!existing) {
          existing = {id:char.id,name:char.name,realm:char.realm || guildRealm,accountId,verified:true,active:true,isMain:false,titles:[],professions:[]};
          state.characters.push(existing);
        } else {
          existing.id = char.id;
          existing.name = char.name;
          existing.accountId = accountId;
          existing.verified = true;
          existing.active = true;
          existing.realm = char.realm || existing.realm;
        }
        // Keep roster entry ID aligned with the linked character ID to prevent duplicate rows on profession refresh
        if (bnetAliasId) {
          for (const r of state.roster) {
            if (r.id === bnetAliasId && r.id !== char.id) {
              r.id = char.id;
              rosterChanged = true;
            }
          }
          await db.query(
            `UPDATE guild_bank_contributions SET character_id=$3 WHERE guild_id=$1 AND character_id=$2`,
            [guildRowId, bnetAliasId, char.id]
          );
        }
        if (char.level !== null && char.level !== undefined) existing.level = char.level;
        if (char.className) existing.className = char.className;
        if (char.guildRank) existing.guildRank = char.guildRank;
        if (Number.isSafeInteger(char.guildRankIndex)) existing.guildRankIndex = char.guildRankIndex;
        if (char.profsChecked && Array.isArray(char.professions)) {
          const completeObsMs = Date.parse(existing.professionsCompleteObservedAt || '') || 0;
          const latestProfObsMs = Math.max(completeObsMs, ...(existing.professions ?? []).map(p => Date.parse(p.observedAt || p.updatedAt || '') || 0));
          if (fetchObsMs >= latestProfObsMs) {
            const oldProfs = new Map((existing.professions ?? []).map(p => [p.id, p]));
            const incomingProfs = char.professions.filter(p => p.id).map(p => {
              const prev = oldProfs.get(p.id);
              const recipes = p.recipesKnown
                ? (p.recipes ?? []).map(r => ({ ...r, offered: state.offers[`${existing.id}:${p.id}:${r.id}`] ?? false }))
                : (prev?.recipes ?? []);
              return {
                id: p.id,
                name: p.name,
                rank: p.rank ?? prev?.rank ?? 0,
                maxRank: p.maxRank ?? p.rank ?? prev?.maxRank ?? 0,
                updatedAt: now,
                observedAt: fetchObsIso,
                recipesKnown: p.recipesKnown,
                recipes
              };
            });
            if (char.profsComplete) {
              existing.professions = incomingProfs;
              existing.profsComplete = true;
              existing.professionsCompleteObservedAt = fetchObsIso;
            } else {
              const incomingIds = new Set(incomingProfs.map(p => p.id));
              existing.professions = [
                ...(existing.professions ?? []).filter(p => !incomingIds.has(p.id)),
                ...incomingProfs
              ];
            }
          }
        }
        existing.updatedAt = now;
      }
    }
    await saveGuildState(db, guildRowId, state, { skipRanks: true, skipBanks: true, skipFavorites: true, skipSyncs: true, skipRoster: !rosterFresh && !rosterChanged });
  }
}
export async function getBattleNetClientToken(fetcher = fetch) {
  const {BNET_CLIENT_ID:clientId,BNET_CLIENT_SECRET:clientSecret} = process.env;
  if (!clientId || !clientSecret) throw new InputError('Configure Battle.net credentials before refreshing guild professions.',503);
  const response = await fetcher(`${oauthBase()}/token`,{
    method:'POST',
    headers:{authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials',
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new InputError('Could not authenticate with Battle.net.',502);
  const payload = await response.json();
  if (typeof payload.access_token !== 'string') throw new InputError('Battle.net returned an invalid token.',502);
  return payload.access_token;
}
export async function fetchBattleNetGuildProfessions(roster, region, accessToken, fetcher = fetch) {
  const safeRegion = REGIONS.has(region) ? region : regionCode();
  const namespace = `profile-forever-${safeRegion}`;
  const headers = {authorization:`Bearer ${accessToken}`,accept:'application/json'};
  const base = apiBase(safeRegion);
  const qs = `namespace=${encodeURIComponent(namespace)}&locale=en_US`;
  const candidates = (roster ?? []).filter(m => (m.level ?? 0) >= 10);
  const fetched = [];
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = candidates.slice(i, i + 8);
    const results = await Promise.all(batch.map(async member => {
      const expectedBlizzardId = extractBlizzardIdFromRowId(member.id);
      if (!expectedBlizzardId) return { member, profs: null, profsComplete: false };
      const slug = encodeURIComponent(member.slug || characterSlug(member.name));
      const profs = await fetchJson(`${base}/profile/wow/character/${slug}/professions?${qs}`, headers, fetcher);
      const hasPrimary = Array.isArray(profs?.primaries);
      const hasSecondary = Array.isArray(profs?.secondaries);
      const respCharId = positiveInt(profs?.character?.id);
      const idMatches = Boolean(respCharId && respCharId === expectedBlizzardId);
      const valid = idMatches && profs && typeof profs === 'object' && (hasPrimary || hasSecondary);
      if (!valid) return { member, profs: null, profsComplete: false };
      const parsed = parseBattleNetProfessionsDetailed(profs);
      return { member, profs: parsed.professions, profsComplete: parsed.complete };
    }));
    for (const r of results) {
      if (r.profs && (r.profs.length > 0 || r.profsComplete)) fetched.push(r);
    }
  }
  return fetched;
}
export async function applyBattleNetGuildProfessions(db, guildId, fetchedResults = [], fetchStartedAt = new Date()) {
  const guildRow = (await db.query('SELECT id,name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at FROM guilds WHERE id=$1 FOR UPDATE',[guildId])).rows[0];
  if (!guildRow) throw new InputError('Guild not found.',404);
  const state = await loadGuildState(db, guildRow.id, guildRow, { includeRequests: false });
  state.characters ??= [];
  state.offers ??= {};
  for (const char of state.characters) for (const prof of char.professions ?? []) for (const recipe of prof.recipes ?? []) {
    if (recipe.offered) state.offers[`${char.id}:${prof.id}:${recipe.id}`] = true;
  }
  const rosterById = new Map((state.roster ?? []).map(r => [r.id, r]));
  const now = new Date().toISOString();
  const fetchObsIso = fetchStartedAt instanceof Date ? fetchStartedAt.toISOString() : now;
  const fetchMs = fetchStartedAt instanceof Date ? fetchStartedAt.getTime() : Date.now();
  const updatedIds = [];
  for (const { member, profs, profsComplete } of fetchedResults) {
    if (!profs || (!profs.length && !profsComplete)) continue;
    // Match strictly to the current roster under the guild lock (never create rows for departed members or overwrite ranks)
    const currentRoster = rosterById.get(member.id);
    if (!currentRoster) continue;
    let char = state.characters.find(c => c.id === currentRoster.id);
    if (char && char.active === false) continue;
    if (!char) {
      char = {
        id: currentRoster.id,
        name: currentRoster.name,
        realm: currentRoster.realm || guildRow.realm,
        accountId: null,
        level: currentRoster.level ?? null,
        className: currentRoster.className ?? null,
        guildRank: currentRoster.guildRank ?? null,
        guildRankIndex: currentRoster.guildRankIndex ?? null,
        verified: false,
        active: true,
        isMain: false,
        titles: [],
        professions: []
      };
      state.characters.push(char);
    }
    const completeObsMs = Date.parse(char.professionsCompleteObservedAt || '') || 0;
    const latestProfObsMs = Math.max(completeObsMs, ...(char.professions ?? []).map(p => Date.parse(p.observedAt || p.updatedAt || '') || 0));
    if (latestProfObsMs > fetchMs) continue;
    const prevById = new Map((char.professions ?? []).map(p => [p.id, p]));
    const incomingProfs = profs.filter(p => p.id).map(p => {
      const prev = prevById.get(p.id);
      const recipes = p.recipesKnown
        ? (p.recipes ?? []).map(r => ({ ...r, offered: state.offers[`${char.id}:${p.id}:${r.id}`] ?? false }))
        : (prev?.recipes ?? []);
      return {
        id: p.id,
        name: p.name,
        rank: p.rank ?? prev?.rank ?? 0,
        maxRank: p.maxRank ?? p.rank ?? prev?.maxRank ?? 0,
        updatedAt: now,
        observedAt: fetchObsIso,
        recipesKnown: p.recipesKnown,
        recipes
      };
    });
    if (profsComplete) {
      char.professions = incomingProfs;
      char.profsComplete = true;
      char.professionsCompleteObservedAt = fetchObsIso;
    } else {
      const incomingIds = new Set(incomingProfs.map(p => p.id));
      char.professions = [
        ...(char.professions ?? []).filter(p => !incomingIds.has(p.id)),
        ...incomingProfs
      ];
    }
    char.updatedAt = now;
    updatedIds.push(char.id);
  }
  if (updatedIds.length) {
    await saveGuildState(db, guildRow.id, state, {
      skipRanks: true,
      skipRoster: true,
      skipBanks: true,
      skipFavorites: true,
      skipSyncs: true,
      onlyCharacterIds: updatedIds,
    });
  }
  return updatedIds.length;
}
export async function syncBattleNetGuildProfessions(db, guildId, accessToken, fetcher = fetch) {
  const guildRow = (await db.query('SELECT id,name,realm,region FROM guilds WHERE id=$1',[guildId])).rows[0];
  if (!guildRow) throw new InputError('Guild not found.',404);
  const state = await loadGuildState(db, guildRow.id, guildRow);
  const fetched = await fetchBattleNetGuildProfessions(state.roster ?? [], guildRow.region, accessToken, fetcher);
  return applyBattleNetGuildProfessions(db, guildId, fetched);
}
function configuration(request) {
  secureTransport(request);
  const {BNET_CLIENT_ID:clientId,BNET_CLIENT_SECRET:clientSecret,BNET_REDIRECT_URI:redirectUri} = process.env;
  if (!clientId || !clientSecret || !redirectUri) throw new InputError('Configure Battle.net credentials before signing in.',503);
  const redirect = new URL(redirectUri);
  if (redirect.origin !== (process.env.APP_ORIGIN || new URL(request.url).origin) || redirect.pathname !== '/auth/callback') throw new InputError('Correct the Battle.net callback address in the server setup.',503);
  return {clientId,clientSecret,redirectUri};
}
function stateCookie(value,request,seconds=600) {
  return `hh_oauth=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function beginBattleNet(request, address) {
  const config = configuration(request);
  const state = opaque();
  const reqUrl = new URL(request.url);
  const desktopChallenge = reqUrl.searchParams.get('desktop_challenge');
  const desktopHash = desktopChallenge && /^[A-Za-z0-9_-]{43}$/.test(desktopChallenge) ? hash(desktopChallenge) : null;
  const agreedTerms = reqUrl.searchParams.get('terms') === '1';
  const existingUser = await getIdentity(request).catch(() => null);
  if (!agreedTerms && !existingUser) {
    throw new InputError('You must agree to the Terms & Conditions and Privacy Policy before signing in.', 400);
  }
  const agreedIp = resolveClientIp(request, address);
  const origin = process.env.APP_ORIGIN || reqUrl.origin;
  const rawNext = reqUrl.searchParams.get('next') ?? '';
  const returnTo = safeLocalPath(rawNext, origin);
  await getPool().query('DELETE FROM oauth_states WHERE expires_at<now()');
  await getPool().query('DELETE FROM desktop_auth_handoffs WHERE expires_at<now()');
  const stateHash = hash(state);
  await getPool().query(
    'INSERT INTO oauth_states(id_hash,expires_at,desktop_state_hash,return_to,agreed_terms,agreed_ip) VALUES($1,$2,$3,$4,$5,$6)',
    [stateHash,new Date(Date.now()+600000),desktopHash,returnTo,agreedTerms,agreedIp]
  );
  if (desktopHash) {
    await getPool().query(
      'INSERT INTO desktop_auth_handoffs(state_hash,oauth_state_hash,expires_at) VALUES($1,$2,$3) ON CONFLICT(state_hash) DO UPDATE SET oauth_state_hash=excluded.oauth_state_hash,session_token=NULL,account_id=NULL,pending_account_id=NULL,confirm_token_hash=NULL,expires_at=excluded.expires_at',
      [desktopHash,stateHash,new Date(Date.now()+300000)]
    );
  }
  const url = new URL(`${oauthBase()}/authorize`);
  url.search = new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'openid wow.profile',state}).toString();
  return new Response(null,{status:302,headers:{location:url.href,'set-cookie':stateCookie(state,request),'cache-control':'no-store'}});
}
export async function finishBattleNet(request, fetcher = fetch, address) {
  const config = configuration(request);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const saved = (request.headers.get('cookie') ?? '').split(';').map(v=>v.trim()).find(v=>v.startsWith('hh_oauth='))?.slice('hh_oauth='.length);
  if (!state || !saved || state !== saved || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new InputError('Battle.net login expired. Start again.',403);
  const oauthStateHash = hash(state);
  const result = await getPool().query('DELETE FROM oauth_states WHERE id_hash=$1 AND expires_at>now() RETURNING id_hash,desktop_state_hash,return_to,agreed_terms,agreed_ip',[oauthStateHash]);
  if (!result.rowCount) throw new InputError('Battle.net login expired. Start again.',403);
  const desktopStateHash = result.rows[0].desktop_state_hash ?? null;
  const returnTo = result.rows[0].return_to ?? null;
  const agreedTerms = Boolean(result.rows[0].agreed_terms);
  const agreedIp = result.rows[0].agreed_ip || resolveClientIp(request, address);
  const code = url.searchParams.get('code');
  if (!code || code.length>2048 || url.searchParams.has('error')) throw new InputError('Battle.net did not authorize this login.',403);
  const response = await fetcher(`${oauthBase()}/token`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.redirectUri}),signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new InputError('Battle.net could not complete this login. Start again.',502);
  const token = await response.json();
  if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') throw new InputError('Battle.net returned an invalid login response.',502);
  const profileResponse = await fetcher(`${oauthBase()}/userinfo`,{headers:{authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
  if (!profileResponse.ok) throw new InputError('Battle.net could not verify this identity.',502);
  const profile = await profileResponse.json();
  const subject = profile.sub ?? profile.id;
  if (!/^\d+$/.test(String(subject)) || typeof profile.battletag !== 'string' || profile.battletag.length > 200) throw new InputError('Battle.net returned an invalid identity.',502);
  const region = regionCode();
  const accountId = `bnet:${subject}`;
  if (!agreedTerms) {
    // Verify consent against the target Battle.net subject (not just the browser session that initiated OAuth)
    // before any account creation, update, session issuance, or desktop handoff.
    const existingAcct = (await getPool().query('SELECT terms_agreed_at FROM accounts WHERE id=$1', [accountId])).rows[0];
    if (!existingAcct?.terms_agreed_at) {
      throw new InputError('You must agree to the Terms & Conditions and Privacy Policy before signing in with this Battle.net account.', 403);
    }
  }
  const fetchStartedAt = new Date();
  // Bump monotonic account sync generation BEFORE fetching Battle.net so an older refresh can never overwrite a newer one.
  const genRow = (await getPool().query(
    `INSERT INTO accounts(id,battle_tag,test_account,terms_agreed_at,terms_agreed_ip,terms_version,bnet_sync_gen)
     VALUES($1,$2,false,$3,$4,$5,1)
     ON CONFLICT(id) DO UPDATE SET
       battle_tag=excluded.battle_tag,
       terms_agreed_at=COALESCE(excluded.terms_agreed_at, accounts.terms_agreed_at),
       terms_agreed_ip=COALESCE(excluded.terms_agreed_ip, accounts.terms_agreed_ip),
       terms_version=COALESCE(excluded.terms_version, accounts.terms_version),
       bnet_sync_gen=accounts.bnet_sync_gen + 1
     RETURNING bnet_sync_gen`,
    [accountId,profile.battletag,agreedTerms ? new Date() : null,agreedTerms ? agreedIp : null,agreedTerms ? TERMS_VERSION : null]
  )).rows[0];
  const expectedGen = Number(genRow?.bnet_sync_gen ?? 1);
  const characterSync = await fetchBattleNetCharacters(token.access_token, region, fetcher);
  const desktopConfirmToken = desktopStateHash ? opaque() : null;
  const session = await transaction(async db => {
    if (characterSync.ok) {
      // Lock ALL affected guilds in deterministic sorted ID order FIRST, BEFORE locking accounts or writing character rows.
      const prevGuildRows = (await db.query(
        `SELECT DISTINCT guild_id FROM memberships WHERE account_id=$1 AND guild_id LIKE 'bnet:%' AND active=true`,
        [accountId]
      )).rows;
      const incomingGuildIds = [...new Set([
        ...characterSync.characters.filter(c => c.guildSlug).map(c => `bnet:${region}:${c.guildSlug}`),
        ...[...characterSync.rosters.keys()].map(slug => `bnet:${region}:${slug}`)
      ])];
      const allGuildIds = [...new Set([...prevGuildRows.map(r => r.guild_id), ...incomingGuildIds])].sort();
      const lockedGuilds = new Map();
      for (const gid of allGuildIds) {
        if (incomingGuildIds.includes(gid)) {
          const slug = gid.split(':').slice(2).join(':');
          const matchChar = characterSync.characters.find(c => c.guildSlug === slug);
          // Do not bind blizzard_guild_id before verifying isCurrentGen and guildFresh under the lock.
          await db.query(
            `INSERT INTO guilds(id,name,realm,region) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
            [gid, matchChar?.guildName || slug, matchChar?.ruleset || matchChar?.realm || `Forever (${region.toUpperCase()})`, region]
          );
        }
        const gRow = (await db.query('SELECT id,name,realm,region,motd_text,motd_updated_at,motd_updated_by,guild_info_text,guild_info_updated_at,guild_info_updated_by,roster_captured_at,guild_meta_captured_at,bnet_roster_synced_at,blizzard_guild_id FROM guilds WHERE id=$1 FOR UPDATE',[gid])).rows[0];
        if (gRow) lockedGuilds.set(gid, gRow);
      }
      const acctLockRow = (await db.query('SELECT id, bnet_sync_gen AS "syncGen" FROM accounts WHERE id=$1 FOR NO KEY UPDATE', [accountId])).rows[0];
      const isCurrentGen = Number(acctLockRow?.syncGen ?? 0) === expectedGen;
      if (isCurrentGen) {
        const prevCharsRows = (await db.query(
          'SELECT id, guild_name, guild_slug, guild_id, guild_rank_index, guild_rank, is_main FROM account_characters WHERE account_id=$1',
          [accountId]
        )).rows;
        const prevById = new Map(prevCharsRows.map(r => [r.id, r]));
        const existingMainRow = prevCharsRows.find(r => r.is_main)?.id ?? null;
        for (const character of characterSync.characters) {
          const prev = prevById.get(character.id);
          // 1. If a locked guild already has a NEWER authoritative roster observation, preserve existing DB guild/rank
          //    so a delayed login callback can never restore revoked Guild Master or officer access.
          const candidateGuildIds = [
            character.guildSlug ? `bnet:${region}:${character.guildSlug}` : null,
            prev?.guild_slug ? `bnet:${region}:${prev.guild_slug}` : null,
          ].filter(Boolean);
          const blockedByNewerGuild = candidateGuildIds.some(gid => {
            const gRow = lockedGuilds.get(gid);
            return Boolean(gRow?.bnet_roster_synced_at && fetchStartedAt < new Date(gRow.bnet_roster_synced_at));
          });
          if (blockedByNewerGuild) {
            if (prev) {
              character.guildName = prev.guild_name;
              character.guildSlug = prev.guild_slug;
              character.guildId = prev.guild_id !== null && prev.guild_id !== undefined ? Number(prev.guild_id) : null;
              character.guildRankIndex = prev.guild_rank_index;
              character.guildRank = prev.guild_rank;
            } else {
              // Newly linked character on a delayed login: never insert stale guild/rank data over a newer roster
              character.guildName = null;
              character.guildSlug = null;
              character.guildId = null;
              character.guildRankIndex = null;
              character.guildRank = null;
            }
            continue;
          }
          // 2. If profile wasn't checked or failed transiently, preserve membership ONLY (never preserve unverifiable elevated rank)
          if ((!character.profileChecked || character.profileFailed) && !character.guildSlug && prev?.guild_slug) {
            const rosterForPrev = characterSync.rosters.get(prev.guild_slug);
            const rosterMatchesPrevGuild = Boolean(rosterForPrev && (!prev.guild_id || Number(rosterForPrev.guild?.id) === Number(prev.guild_id)));
            const excludedByRoster = Boolean(rosterMatchesPrevGuild && !character.confirmedByRoster);
            if (!excludedByRoster) {
              character.guildName = prev.guild_name;
              character.guildSlug = prev.guild_slug;
              character.guildId = prev.guild_id !== null && prev.guild_id !== undefined ? Number(prev.guild_id) : null;
              character.guildRankIndex = null;
              character.guildRank = null;
            }
          }
        }
        const keepIds = characterSync.characters.map(c => c.id);
        const preferredSlug = configuredGuildSlug();
        const sortedChars = [...characterSync.characters].sort((a, b) =>
          Number(Boolean(preferredSlug && b.guildSlug === preferredSlug)) - Number(Boolean(preferredSlug && a.guildSlug === preferredSlug))
          || Number(Boolean(b.guildSlug)) - Number(Boolean(a.guildSlug))
          || (b.level ?? 0) - (a.level ?? 0)
          || a.name.localeCompare(b.name)
        );
        const existingMain = (existingMainRow && keepIds.includes(existingMainRow))
          ? existingMainRow
          : (sortedChars[0]?.id ?? null);
        if (keepIds.length) {
          await db.query('DELETE FROM account_characters WHERE account_id=$1 AND namespace=$2 AND NOT (id = ANY($3::text[]))',[accountId,characterSync.namespace,keepIds]);
        } else {
          await db.query('DELETE FROM account_characters WHERE account_id=$1 AND namespace=$2',[accountId,characterSync.namespace]);
        }
        await db.query('UPDATE account_characters SET is_main=false WHERE account_id=$1 AND is_main=true', [accountId]);
        for (const character of characterSync.characters) {
          await db.query(
            `INSERT INTO account_characters(id,account_id,blizzard_id,slug,name,realm,ruleset,region,namespace,level,class_name,race_name,faction,guild_name,guild_slug,guild_id,guild_rank_index,guild_rank,equipped_item_level,average_item_level,last_login_at,is_main,verified,verified_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,false,true,now(),now())
             ON CONFLICT(id) DO UPDATE SET
               account_id=excluded.account_id,
               blizzard_id=excluded.blizzard_id,
               slug=excluded.slug,
               name=excluded.name,
               realm=excluded.realm,
               ruleset=excluded.ruleset,
               region=excluded.region,
               namespace=excluded.namespace,
               level=excluded.level,
               class_name=excluded.class_name,
               race_name=excluded.race_name,
               faction=excluded.faction,
               guild_name=excluded.guild_name,
               guild_slug=excluded.guild_slug,
               guild_id=excluded.guild_id,
               guild_rank_index=excluded.guild_rank_index,
               guild_rank=excluded.guild_rank,
               equipped_item_level=excluded.equipped_item_level,
               average_item_level=excluded.average_item_level,
               last_login_at=excluded.last_login_at,
               verified=true,
               verified_at=now(),
               updated_at=now()`,
            [character.id,accountId,character.blizzardId,character.slug,character.name,character.realm,character.ruleset,character.region,character.namespace,character.level,character.className,character.raceName,character.faction,character.guildName,character.guildSlug,character.guildId,character.guildRankIndex,character.guildRank,character.equippedItemLevel,character.averageItemLevel,character.lastLoginAt]
          );
          if (character.profsChecked) {
            await replaceAccountCharacterProfessions(db, character.id, character.professions ?? [], { complete: Boolean(character.profsComplete) });
          }
        }
        if (existingMain) {
          await db.query('UPDATE account_characters SET is_main=true WHERE id=$1 AND account_id=$2', [existingMain, accountId]);
        }
        await db.query('UPDATE accounts SET characters_synced_at=now(),characters_sync_error=NULL WHERE id=$1',[accountId]);
        await syncBattleNetGuildMembership(db, accountId, region, characterSync.characters, characterSync.rosters, { fetchStartedAt, lockedGuilds });
      }
    } else {
      await db.query('UPDATE accounts SET characters_sync_error=$2 WHERE id=$1 AND bnet_sync_gen=$3',[accountId,characterSync.error,expectedGen]);
    }
    if (desktopStateHash && desktopConfirmToken) {
      // Bind strictly to the current OAuth attempt (oauth_state_hash) and require user-entered pairing code via POST /auth/desktop-confirm
      await db.query(
        'UPDATE desktop_auth_handoffs SET pending_account_id=$2, confirm_token_hash=$3, account_id=NULL, session_token=NULL WHERE state_hash=$1 AND oauth_state_hash=$4 AND expires_at>now()',
        [desktopStateHash, accountId, hash(desktopConfirmToken), oauthStateHash]
      );
      return null;
    }
    return await createSession(db,accountId);
  });
  if (desktopStateHash && desktopConfirmToken) {
    const safeTag = profile.battletag.replace(/[<>&"]/g, '');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Confirm desktop sign-in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15130f;color:#eedcaa;font-family:Georgia,serif}main{max-width:460px;padding:32px;border:1px solid #6b5837;border-top:3px solid #c7a35e;background:#1e1a13;text-align:center}p{color:#c4b69a;font-family:system-ui,sans-serif;line-height:1.6}input{display:block;margin:14px auto 0;padding:10px 14px;width:180px;text-align:center;font:700 18px/1.2 monospace;letter-spacing:0.18em;text-transform:uppercase;background:#15130f;border:1px solid #6b5837;color:#eedcaa}button{margin-top:16px;padding:11px 22px;background:#c7a35e;color:#17130d;border:1px solid #e6c987;font:700 14px/1.2 system-ui,sans-serif;cursor:pointer}</style></head><body><main><h1>Approve desktop sign-in</h1><p>Enter the 6-character pairing code shown in the Helping Hand desktop app to sign in as <strong>${safeTag}</strong>:</p><form method="POST" action="/auth/desktop-confirm"><input type="hidden" name="token" value="${desktopConfirmToken}" /><input type="text" name="code" maxlength="6" minlength="6" required autocomplete="off" placeholder="A1B2C3" aria-label="Desktop pairing code" /><button type="submit">Approve desktop sign-in</button></form></main></body></html>`;
    const confirmCookie = `hh_desktop_confirm=${desktopConfirmToken}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=300${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
    const headers = new Headers({'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'strict-origin'});
    headers.append('set-cookie',stateCookie('',request,0));
    headers.append('set-cookie',confirmCookie);
    return new Response(html,{status:200,headers});
  }
  const safeDest = safeLocalPath(returnTo, process.env.APP_ORIGIN || url.origin) || '/account';
  const headers = new Headers({location:safeDest,'cache-control':'no-store'});
  headers.append('set-cookie',sessionCookie(session,request));
  headers.append('set-cookie',stateCookie('',request,0));
  return new Response(null,{status:302,headers});
}
async function readBoundedJson(request, limit = 4096) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) throw new InputError('Expected application/json.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('Provide a JSON request.', 400);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new InputError('The request exceeds the size limit.', 413);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError('Invalid JSON request.', 400);
  }
}

export async function confirmDesktopLogin(request) {
  secureTransport(request);
  requireOrigin(request);
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/x-www-form-urlencoded')) throw new InputError('Expected form submission.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('Missing confirmation token.', 400);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 4096) {
      await reader.cancel();
      throw new InputError('The request exceeds the size limit.', 413);
    }
    chunks.push(Buffer.from(value));
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const formToken = (params.get('token') ?? '').trim();
  const submittedCode = (params.get('code') ?? '').trim().toUpperCase();
  const cookieToken = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('hh_desktop_confirm='))?.slice('hh_desktop_confirm='.length) ?? '';
  if (!formToken || formToken !== cookieToken || !/^[A-Za-z0-9_-]{43}$/.test(formToken)) {
    throw new InputError('Desktop sign-in confirmation expired. Start again from the desktop app.', 403);
  }
  if (!/^[A-F0-9]{6}$/.test(submittedCode)) {
    throw new InputError('Enter the 6-character pairing code shown in the desktop app.', 400);
  }
  const updated = await getPool().query(
    `UPDATE desktop_auth_handoffs
     SET account_id = pending_account_id, pending_account_id = NULL, confirm_token_hash = NULL
     WHERE confirm_token_hash = $1 AND pending_account_id IS NOT NULL AND expires_at > now()
       AND upper(left(state_hash, 6)) = $2
     RETURNING state_hash`,
    [hash(formToken), submittedCode]
  );
  if (!updated.rowCount) {
    throw new InputError('The pairing code did not match or the sign-in expired. Check the code in the desktop app and try again.', 403);
  }
  const clearCookie = `hh_desktop_confirm=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Desktop sign-in approved</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15130f;color:#eedcaa;font-family:Georgia,serif}main{max-width:460px;padding:32px;border:1px solid #6b5837;border-top:3px solid #c7a35e;background:#1e1a13;text-align:center}p{color:#c4b69a;font-family:system-ui,sans-serif;line-height:1.6}</style></head><body><main><h1>Desktop sign-in approved</h1><p>You can close this browser tab and return to the Helping Hand desktop app.</p></main></body></html>`;
  const headers = new Headers({'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  headers.append('set-cookie', clearCookie);
  return new Response(html, { status: 200, headers });
}

export async function claimDesktopLogin(request) {
  secureTransport(request);
  const body = await readBoundedJson(request, 4096);
  const desktopVerifier = typeof body?.desktopVerifier === 'string' ? body.desktopVerifier : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(desktopVerifier)) throw new InputError('Invalid desktop login verifier.', 400);
  const challenge = createHash('sha256').update(desktopVerifier, 'utf8').digest('base64url');
  const sessionToken = await transaction(async db => {
    await db.query('DELETE FROM desktop_auth_handoffs WHERE expires_at<now()');
    const claimed = await db.query(
      'DELETE FROM desktop_auth_handoffs WHERE state_hash=$1 AND account_id IS NOT NULL AND expires_at>now() RETURNING account_id',
      [hash(challenge)]
    );
    if (!claimed.rowCount) return null;
    return createSession(db, claimed.rows[0].account_id);
  });
  if (sessionToken) {
    return new Response(JSON.stringify({ok:true,pending:false,session:sessionToken}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  return new Response(JSON.stringify({ok:true,pending:true}),{status:202,headers:{'content-type':'application/json','cache-control':'no-store'}});
}
