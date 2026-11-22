import { createHash } from 'node:crypto';
import { getPool, transaction } from './db.mjs';
import { getBattleNetClientToken } from './battlenet.mjs';

const NPC_SENDERS = new Set([
  'alliance auction house',
  'horde auction house',
  'blackwater auction house',
  'auction house',
  'the postmaster',
  'postmaster',
  'blizzard customer support'
]);

export function isNpcMailSender(name) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return true;
  return NPC_SENDERS.has(trimmed) || trimmed.includes('auction house');
}

export function formatCopper(copper) {
  let total = 0n;
  if (typeof copper === 'bigint') {
    total = copper > 0n ? copper : 0n;
  } else if (typeof copper === 'string' && /^-?\d+$/.test(copper.trim())) {
    const parsed = BigInt(copper.trim());
    total = parsed > 0n ? parsed : 0n;
  } else {
    const num = Math.max(0, Math.floor(Number(copper) || 0));
    total = BigInt(Number.isFinite(num) ? num : 0);
  }
  if (total === 0n) return '0c';
  const g = total / 10000n;
  const s = (total % 10000n) / 100n;
  const c = total % 100n;
  const parts = [];
  if (g > 0n) parts.push(`${g}g`);
  if (s > 0n || (g > 0n && c > 0n)) parts.push(`${s}s`);
  if (c > 0n || parts.length === 0) parts.push(`${c}c`);
  return parts.join(' ');
}

export function transactionId(guildId, entry, occurrenceIndex = 0) {
  const raw = JSON.stringify([
    guildId,
    entry.type,
    entry.bankName || '',
    entry.actorName || '',
    entry.itemId ?? null,
    entry.suffixId ?? 0,
    entry.quantity ?? 0,
    entry.moneyCopper ?? 0,
    entry.occurredAt,
    entry.requestId ?? null,
    occurrenceIndex
  ]);
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export async function saveFetchedCatalogItems(fetched = []) {
  if (!Array.isArray(fetched) || !fetched.length) return;
  const sorted = [...fetched].sort((a, b) => a.itemId - b.itemId);
  await transaction(async db => {
    for (const item of sorted) {
      await db.query(
        `INSERT INTO item_catalog(item_id, name, sell_price_copper, quality, item_class, item_subclass, inventory_type, item_level, required_level, fetched_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT(item_id) DO UPDATE SET
           name=excluded.name,
           sell_price_copper=excluded.sell_price_copper,
           quality=COALESCE(excluded.quality, item_catalog.quality),
           item_class=COALESCE(excluded.item_class, item_catalog.item_class),
           item_subclass=COALESCE(excluded.item_subclass, item_catalog.item_subclass),
           inventory_type=COALESCE(excluded.inventory_type, item_catalog.inventory_type),
           item_level=COALESCE(excluded.item_level, item_catalog.item_level),
           required_level=COALESCE(excluded.required_level, item_catalog.required_level),
           fetched_at=now()`,
        [item.itemId, item.name, item.sellPrice, item.quality, item.itemClass, item.itemSubclass, item.inventoryType, item.itemLevel, item.requiredLevel]
      );
    }
  });
}

export async function prefetchVendorPrices(itemIds, region = 'us', fetcher = fetch, { requireMetadata = false, deferCatalogWrite = false } = {}) {
  const uniqueIds = [...new Set((itemIds ?? []).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  if (!uniqueIds.length) return deferCatalogWrite ? { priceMap: new Map(), fetchedItems: [] } : new Map();

  const existingRes = await getPool().query(
    `SELECT item_id, sell_price_copper, item_class FROM item_catalog WHERE item_id = ANY($1::int[])`,
    [uniqueIds]
  );
  const priceMap = new Map(existingRes.rows.map(r => [r.item_id, r.sell_price_copper]));
  const hasMeta = new Set(existingRes.rows.filter(r => r.item_class !== null).map(r => r.item_id));
  const missing = uniqueIds.filter(id => !priceMap.has(id) || (requireMetadata && !hasMeta.has(id)));
  if (!missing.length) return deferCatalogWrite ? { priceMap, fetchedItems: [] } : priceMap;
  if (!process.env.BNET_CLIENT_ID || !process.env.BNET_CLIENT_SECRET) return deferCatalogWrite ? { priceMap, fetchedItems: [] } : priceMap;

  let token;
  try {
    token = await getBattleNetClientToken(fetcher);
  } catch {
    return deferCatalogWrite ? { priceMap, fetchedItems: [] } : priceMap;
  }

  const safeRegion = ['us', 'eu', 'kr', 'tw'].includes(region) ? region : 'us';
  const namespaces = [`static-forever-${safeRegion}`, `static-classic1x-${safeRegion}`];
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const fetched = [];

  for (let i = 0; i < missing.length; i += 10) {
    const batch = missing.slice(i, i + 10);
    const results = await Promise.all(batch.map(async itemId => {
      for (const namespace of namespaces) {
        try {
          const apiBase = (process.env.BNET_API_BASE || `https://${safeRegion}.api.blizzard.com`).replace(/\/+$/, '');
          const res = await fetcher(
            `${apiBase}/data/wow/item/${itemId}?namespace=${encodeURIComponent(namespace)}&locale=en_US`,
            { headers, signal: AbortSignal.timeout(8000) }
          );
          if (!res.ok) continue;
          const data = await res.json();
          return {
            itemId,
            name: typeof data?.name === 'string' ? data.name : `Item #${itemId}`,
            sellPrice: Number.isSafeInteger(data?.sell_price) && data.sell_price >= 0 ? data.sell_price : 0,
            quality: typeof data?.quality?.name === 'string' ? data.quality.name : null,
            itemClass: typeof data?.item_class?.name === 'string' ? data.item_class.name : null,
            itemSubclass: typeof data?.item_subclass?.name === 'string' ? data.item_subclass.name : null,
            inventoryType: typeof data?.inventory_type?.name === 'string' ? data.inventory_type.name : null,
            itemLevel: Number.isSafeInteger(data?.level) ? data.level : null,
            requiredLevel: Number.isSafeInteger(data?.required_level) ? data.required_level : null
          };
        } catch {
          continue;
        }
      }
      return null;
    }));
    for (const item of results) {
      if (item) {
        priceMap.set(item.itemId, item.sellPrice);
        fetched.push(item);
      }
    }
  }

  if (deferCatalogWrite) {
    return { priceMap, fetchedItems: fetched };
  }
  await saveFetchedCatalogItems(fetched);
  return priceMap;
}

export async function lookupMissingVendorPrices(db, itemIds, region = 'us', fetcher = fetch, { requireMetadata = false } = {}) {
  return prefetchVendorPrices(itemIds, region, fetcher, { requireMetadata });
}

export async function importBankTransactions(db, guildId, rawEntries = [], region = 'us', fetcher = fetch, prefetchedPrices = null) {
  if (!Array.isArray(rawEntries) || !rawEntries.length) return { imported: 0, priced: 0 };

  const normalized = [];
  const seenCounts = new Map();

  for (const raw of rawEntries) {
    const type = typeof raw?.type === 'string' ? raw.type.trim() : '';
    if (!['deposit','withdraw','money-deposit','money-withdraw','requested','mailed','handed','cancelled','reopened'].includes(type)) continue;
    const bankName = (typeof raw.bankName === 'string' ? raw.bankName : typeof raw.name === 'string' ? raw.name : '').trim();
    if (!bankName) continue;
    const ts = Number.isSafeInteger(raw.ts) && raw.ts > 0 ? raw.ts : null;
    if (!ts) continue;
    const occurredAt = new Date(ts * 1000).toISOString();

    let actorName = null;
    if (type === 'deposit' || type === 'money-deposit') {
      actorName = typeof raw.from === 'string' && raw.from.trim() ? raw.from.trim() : (typeof raw.actorName === 'string' && raw.actorName.trim() ? raw.actorName.trim() : null);
    } else if (type === 'withdraw' || type === 'money-withdraw' || type === 'mailed' || type === 'handed' || type === 'cancelled' || type === 'reopened') {
      actorName = typeof raw.to === 'string' && raw.to.trim() ? raw.to.trim() : (typeof raw.actorName === 'string' && raw.actorName.trim() ? raw.actorName.trim() : null);
    } else if (type === 'requested') {
      actorName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (typeof raw.actorName === 'string' && raw.actorName.trim() ? raw.actorName.trim() : null);
    }

    const itemId = Number.isSafeInteger(raw.itemId) && raw.itemId > 0 ? raw.itemId : (Number.isSafeInteger(raw.itemID) && raw.itemID > 0 ? raw.itemID : null);
    const suffixId = Number.isSafeInteger(raw.suffixId) ? raw.suffixId : (Number.isSafeInteger(raw.suffixID) ? raw.suffixID : 0);
    const itemName = (typeof raw.itemName === 'string' ? raw.itemName : typeof raw.item === 'string' ? raw.item : '').trim() || (itemId ? `Item #${itemId}` : null);
    const quantity = Number.isSafeInteger(raw.quantity) && raw.quantity >= 0 ? raw.quantity : (Number.isSafeInteger(raw.count) && raw.count >= 0 ? raw.count : 0);
    const moneyCopper = Number.isSafeInteger(raw.moneyCopper) && raw.moneyCopper >= 0 ? raw.moneyCopper : (Number.isSafeInteger(raw.money) && raw.money >= 0 ? raw.money : 0);
    const hintVendor = Number.isSafeInteger(raw.vendorPrice) && raw.vendorPrice >= 0 ? raw.vendorPrice : null;
    const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 300) : null;
    const requestId = typeof raw.requestId === 'string' && raw.requestId.trim() ? raw.requestId.trim() : null;

    const isDonation = (type === 'deposit' || type === 'money-deposit') && Boolean(actorName) && !isNpcMailSender(actorName);

    const baseKey = JSON.stringify([type, bankName, actorName, itemId, suffixId, quantity, moneyCopper, occurredAt, requestId]);
    const occ = seenCounts.get(baseKey) ?? 0;
    seenCounts.set(baseKey, occ + 1);

    const entry = {
      type,
      bankName: type === 'requested' && typeof raw.to === 'string' && raw.to.trim() ? raw.to.trim() : bankName,
      actorName,
      itemId,
      suffixId,
      itemName,
      quantity,
      moneyCopper,
      hintVendor,
      isDonation,
      note,
      requestId,
      occurredAt
    };
    entry.id = transactionId(guildId, entry, occ);
    normalized.push(entry);
  }

  const itemIdsToPrice = normalized.map(e => e.itemId).filter(Boolean);
  // Only use verified Battle.net / item_catalog vendor prices for valuation and reputation.
  // Never credit untrusted client hintVendor values toward ledger totals or reputation.
  const priceMap = prefetchedPrices ?? await lookupMissingVendorPrices(db, itemIdsToPrice, region, fetcher);

  let imported = 0;
  const newDonations = [];
  for (const e of normalized) {
    const unitVendor = e.itemId ? (priceMap.get(e.itemId) ?? null) : null;
    const totalVendorBig = e.type === 'money-deposit' || e.type === 'money-withdraw'
      ? BigInt(e.moneyCopper)
      : (unitVendor !== null ? BigInt(unitVendor) * BigInt(e.quantity) : 0n);
    const totalVendor = Number(totalVendorBig);

    const res = await db.query(
      `INSERT INTO guild_bank_transactions(id, guild_id, tx_type, bank_name, actor_name, item_id, suffix_id, item_name, quantity, money_copper, unit_vendor_copper, total_vendor_copper, is_donation, note, occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::bigint,$13,$14,$15)
       ON CONFLICT(id) DO UPDATE SET
         unit_vendor_copper = COALESCE(guild_bank_transactions.unit_vendor_copper, excluded.unit_vendor_copper),
         total_vendor_copper = CASE WHEN guild_bank_transactions.unit_vendor_copper IS NULL AND excluded.unit_vendor_copper IS NOT NULL THEN excluded.total_vendor_copper ELSE guild_bank_transactions.total_vendor_copper END
       RETURNING (xmax = 0) AS inserted`,
      [e.id, guildId, e.type, e.bankName, e.actorName, e.itemId, e.suffixId, e.itemName, e.quantity, e.moneyCopper, unitVendor, totalVendorBig.toString(), e.isDonation, e.note, e.occurredAt]
    );
    if (res.rowCount) imported += 1;
    if (res.rows[0]?.inserted && e.isDonation && e.actorName) {
      newDonations.push({
        actorName: e.actorName,
        txType: e.type,
        bankName: e.bankName,
        itemName: e.itemName,
        quantity: e.quantity,
        moneyCopper: e.moneyCopper,
        totalVendorCopper: totalVendor,
      });
    }
  }

  return { imported, priced: priceMap.size, newDonations };
}

export async function refreshGuildTransactionPrices(db, guildId, region = 'us', fetcher = fetch, prefetchedPrices = null) {
  let priceMap = prefetchedPrices;
  if (!priceMap) {
    const txRows = (await db.query(
      `SELECT DISTINCT item_id FROM guild_bank_transactions WHERE guild_id=$1 AND item_id IS NOT NULL`,
      [guildId]
    )).rows;
    const stockRows = (await db.query(
      `SELECT DISTINCT item_id FROM guild_bank_items WHERE guild_id=$1 AND item_id IS NOT NULL`,
      [guildId]
    )).rows;
    const itemIds = [...new Set([...txRows.map(r => r.item_id), ...stockRows.map(r => r.item_id)])];
    priceMap = await lookupMissingVendorPrices(db, itemIds, region, fetcher, { requireMetadata: true });
  }
  let updated = 0;
  for (const [itemId, sellPrice] of priceMap.entries()) {
    const res = await db.query(
      `UPDATE guild_bank_transactions SET unit_vendor_copper=$3, total_vendor_copper=quantity::bigint * $3::bigint WHERE guild_id=$1 AND item_id=$2 AND tx_type IN ('deposit','withdraw') AND unit_vendor_copper IS DISTINCT FROM $3`,
      [guildId, itemId, sellPrice]
    );
    updated += res.rowCount ?? 0;
  }
  return { itemsPriced: priceMap.size, transactionsUpdated: updated };
}
