export async function saveGuildBankHistory(db, guildId, captures = []) {
  for (const capture of captures) {
    const updated = await db.query(
      `INSERT INTO guild_bank_history_captures(guild_id,tab_id,observed_at) VALUES($1,$2,$3)
       ON CONFLICT(guild_id,tab_id) DO UPDATE SET observed_at=excluded.observed_at
       WHERE guild_bank_history_captures.observed_at < excluded.observed_at RETURNING tab_id`,
      [guildId, capture.tabId, capture.observedAt]
    );
    if (!updated.rowCount) continue;
    await db.query('DELETE FROM guild_bank_history_entries WHERE guild_id=$1 AND tab_id=$2', [guildId, capture.tabId]);
    for (const [position, entry] of capture.entries.entries()) {
      await db.query(
        `INSERT INTO guild_bank_history_entries
         (guild_id,tab_id,position,type,actor,item_id,item_name,count,age_seconds,from_tab,to_tab)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [guildId,capture.tabId,position,entry.type,entry.actor,entry.itemId,entry.itemName,
          entry.count,entry.ageSeconds,entry.fromTab ?? null,entry.toTab ?? null]
      );
    }
  }
}

export async function loadGuildBankHistory(db, guildId) {
  return (await db.query(
    `SELECT e.tab_id AS "tabId", e.type, e.actor, e.item_id AS "itemId", e.item_name AS "itemName",
       e.count, e.from_tab AS "fromTab", e.to_tab AS "toTab",
       to_timestamp(c.observed_at - e.age_seconds) AS "occurredAt",
       to_timestamp(c.observed_at) AS "observedAt"
     FROM guild_bank_history_entries e
     JOIN guild_bank_history_captures c USING(guild_id,tab_id)
     WHERE e.guild_id=$1 ORDER BY "occurredAt" DESC, e.tab_id, e.position DESC`, [guildId]
  )).rows.map(row => ({
    ...row, occurredAt: row.occurredAt.toISOString(), observedAt: row.observedAt.toISOString()
  }));
}
