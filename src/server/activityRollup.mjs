const ONE_HOUR_MS = 60 * 60 * 1000;

function normKey(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Rolls up individual donation bank transactions within `windowMs` (default 1 hour)
 * per account (crediting the account's guild primary character when known) or per
 * actor name when unlinked.
 *
 * Expects each transaction to optionally include:
 *   - groupKey: stable grouping key (e.g. "account:<id>" or "actor:<normName>")
 *   - actorName: resolved display name (primary character name if known)
 *   - actorCharacterId: resolved character ID (primary character ID if known)
 */
export function rollupDonationTransactions(transactions, { windowMs = ONE_HOUR_MS, formatCopper } = {}) {
  const fmt = typeof formatCopper === 'function' ? formatCopper : (v) => `${Number(v || 0)}c`;
  const byGroup = new Map();

  for (const tx of transactions || []) {
    if (!tx) continue;
    const key = tx.groupKey || `actor:${normKey(tx.actorName) || 'unknown'}`;
    const list = byGroup.get(key) ?? [];
    list.push(tx);
    byGroup.set(key, list);
  }

  const rolled = [];

  for (const [groupKey, groupTxs] of byGroup.entries()) {
    const sorted = [...groupTxs].sort((a, b) => {
      const ta = Date.parse(a.occurredAt || a.createdAt || '') || 0;
      const tb = Date.parse(b.occurredAt || b.createdAt || '') || 0;
      return tb - ta || String(a.id || '').localeCompare(String(b.id || ''));
    });

    const clusters = [];
    for (const tx of sorted) {
      const ts = Date.parse(tx.occurredAt || tx.createdAt || '') || 0;
      const prev = clusters[clusters.length - 1];
      if (prev && prev.anchorTs - ts <= windowMs) {
        prev.txs.push(tx);
      } else {
        clusters.push({ anchorTs: ts, txs: [tx] });
      }
    }

    for (const cluster of clusters) {
      const first = cluster.txs[0];
      const itemMap = new Map();
      let moneyCopper = 0;
      let totalValueCopper = 0;
      let totalItemQty = 0;
      const banks = new Set();
      const ids = [];

      for (const tx of cluster.txs) {
        ids.push(tx.id);
        if (tx.bankName) banks.add(tx.bankName);
        if (tx.txType === 'money-deposit') {
          const mc = Number(tx.moneyCopper ?? 0) || 0;
          moneyCopper += mc;
          totalValueCopper += mc;
        } else {
          const qty = Math.max(1, Number(tx.quantity ?? 1) || 1);
          const itemCopper = Number(tx.totalVendorCopper ?? 0) || 0;
          const label = tx.itemName || (tx.itemId ? `Item #${tx.itemId}` : 'Item');
          const itemKey = tx.itemId ? `${tx.itemId}:${tx.suffixId ?? 0}` : `name:${normKey(label)}`;
          const existing = itemMap.get(itemKey);
          if (existing) {
            existing.quantity += qty;
            existing.totalVendorCopper += itemCopper;
          } else {
            itemMap.set(itemKey, {
              itemId: tx.itemId ?? null,
              itemName: label,
              quantity: qty,
              totalVendorCopper: itemCopper,
            });
          }
          totalItemQty += qty;
          totalValueCopper += itemCopper;
        }
      }

      const items = [...itemMap.values()]
        .sort((a, b) => b.totalVendorCopper - a.totalVendorCopper || b.quantity - a.quantity || a.itemName.localeCompare(b.itemName))
        .map(item => ({
          ...item,
          vendorFormatted: fmt(item.totalVendorCopper),
        }));

      const bankList = [...banks];
      const bankName = bankList.length === 1 ? bankList[0] : bankList.length > 1 ? bankList.join(', ') : (first.bankName || null);
      const isMoneyOnly = items.length === 0 && moneyCopper > 0;
      const isSingleItem = items.length === 1 && moneyCopper === 0;
      const itemSummary = items.map(i => (i.quantity > 1 ? `${i.itemName} ×${i.quantity}` : i.itemName)).join(', ');

      rolled.push({
        kind: 'donation',
        id: cluster.txs.length === 1 ? first.id : `rollup:${groupKey}:${first.id}`,
        txType: isMoneyOnly ? 'money-deposit' : (isSingleItem ? (first.txType || 'deposit') : 'donation-rollup'),
        bankName,
        actorName: first.actorName,
        actorCharacterId: first.actorCharacterId ?? null,
        itemId: isSingleItem ? items[0].itemId : null,
        itemName: isSingleItem ? items[0].itemName : itemSummary,
        quantity: isSingleItem ? items[0].quantity : totalItemQty,
        moneyCopper,
        moneyFormatted: fmt(moneyCopper),
        totalVendorCopper: totalValueCopper,
        vendorFormatted: fmt(totalValueCopper),
        isDonation: true,
        note: cluster.txs.length === 1 ? (first.note ?? null) : null,
        createdAt: first.occurredAt || first.createdAt,
        occurredAt: first.occurredAt || first.createdAt,
        rolledCount: cluster.txs.length,
        distinctItemCount: items.length,
        items,
      });
    }
  }

  return rolled.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
}
