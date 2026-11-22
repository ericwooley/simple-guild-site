const iso = value => value instanceof Date ? value.toISOString() : (value ?? null);

export async function loadAccountCharacterProfessions(db, characterIds) {
  const byChar = new Map();
  if (!characterIds.length) return byChar;
  const profsRes = await db.query(
    `SELECT character_id AS "characterId", profession_id AS id, name, rank, max_rank AS "maxRank"
     FROM account_character_professions
     WHERE character_id = ANY($1::text[])
     ORDER BY name ASC`,
    [characterIds]
  );
  const recipesRes = await db.query(
    `SELECT character_id AS "characterId", profession_id AS "professionId", recipe_id AS id, name
     FROM account_character_recipes
     WHERE character_id = ANY($1::text[])
     ORDER BY name ASC`,
    [characterIds]
  );
  const recipesByCharProf = new Map();
  for (const r of recipesRes.rows) {
    const key = `${r.characterId}:${r.professionId}`;
    const list = recipesByCharProf.get(key) ?? [];
    list.push({ id: r.id, name: r.name });
    recipesByCharProf.set(key, list);
  }
  for (const p of profsRes.rows) {
    const list = byChar.get(p.characterId) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      rank: p.rank,
      maxRank: p.maxRank,
      recipes: recipesByCharProf.get(`${p.characterId}:${p.id}`) ?? []
    });
    byChar.set(p.characterId, list);
  }
  return byChar;
}

export async function replaceAccountCharacterProfessions(db, characterId, professions = [], { complete = false } = {}) {
  const incomingIds = [];
  for (const p of professions ?? []) {
    if (!Number.isSafeInteger(p.id) || p.id <= 0) continue;
    incomingIds.push(p.id);
    await db.query(
      `INSERT INTO account_character_professions(character_id, profession_id, name, rank, max_rank)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(character_id, profession_id) DO UPDATE SET name=excluded.name, rank=excluded.rank, max_rank=excluded.max_rank`,
      [characterId, p.id, p.name || 'Profession', p.rank ?? null, p.maxRank ?? null]
    );
    if (p.recipesKnown !== false && Array.isArray(p.recipes)) {
      await db.query('DELETE FROM account_character_recipes WHERE character_id=$1 AND profession_id=$2', [characterId, p.id]);
      const validRecipes = p.recipes.filter(r => Number.isSafeInteger(r.id) && r.id > 0);
      if (validRecipes.length) {
        await db.query(
          `INSERT INTO account_character_recipes(character_id, profession_id, recipe_id, name)
           SELECT $1, $2, r.id, r.name
           FROM unnest($3::int[], $4::text[]) AS r(id, name)
           ON CONFLICT(character_id, profession_id, recipe_id) DO UPDATE SET name=excluded.name`,
          [characterId, p.id, validRecipes.map(r => r.id), validRecipes.map(r => r.name || 'Recipe')]
        );
      }
    }
  }
  if (complete) {
    if (incomingIds.length) {
      await db.query(
        'DELETE FROM account_character_professions WHERE character_id=$1 AND NOT (profession_id = ANY($2::int[]))',
        [characterId, incomingIds]
      );
    } else {
      await db.query('DELETE FROM account_character_professions WHERE character_id=$1', [characterId]);
    }
  }
}

export async function loadGuildState(db, guildId, guildRow = null, { includeRequests = true } = {}) {
  const guild = guildRow ?? (await db.query(
    `SELECT id, name, realm, region, motd_text, motd_updated_at, motd_updated_by, guild_info_text, guild_info_updated_at, guild_info_updated_by, roster_captured_at, guild_meta_captured_at, blizzard_guild_id
     FROM guilds WHERE id=$1`,
    [guildId]
  )).rows[0];
  if (!guild) return null;

  const ranksRes = await db.query(`SELECT rank_index, name, approve_bank_requests, assign_titles, manage_guild_sync, manage_announcements FROM guild_ranks WHERE guild_id=$1 ORDER BY rank_index ASC`, [guildId]);
  const charsRes = await db.query(`SELECT id, account_id, name, realm, guid, level, class_name, guild_rank, guild_rank_index, is_main, verified, active, online, zone, captured_at, updated_at, professions_complete_observed_at FROM guild_characters WHERE guild_id=$1`, [guildId]);
  const titlesRes = await db.query(`SELECT character_id, title FROM guild_character_titles WHERE guild_id=$1 ORDER BY title ASC`, [guildId]);
  const profsRes = await db.query(`SELECT character_id, profession_id, name, rank, max_rank, updated_at, observed_at FROM guild_character_professions WHERE guild_id=$1`, [guildId]);
  const recipesRes = await db.query(`SELECT character_id, profession_id, recipe_id, name, item_id, kind, offered FROM guild_character_recipes WHERE guild_id=$1`, [guildId]);
  const offersRes = await db.query(`SELECT recipe_key, offered FROM guild_recipe_offers WHERE guild_id=$1`, [guildId]);
  const rosterRes = await db.query(`SELECT id, name, slug, realm, level, class_name, guild_rank, guild_rank_index, verified, online, zone, updated_at FROM guild_roster_members WHERE guild_id=$1`, [guildId]);
  const designatedRes = await db.query(`SELECT name, realm FROM guild_designated_banks WHERE guild_id=$1 ORDER BY name ASC`, [guildId]);
  const banksRes = await db.query(`SELECT name, realm, guild_name, view_only, complete, observed_at, captured_at, received_at, source_kind, source_version, view_only_captured_at, stock_changed_at FROM guild_banks WHERE guild_id=$1`, [guildId]);
  const bankItemsRes = await db.query(`SELECT bank_name, bank_realm, item_id, suffix_id, enchant_id, name, quality, count FROM guild_bank_items WHERE guild_id=$1`, [guildId]);
  const favsRes = await db.query(`SELECT account_id, item_key FROM guild_bank_favorites WHERE guild_id=$1`, [guildId]);
  const reqsRes = includeRequests
    ? await db.query(`SELECT id, account_id, item_key, item_name, quantity, character_id, character_name, requester_name, status, note, created_at, fulfilled_at, reconciled_at, fulfilled_bank_name, fulfilled_bank_realm FROM guild_bank_requests WHERE guild_id=$1 ORDER BY created_at DESC`, [guildId])
    : { rows: [] };
  const newsRes = await db.query(`SELECT id, title, body, published_at, author_name FROM guild_news WHERE guild_id=$1 ORDER BY published_at DESC LIMIT 50`, [guildId]);
  const syncsRes = await db.query(`SELECT id, account_id, status, captured_at, received_at, summary FROM guild_syncs WHERE guild_id=$1 ORDER BY received_at DESC LIMIT 100`, [guildId]);

  const rankConfig = {};
  for (const r of ranksRes.rows) {
    rankConfig[String(r.rank_index)] = {
      name: r.name,
      permissions: {
        approveBankRequests: r.approve_bank_requests,
        assignTitles: r.assign_titles,
        manageGuildSync: r.manage_guild_sync,
        manageAnnouncements: r.manage_announcements
      }
    };
  }

  const titlesByChar = new Map();
  for (const t of titlesRes.rows) {
    const list = titlesByChar.get(t.character_id) ?? [];
    list.push(t.title);
    titlesByChar.set(t.character_id, list);
  }

  const recipesByCharProf = new Map();
  for (const r of recipesRes.rows) {
    const key = `${r.character_id}:${r.profession_id}`;
    const list = recipesByCharProf.get(key) ?? [];
    const rec = { id: r.recipe_id, name: r.name, offered: r.offered };
    if (r.item_id !== null) rec.itemId = r.item_id;
    if (r.kind !== null) rec.kind = r.kind;
    list.push(rec);
    recipesByCharProf.set(key, list);
  }

  const profsByChar = new Map();
  for (const p of profsRes.rows) {
    const list = profsByChar.get(p.character_id) ?? [];
    list.push({
      id: p.profession_id,
      name: p.name,
      rank: p.rank,
      maxRank: p.max_rank,
      updatedAt: iso(p.updated_at),
      observedAt: iso(p.observed_at),
      recipes: recipesByCharProf.get(`${p.character_id}:${p.profession_id}`) ?? []
    });
    profsByChar.set(p.character_id, list);
  }

  const characters = charsRes.rows.map(c => ({
    id: c.id,
    accountId: c.account_id,
    name: c.name,
    realm: c.realm,
    ...(c.guid ? { guid: c.guid } : {}),
    level: c.level,
    className: c.class_name,
    guildRank: c.guild_rank,
    guildRankIndex: c.guild_rank_index,
    isMain: c.is_main,
    verified: c.verified,
    active: c.active,
    online: c.online,
    zone: c.zone,
    ...(c.captured_at !== null ? { capturedAt: Number(c.captured_at) } : {}),
    updatedAt: iso(c.updated_at),
    professionsCompleteObservedAt: iso(c.professions_complete_observed_at),
    titles: titlesByChar.get(c.id) ?? [],
    professions: profsByChar.get(c.id) ?? []
  }));

  const offers = {};
  for (const o of offersRes.rows) offers[o.recipe_key] = o.offered;

  const roster = rosterRes.rows.map(m => ({
    id: m.id,
    name: m.name,
    ...(m.slug ? { slug: m.slug } : {}),
    realm: m.realm,
    level: m.level,
    className: m.class_name,
    guildRank: m.guild_rank,
    guildRankIndex: m.guild_rank_index,
    verified: m.verified,
    online: m.online,
    zone: m.zone,
    updatedAt: iso(m.updated_at)
  }));

  const designatedBanks = designatedRes.rows.map(b => ({ name: b.name, realm: b.realm }));

  const itemsByBank = new Map();
  for (const i of bankItemsRes.rows) {
    const key = `${i.bank_name}\0${i.bank_realm}`;
    const list = itemsByBank.get(key) ?? [];
    const item = { itemId: i.item_id, suffixId: i.suffix_id, enchantId: i.enchant_id, count: i.count };
    if (i.name !== null) item.name = i.name;
    if (i.quality !== null) item.quality = i.quality;
    list.push(item);
    itemsByBank.set(key, list);
  }

  const banks = banksRes.rows.map(b => ({
    name: b.name,
    realm: b.realm,
    guildName: b.guild_name,
    viewOnly: b.view_only,
    complete: b.complete,
    observedAt: b.observed_at !== null ? Number(b.observed_at) : null,
    capturedAt: b.captured_at !== null ? Number(b.captured_at) : null,
    receivedAt: iso(b.received_at),
    sourceKind: b.source_kind ?? null,
    sourceVersion: b.source_version ?? null,
    viewOnlyCapturedAt: b.view_only_captured_at !== null ? Number(b.view_only_captured_at) : null,
    stockChangedAt: b.stock_changed_at !== null ? Number(b.stock_changed_at) : null,
    items: itemsByBank.get(`${b.name}\0${b.realm}`) ?? []
  }));

  const favorites = {};
  for (const f of favsRes.rows) {
    favorites[f.account_id] ??= [];
    favorites[f.account_id].push(f.item_key);
  }

  const requests = reqsRes.rows.map(r => ({
    id: r.id,
    accountId: r.account_id,
    itemKey: r.item_key,
    itemName: r.item_name,
    quantity: r.quantity,
    characterId: r.character_id ?? null,
    characterName: r.character_name,
    requesterName: r.requester_name,
    status: r.status,
    note: r.note ?? null,
    createdAt: iso(r.created_at),
    fulfilledAt: iso(r.fulfilled_at),
    reconciledAt: iso(r.reconciled_at),
    fulfilledBankName: r.fulfilled_bank_name ?? null,
    fulfilledBankRealm: r.fulfilled_bank_realm ?? null
  }));

  const news = newsRes.rows.map(n => ({
    id: n.id,
    title: n.title,
    body: n.body,
    publishedAt: iso(n.published_at),
    authorName: n.author_name
  }));

  const syncs = syncsRes.rows.map(s => ({
    id: s.id,
    accountId: s.account_id,
    status: s.status,
    capturedAt: iso(s.captured_at),
    receivedAt: iso(s.received_at),
    summary: s.summary
  }));

  return {
    blizzardGuildId: guild.blizzard_guild_id !== null && guild.blizzard_guild_id !== undefined ? Number(guild.blizzard_guild_id) : null,
    motd: guild.motd_text ? { text: guild.motd_text, updatedAt: iso(guild.motd_updated_at), updatedBy: guild.motd_updated_by } : null,
    guildInfo: guild.guild_info_text ? { text: guild.guild_info_text, updatedAt: iso(guild.guild_info_updated_at), updatedBy: guild.guild_info_updated_by } : null,
    rosterCapturedAt: guild.roster_captured_at !== null ? Number(guild.roster_captured_at) : null,
    guildMetaCapturedAt: guild.guild_meta_captured_at !== null ? Number(guild.guild_meta_captured_at) : null,
    rankConfig,
    characters,
    offers,
    roster,
    designatedBanks,
    banks,
    favorites,
    requests,
    news,
    syncs
  };
}

export async function saveGuildState(db, guildId, state, opts = {}) {
  const {
    skipRanks = false,
    skipRoster = false,
    skipBanks = false,
    skipFavorites = false,
    skipSyncs = false,
    onlyCharacterIds = null,
  } = opts;
  await db.query(
    `UPDATE guilds SET
       motd_text=$2, motd_updated_at=$3, motd_updated_by=$4,
       guild_info_text=$5, guild_info_updated_at=$6, guild_info_updated_by=$7,
       roster_captured_at=$8, guild_meta_captured_at=$9
     WHERE id=$1`,
    [
      guildId,
      state.motd?.text ?? null, state.motd?.updatedAt ?? null, state.motd?.updatedBy ?? null,
      state.guildInfo?.text ?? null, state.guildInfo?.updatedAt ?? null, state.guildInfo?.updatedBy ?? null,
      state.rosterCapturedAt ?? null, state.guildMetaCapturedAt ?? null
    ]
  );

  // Ranks
  if (!skipRanks) {
    await db.query('DELETE FROM guild_ranks WHERE guild_id=$1', [guildId]);
    for (const [key, entry] of Object.entries(state.rankConfig ?? {})) {
      const rankIndex = Number(key);
      if (!Number.isSafeInteger(rankIndex) || rankIndex < 0 || rankIndex > 9) continue;
      await db.query(
        `INSERT INTO guild_ranks(guild_id, rank_index, name, approve_bank_requests, assign_titles, manage_guild_sync, manage_announcements)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          guildId, rankIndex, entry?.name || `Rank ${rankIndex}`,
          Boolean(entry?.permissions?.approveBankRequests),
          Boolean(entry?.permissions?.assignTitles),
          Boolean(entry?.permissions?.manageGuildSync),
          Boolean(entry?.permissions?.manageAnnouncements)
        ]
      );
    }
  }

  // Characters, titles, professions, recipes
  const targetChars = Array.isArray(onlyCharacterIds)
    ? (state.characters ?? []).filter(c => onlyCharacterIds.includes(c.id))
    : (state.characters ?? []);
  if (!Array.isArray(onlyCharacterIds)) {
    await db.query('DELETE FROM guild_characters WHERE guild_id=$1', [guildId]);
  }
  for (const c of targetChars) {
    await db.query(
      `INSERT INTO guild_characters(guild_id, id, account_id, name, realm, guid, level, class_name, guild_rank, guild_rank_index, is_main, verified, active, online, zone, captured_at, updated_at, professions_complete_observed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT(guild_id, id) DO UPDATE SET
         account_id=excluded.account_id, name=excluded.name, realm=excluded.realm, guid=excluded.guid,
         level=excluded.level, class_name=excluded.class_name, guild_rank=excluded.guild_rank,
         guild_rank_index=excluded.guild_rank_index, is_main=excluded.is_main, verified=excluded.verified,
         active=excluded.active, online=excluded.online, zone=excluded.zone,
         captured_at=excluded.captured_at, updated_at=excluded.updated_at,
         professions_complete_observed_at=COALESCE(excluded.professions_complete_observed_at, guild_characters.professions_complete_observed_at)`,
      [
        guildId, c.id, c.accountId ?? null, c.name, c.realm || '', c.guid ?? null,
        c.level ?? null, c.className ?? null, c.guildRank ?? null, c.guildRankIndex ?? null,
        Boolean(c.isMain), Boolean(c.verified), c.active !== false, Boolean(c.online),
        c.zone ?? null, c.capturedAt ?? null, c.updatedAt ?? null, c.professionsCompleteObservedAt ?? null
      ]
    );
    for (const title of c.titles ?? []) {
      await db.query(
        `INSERT INTO guild_character_titles(guild_id, character_id, title) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [guildId, c.id, title]
      );
    }
    const incomingProfIds = [];
    for (const p of c.professions ?? []) {
      if (!Number.isSafeInteger(p.id) || p.id <= 0) continue;
      incomingProfIds.push(p.id);
      await db.query(
        `INSERT INTO guild_character_professions(guild_id, character_id, profession_id, name, rank, max_rank, updated_at, observed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(guild_id, character_id, profession_id) DO UPDATE SET name=excluded.name, rank=excluded.rank, max_rank=excluded.max_rank, updated_at=excluded.updated_at, observed_at=COALESCE(excluded.observed_at, guild_character_professions.observed_at)`,
        [guildId, c.id, p.id, p.name || 'Profession', p.rank ?? 0, p.maxRank ?? p.rank ?? 0, p.updatedAt ?? null, p.observedAt ?? null]
      );
      if (p.recipes !== undefined) {
        const validRecipes = (p.recipes ?? []).filter(r => Number.isSafeInteger(r.id) && r.id > 0);
        if (Array.isArray(onlyCharacterIds) && p.recipesKnown !== false) {
          const keepRecipeIds = validRecipes.map(r => r.id);
          if (keepRecipeIds.length) {
            await db.query(
              'DELETE FROM guild_character_recipes WHERE guild_id=$1 AND character_id=$2 AND profession_id=$3 AND NOT (recipe_id = ANY($4::int[]))',
              [guildId, c.id, p.id, keepRecipeIds]
            );
          } else {
            await db.query(
              'DELETE FROM guild_character_recipes WHERE guild_id=$1 AND character_id=$2 AND profession_id=$3',
              [guildId, c.id, p.id]
            );
          }
        }
        if (validRecipes.length) {
          await db.query(
            `INSERT INTO guild_character_recipes(guild_id, character_id, profession_id, recipe_id, name, item_id, kind, offered)
             SELECT $1, $2, $3, r.id, r.name, r.item_id, r.kind, r.offered
             FROM unnest($4::int[], $5::text[], $6::int[], $7::text[], $8::boolean[]) AS r(id, name, item_id, kind, offered)
             ON CONFLICT(guild_id, character_id, profession_id, recipe_id) DO UPDATE SET name=excluded.name, item_id=excluded.item_id, kind=excluded.kind, offered=excluded.offered`,
            [
              guildId,
              c.id,
              p.id,
              validRecipes.map(r => r.id),
              validRecipes.map(r => r.name || 'Recipe'),
              validRecipes.map(r => r.itemId ?? null),
              validRecipes.map(r => r.kind ?? null),
              validRecipes.map(r => Boolean(r.offered)),
            ]
          );
        }
      }
    }
    if (Array.isArray(onlyCharacterIds) && c.profsComplete === true) {
      if (incomingProfIds.length) {
        await db.query(
          'DELETE FROM guild_character_professions WHERE guild_id=$1 AND character_id=$2 AND NOT (profession_id = ANY($3::int[]))',
          [guildId, c.id, incomingProfIds]
        );
      } else {
        await db.query('DELETE FROM guild_character_professions WHERE guild_id=$1 AND character_id=$2', [guildId, c.id]);
      }
    }
  }

  // Recipe offers
  if (!Array.isArray(onlyCharacterIds)) {
    await db.query('DELETE FROM guild_recipe_offers WHERE guild_id=$1', [guildId]);
    for (const [recipeKey, offered] of Object.entries(state.offers ?? {})) {
      await db.query(
        `INSERT INTO guild_recipe_offers(guild_id, recipe_key, offered) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [guildId, recipeKey, Boolean(offered)]
      );
    }
  }

  // Roster
  if (!skipRoster) {
    await db.query('DELETE FROM guild_roster_members WHERE guild_id=$1', [guildId]);
    for (const m of state.roster ?? []) {
      await db.query(
        `INSERT INTO guild_roster_members(guild_id, id, name, slug, realm, level, class_name, guild_rank, guild_rank_index, verified, online, zone, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(guild_id, id) DO UPDATE SET
           name=excluded.name, slug=excluded.slug, realm=excluded.realm, level=excluded.level,
           class_name=excluded.class_name, guild_rank=excluded.guild_rank, guild_rank_index=excluded.guild_rank_index,
           verified=excluded.verified, online=excluded.online, zone=excluded.zone, updated_at=excluded.updated_at`,
        [
          guildId, m.id, m.name, m.slug ?? null, m.realm || '', m.level ?? null,
          m.className ?? null, m.guildRank ?? null, m.guildRankIndex ?? null,
          Boolean(m.verified), Boolean(m.online), m.zone ?? null, m.updatedAt ?? null
        ]
      );
    }
  }

  // Designated banks & Banks
  if (!skipBanks) {
    await db.query('DELETE FROM guild_designated_banks WHERE guild_id=$1', [guildId]);
    for (const b of state.designatedBanks ?? []) {
      await db.query(
        `INSERT INTO guild_designated_banks(guild_id, name, realm) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [guildId, b.name, b.realm || '']
      );
    }

    await db.query('DELETE FROM guild_banks WHERE guild_id=$1', [guildId]);
    for (const b of state.banks ?? []) {
      await db.query(
        `INSERT INTO guild_banks(guild_id, name, realm, guild_name, view_only, complete, observed_at, captured_at, received_at, source_kind, source_version, view_only_captured_at, stock_changed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(guild_id, name, realm) DO UPDATE SET
           guild_name=excluded.guild_name, view_only=excluded.view_only, complete=excluded.complete,
           observed_at=excluded.observed_at, captured_at=excluded.captured_at, received_at=excluded.received_at,
           source_kind=excluded.source_kind, source_version=excluded.source_version, view_only_captured_at=excluded.view_only_captured_at,
           stock_changed_at=excluded.stock_changed_at`,
        [guildId, b.name, b.realm || '', b.guildName ?? null, Boolean(b.viewOnly), Boolean(b.complete), b.observedAt ?? null, b.capturedAt ?? null, b.receivedAt ?? null, b.sourceKind ?? null, b.sourceVersion ?? null, b.viewOnlyCapturedAt ?? null, b.stockChangedAt ?? null]
      );
      for (const item of b.items ?? []) {
        await db.query(
          `INSERT INTO guild_bank_items(guild_id, bank_name, bank_realm, item_id, suffix_id, enchant_id, name, quality, count)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(guild_id, bank_name, bank_realm, item_id, suffix_id, enchant_id) DO UPDATE SET
             name=excluded.name, quality=excluded.quality, count=excluded.count`,
          [guildId, b.name, b.realm || '', item.itemId, item.suffixId ?? 0, item.enchantId ?? 0, item.name ?? null, item.quality ?? null, item.count ?? 0]
        );
      }
    }
  }

  // Favorites
  if (!skipFavorites) {
    await db.query('DELETE FROM guild_bank_favorites WHERE guild_id=$1', [guildId]);
    for (const [accountId, keys] of Object.entries(state.favorites ?? {})) {
      for (const itemKey of keys ?? []) {
        await db.query(
          `INSERT INTO guild_bank_favorites(guild_id, account_id, item_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [guildId, accountId, itemKey]
        );
      }
    }
  }

  // Requests are managed directly via request-item and update-request
  // so routine syncs never rewrite or lock closed request history.

  // News is managed directly via publish-news, edit-news, and delete-news
  // so routine syncs never truncate or overwrite older guild announcements.

  // Syncs
  if (!skipSyncs) {
    await db.query('DELETE FROM guild_syncs WHERE guild_id=$1', [guildId]);
    for (const s of (state.syncs ?? []).slice(0, 100)) {
      await db.query(
        `INSERT INTO guild_syncs(id, guild_id, account_id, status, captured_at, received_at, summary)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [s.id, guildId, s.accountId ?? null, s.status, s.capturedAt ?? null, s.receivedAt ?? new Date().toISOString(), s.summary]
      );
    }
  }
}
