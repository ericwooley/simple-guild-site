import { randomUUID } from 'node:crypto';
import { getPool } from './db.mjs';
import { sendGuildEmail } from './email.mjs';
import { formatCopper } from './itemPrices.mjs';
import { donationHonorPoints, helpingPointsForLevel, reputationStanding } from './reputation.mjs';
import { normalize } from './domain.mjs';

const STANDING_ORDER = ['Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];

function baseOrigin(origin) {
  return (origin || process.env.APP_ORIGIN || 'http://localhost:4321').replace(/\/+$/, '');
}

async function accountById(db, accountId) {
  if (!accountId) return null;
  const row = (await db.query(
    `SELECT id, email, email_verified AS "emailVerified", email_opted_out AS "emailOptedOut", battle_tag AS "battleTag"
     FROM accounts WHERE id=$1`,
    [accountId]
  )).rows[0];
  return row ?? null;
}

function parseBnetGuildId(guildId) {
  if (typeof guildId !== 'string' || !guildId.startsWith('bnet:')) return { region: null, guildSlug: null };
  const parts = guildId.split(':');
  return { region: parts[1] || null, guildSlug: parts.slice(2).join(':') || null };
}

async function accountForCharacter(db, guildId, characterId, characterName) {
  const norm = normalize(characterName || '');
  const { region, guildSlug } = parseBnetGuildId(guildId);
  const rows = (await db.query(
    `SELECT DISTINCT a.id, a.email, a.email_verified AS "emailVerified", a.email_opted_out AS "emailOptedOut", a.battle_tag AS "battleTag"
     FROM memberships m
     JOIN accounts a ON a.id = m.account_id
     WHERE m.guild_id = $1 AND m.active = true
       AND (
         EXISTS (
           SELECT 1 FROM guild_characters gc
           WHERE gc.guild_id=$1 AND gc.account_id=a.id AND gc.active=true
             AND (gc.id=$2 OR ($3 <> '' AND lower(btrim(gc.name))=$3))
         )
         OR (
           $4::text IS NOT NULL AND EXISTS (
             SELECT 1 FROM account_characters ac
             WHERE ac.account_id=a.id AND ac.verified=true AND ac.guild_slug=$4
               AND ($5::text IS NULL OR ac.region=$5)
               AND (ac.id=$2 OR ($3 <> '' AND lower(btrim(ac.name))=$3))
           )
         )
       )
     ORDER BY a.id ASC
     LIMIT 1`,
    [guildId, characterId || '', norm, guildSlug, region]
  )).rows;
  return rows[0] ?? null;
}

async function guildMemberAccounts(db, guildId, excludeAccountId = null) {
  return (await db.query(
    `SELECT a.id, a.email, a.email_verified AS "emailVerified", a.email_opted_out AS "emailOptedOut", a.battle_tag AS "battleTag"
     FROM memberships m
     JOIN accounts a ON a.id=m.account_id
     WHERE m.guild_id=$1 AND m.active=true
       AND ($2::text IS NULL OR a.id <> $2)`,
    [guildId, excludeAccountId]
  )).rows;
}

async function bankApproverAccounts(db, guildId, _state, excludeAccountId = null) {
  const { region, guildSlug } = parseBnetGuildId(guildId);
  // Query live guild_ranks + memberships + verified main character in one SQL query so revoked permissions never receive notes.
  return (await db.query(
    `SELECT DISTINCT a.id, a.email, a.email_verified AS "emailVerified", a.email_opted_out AS "emailOptedOut", a.battle_tag AS "battleTag"
     FROM memberships m
     JOIN accounts a ON a.id=m.account_id
     WHERE m.guild_id=$1 AND m.active=true
       AND ($2::text IS NULL OR a.id <> $2)
       AND (
         (
           $3::text IS NOT NULL AND EXISTS (
             SELECT 1 FROM account_characters ac
             LEFT JOIN guild_ranks gr ON gr.guild_id=$1 AND gr.rank_index=ac.guild_rank_index
             WHERE ac.account_id=a.id AND ac.verified=true AND ac.is_main=true AND ac.guild_slug=$3
               AND ($4::text IS NULL OR ac.region=$4)
               AND (ac.guild_rank_index = 0 OR gr.approve_bank_requests = true)
           )
         )
         OR (
           $3::text IS NULL AND (
             m.role = 'owner'
             OR EXISTS (
               SELECT 1 FROM guild_characters gc
               LEFT JOIN guild_ranks gr ON gr.guild_id=$1 AND gr.rank_index=gc.guild_rank_index
               WHERE gc.guild_id=$1 AND gc.account_id=a.id AND gc.active=true AND gc.verified=true AND gc.is_main=true
                 AND (gc.guild_rank_index = 0 OR gr.approve_bank_requests = true)
             )
           )
         )
       )`,
    [guildId, excludeAccountId, guildSlug, region]
  )).rows;
}

async function deliverNotification(db, { account, guildId = null, subject, title, paragraphs = [], ctaLabel = '', ctaUrl = '', link = '', footer = '' }) {
  if (!account?.id) return;
  const body = paragraphs.filter(Boolean).join('\n');
  try {
    await db.query(
      `INSERT INTO account_notifications(id, account_id, guild_id, title, body, link) VALUES($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), account.id, guildId, title, body, link || null]
    );
  } catch (err) {
    console.error('Failed to persist in-app notification:', err instanceof Error ? err.message : err);
  }
  if (account.email && account.emailVerified && !account.emailOptedOut) {
    await sendGuildEmail({ to: account.email, subject, title, paragraphs, ctaLabel, ctaUrl, footer });
  }
}

export async function getCharacterReputation(db, guildId, characterId, characterName) {
  const norm = normalize(characterName || '');
  const commRow = (await db.query(
    `SELECT COALESCE(sum(r.points_awarded), 0)::int AS points
     FROM guild_commendation_recipients r
     JOIN guild_commendations c ON c.guild_id = r.guild_id AND c.id = r.commendation_id
     WHERE r.guild_id=$1 AND c.deleted_at IS NULL AND (r.character_id=$2 OR lower(btrim(r.character_name))=$3)`,
    [guildId, characterId || '', norm]
  )).rows[0];
  const donRow = (await db.query(
    `SELECT COALESCE(sum(total_vendor_copper), 0)::numeric::text AS copper FROM guild_bank_transactions WHERE guild_id=$1 AND is_donation=true AND lower(btrim(actor_name))=$2`,
    [guildId, norm]
  )).rows[0];
  const manualRow = (await db.query(
    `SELECT COALESCE(sum(copper), 0)::numeric::text AS copper FROM guild_bank_contributions WHERE guild_id=$1 AND (($2 <> '' AND character_id=$2) OR (character_id IS NULL AND $3 <> '' AND lower(btrim(character_name))=$3))`,
    [guildId, characterId || '', norm]
  )).rows[0];
  const totalCopperBig = BigInt(donRow?.copper ?? '0') + BigInt(manualRow?.copper ?? '0');
  const clampedCopper = totalCopperBig > 0n ? totalCopperBig : 0n;
  const helpingPts = Number(commRow?.points ?? 0);
  const donationPts = donationHonorPoints(clampedCopper);
  return reputationStanding(helpingPts + donationPts);
}

export async function notifyBankRequestSubmitted({ guildId, guildName, itemName, quantity, characterName, note, requesterAccountId, state, origin }) {
  const db = getPool();
  const approvers = await bankApproverAccounts(db, guildId, state, requesterAccountId);
  const link = '/bank?tab=requests';
  const url = `${baseOrigin(origin)}${link}`;
  const paragraphs = [
    `${characterName} requested ${quantity}x ${itemName} from the ${guildName} guild bank.`,
    ...(note ? [`Reason: "${note}"`] : []),
  ];
  await Promise.allSettled(approvers.map(a => deliverNotification(db, {
    account: a,
    guildId,
    subject: `[${guildName}] New bank request: ${quantity}x ${itemName}`,
    title: 'New guild bank request',
    paragraphs,
    ctaLabel: 'Review bank requests',
    ctaUrl: url,
    link,
    footer: `You received this because you can approve bank requests for ${guildName}. Manage email preferences on My account.`,
  })));
}

export async function notifyBankRequestStatus({ guildId = null, accountId, guildName, itemName, quantity, characterName, status, origin }) {
  const db = getPool();
  const recipient = await accountById(db, accountId);
  if (!recipient) return;
  const labelMap = { approved: 'approved', declined: 'declined', fulfilled: 'marked fulfilled' };
  const titleMap = { approved: 'Bank request approved', declined: 'Bank request declined', fulfilled: 'Bank request fulfilled' };
  const verb = labelMap[status] || status;
  const link = '/bank?tab=requests';
  const url = `${baseOrigin(origin)}${link}`;
  await deliverNotification(db, {
    account: recipient,
    guildId,
    subject: `[${guildName}] Bank request ${verb}: ${quantity}x ${itemName}`,
    title: titleMap[status] || 'Bank request updated',
    paragraphs: [
      `Your bank request for ${quantity}x ${itemName} (${characterName}) has been ${verb}.`,
    ],
    ctaLabel: 'View your requests',
    ctaUrl: url,
    link,
    footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
  });
}

export async function notifyHelpingHand({ guildId, guildName, recipients = [], authorName, message, origin }) {
  const db = getPool();
  const seenAccounts = new Set();
  for (const target of recipients) {
    const acct = await accountForCharacter(db, guildId, target.id, target.name);
    if (!acct || seenAccounts.has(acct.id)) continue;
    seenAccounts.add(acct.id);
    const link = `/character/${encodeURIComponent(target.id)}`;
    const url = `${baseOrigin(origin)}${link}`;
    await deliverNotification(db, {
      account: acct,
      guildId,
      subject: `[${guildName}] ${authorName} thanked ${target.name}`,
      title: `${authorName} thanked ${target.name}`,
      paragraphs: [
        `"${message}"`,
      ],
      ctaLabel: 'View character profile',
      ctaUrl: url,
      link,
      footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
    });
  }
}

export async function notifyReputationPromotion({ guildId, guildName, characterId, characterName, oldStanding, newStanding, newPoints, origin }) {
  if (!oldStanding || !newStanding) return;
  const oldIdx = STANDING_ORDER.indexOf(oldStanding);
  const newIdx = STANDING_ORDER.indexOf(newStanding);
  if (newIdx <= oldIdx) return;
  const db = getPool();
  const acct = await accountForCharacter(db, guildId, characterId, characterName);
  if (!acct) return;
  const link = characterId ? `/character/${encodeURIComponent(characterId)}` : '/roster';
  const url = `${baseOrigin(origin)}${link}`;
  await deliverNotification(db, {
    account: acct,
    guildId,
    subject: `[${guildName}] ${characterName} reached ${newStanding}!`,
    title: `Guild reputation: ${newStanding}`,
    paragraphs: [
      `Congratulations! ${characterName} advanced from ${oldStanding} to ${newStanding} (${newPoints} points) in ${guildName}.`,
    ],
    ctaLabel: 'View character profile',
    ctaUrl: url,
    link,
    footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
  });
}

export async function notifyTitleAssigned({ guildId, guildName, characterId, characterName, title, origin }) {
  const db = getPool();
  const acct = await accountForCharacter(db, guildId, characterId, characterName);
  if (!acct) return;
  const link = `/character/${encodeURIComponent(characterId)}`;
  const url = `${baseOrigin(origin)}${link}`;
  await deliverNotification(db, {
    account: acct,
    guildId,
    subject: `[${guildName}] New guild title: ${title}`,
    title: 'Guild profession title assigned',
    paragraphs: [
      `${characterName} has been designated as "${title}" in ${guildName}.`,
    ],
    ctaLabel: 'View character profile',
    ctaUrl: url,
    link,
    footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
  });
}

export async function notifyManualContribution({ guildId, guildName, characterId, characterName, copper, reason, awardedByName, origin }) {
  if (!copper || copper <= 0) return;
  const db = getPool();
  const acct = await accountForCharacter(db, guildId, characterId, characterName);
  if (!acct) return;
  const link = `/character/${encodeURIComponent(characterId)}`;
  const url = `${baseOrigin(origin)}${link}`;
  await deliverNotification(db, {
    account: acct,
    guildId,
    subject: `[${guildName}] Bank contribution awarded: ${formatCopper(copper)}`,
    title: `Bank contribution: ${formatCopper(copper)}`,
    paragraphs: [
      `${awardedByName} recorded a bank contribution of ${formatCopper(copper)} for ${characterName}.`,
      `Reason: ${reason}`,
    ],
    ctaLabel: 'View character profile',
    ctaUrl: url,
    link,
    footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
  });
}

export async function notifyNewsPublished({ guildId, guildName, newsId, title, excerpt, authorName, authorAccountId, origin }) {
  const db = getPool();
  const members = await guildMemberAccounts(db, guildId, authorAccountId);
  const link = `/news/${encodeURIComponent(newsId)}`;
  const url = `${baseOrigin(origin)}${link}`;
  const preview = excerpt.length > 260 ? `${excerpt.slice(0, 257).trimEnd()}…` : excerpt;
  await Promise.allSettled(members.map(m => deliverNotification(db, {
    account: m,
    guildId,
    subject: `[${guildName}] Guild news: ${title}`,
    title: `Guild news: ${title}`,
    paragraphs: [
      `Published by ${authorName}:`,
      preview,
    ],
    ctaLabel: 'Read full post',
    ctaUrl: url,
    link,
    footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
  })));
}

export async function notifyFavoritesRestocked({ guildId, guildName, restockedItems = [], origin }) {
  if (!restockedItems.length) return;
  const db = getPool();
  const keys = restockedItems.map(i => i.itemKey);
  const rows = (await db.query(
    `SELECT f.account_id AS "accountId", f.item_key AS "itemKey", a.email, a.email_verified AS "emailVerified", a.email_opted_out AS "emailOptedOut", a.battle_tag AS "battleTag"
     FROM guild_bank_favorites f
     JOIN memberships m ON m.guild_id = f.guild_id AND m.account_id = f.account_id AND m.active = true
     JOIN accounts a ON a.id = f.account_id
     WHERE f.guild_id=$1 AND f.item_key = ANY($2::text[])`,
    [guildId, keys]
  )).rows;
  if (!rows.length) return;
  const byKey = new Map(restockedItems.map(i => [i.itemKey, i]));
  const byAccount = new Map();
  for (const r of rows) {
    const entry = byAccount.get(r.accountId) ?? {
      account: { id: r.accountId, email: r.email, emailVerified: r.emailVerified, emailOptedOut: r.emailOptedOut, battleTag: r.battleTag },
      items: []
    };
    const item = byKey.get(r.itemKey);
    if (item) entry.items.push(item);
    byAccount.set(r.accountId, entry);
  }
  const link = '/bank?favorites=1';
  const url = `${baseOrigin(origin)}${link}`;
  await Promise.allSettled([...byAccount.values()].map(entry => {
    const lines = entry.items.slice(0, 10).map(i => `• ${i.name}: now ${i.afterCount} in stock (+${i.afterCount - i.beforeCount})`);
    return deliverNotification(db, {
      account: entry.account,
      guildId,
      subject: `[${guildName}] Favorite bank ${entry.items.length === 1 ? 'item' : 'items'} restocked`,
      title: 'Favorite bank items restocked',
      paragraphs: [
        'Items on your guild bank favorites list have been restocked:',
        ...lines,
      ],
      ctaLabel: 'View your favorites',
      ctaUrl: url,
      link,
      footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
    });
  }));
}

export async function notifyNewDonations({ guildId, guildName, newDonations = [], origin }) {
  if (!newDonations.length) return;
  const db = getPool();
  const byActor = new Map();
  for (const d of newDonations) {
    const norm = normalize(d.actorName);
    if (!norm) continue;
    const entry = byActor.get(norm) ?? { actorName: d.actorName, items: [], totalCopper: 0 };
    entry.items.push(d);
    entry.totalCopper += Number(d.totalVendorCopper ?? 0);
    byActor.set(norm, entry);
  }
  const link = '/bank?tab=history';
  const url = `${baseOrigin(origin)}${link}`;
  for (const entry of byActor.values()) {
    const acct = await accountForCharacter(db, guildId, '', entry.actorName);
    if (!acct) continue;
    const lines = entry.items.slice(0, 12).map(d =>
      d.txType === 'money-deposit'
        ? `• ${formatCopper(d.moneyCopper)} to ${d.bankName}`
        : `• ${d.itemName || 'Item'}${d.quantity > 1 ? ` ×${d.quantity}` : ''} to ${d.bankName}${d.totalVendorCopper > 0 ? ` (${formatCopper(d.totalVendorCopper)})` : ''}`
    );
    const totalLine = entry.totalCopper > 0 ? `Total value recorded: ${formatCopper(entry.totalCopper)}.` : '';
    await deliverNotification(db, {
      account: acct,
      guildId,
      subject: `[${guildName}] Thank you for your bank donation!`,
      title: 'New guild bank donation recorded',
      paragraphs: [
        `Thank you, ${entry.actorName}! Your guild bank donation has been recorded:`,
        ...lines,
        ...(totalLine ? [totalLine] : []),
      ],
      ctaLabel: 'View donation history',
      ctaUrl: url,
      link,
      footer: `Guild notifications for ${guildName}. Manage email preferences on My account.`,
    });
  }
}
