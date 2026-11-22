-- 1. Scalar guild metadata columns (formerly in guilds.state)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS motd_text text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS motd_updated_at timestamptz;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS motd_updated_by text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS guild_info_text text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS guild_info_updated_at timestamptz;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS guild_info_updated_by text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_captured_at bigint;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS guild_meta_captured_at bigint;

-- 2. Normalized guild tables
CREATE TABLE IF NOT EXISTS guild_ranks (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank_index integer NOT NULL CHECK (rank_index BETWEEN 0 AND 9),
  name text NOT NULL,
  approve_bank_requests boolean NOT NULL DEFAULT false,
  assign_titles boolean NOT NULL DEFAULT false,
  manage_guild_sync boolean NOT NULL DEFAULT false,
  manage_announcements boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, rank_index)
);

CREATE TABLE IF NOT EXISTS guild_characters (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  id text NOT NULL,
  account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  realm text NOT NULL,
  guid text,
  level integer,
  class_name text,
  guild_rank text,
  guild_rank_index integer,
  is_main boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  online boolean NOT NULL DEFAULT false,
  zone text,
  captured_at bigint,
  updated_at timestamptz,
  PRIMARY KEY (guild_id, id)
);
CREATE INDEX IF NOT EXISTS guild_characters_account_idx ON guild_characters(guild_id, account_id);

CREATE TABLE IF NOT EXISTS guild_character_titles (
  guild_id text NOT NULL,
  character_id text NOT NULL,
  title text NOT NULL,
  PRIMARY KEY (guild_id, character_id, title),
  FOREIGN KEY (guild_id, character_id) REFERENCES guild_characters(guild_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guild_character_professions (
  guild_id text NOT NULL,
  character_id text NOT NULL,
  profession_id integer NOT NULL,
  name text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  max_rank integer NOT NULL DEFAULT 0,
  updated_at timestamptz,
  PRIMARY KEY (guild_id, character_id, profession_id),
  FOREIGN KEY (guild_id, character_id) REFERENCES guild_characters(guild_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guild_character_recipes (
  guild_id text NOT NULL,
  character_id text NOT NULL,
  profession_id integer NOT NULL,
  recipe_id integer NOT NULL,
  name text NOT NULL,
  item_id integer,
  kind text,
  offered boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, character_id, profession_id, recipe_id),
  FOREIGN KEY (guild_id, character_id, profession_id) REFERENCES guild_character_professions(guild_id, character_id, profession_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guild_recipe_offers (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  recipe_key text NOT NULL,
  offered boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, recipe_key)
);

CREATE TABLE IF NOT EXISTS guild_roster_members (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  slug text,
  realm text NOT NULL,
  level integer,
  class_name text,
  guild_rank text,
  guild_rank_index integer,
  verified boolean NOT NULL DEFAULT false,
  online boolean NOT NULL DEFAULT false,
  zone text,
  updated_at timestamptz,
  PRIMARY KEY (guild_id, id)
);

CREATE TABLE IF NOT EXISTS guild_designated_banks (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name text NOT NULL,
  realm text NOT NULL,
  PRIMARY KEY (guild_id, name, realm)
);

CREATE TABLE IF NOT EXISTS guild_banks (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name text NOT NULL,
  realm text NOT NULL,
  guild_name text,
  view_only boolean NOT NULL DEFAULT false,
  complete boolean NOT NULL DEFAULT false,
  observed_at bigint,
  captured_at bigint,
  received_at timestamptz,
  PRIMARY KEY (guild_id, name, realm)
);

CREATE TABLE IF NOT EXISTS guild_bank_items (
  guild_id text NOT NULL,
  bank_name text NOT NULL,
  bank_realm text NOT NULL,
  item_id integer NOT NULL,
  suffix_id integer NOT NULL DEFAULT 0,
  enchant_id integer NOT NULL DEFAULT 0,
  name text,
  quality integer,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, bank_name, bank_realm, item_id, suffix_id, enchant_id),
  FOREIGN KEY (guild_id, bank_name, bank_realm) REFERENCES guild_banks(guild_id, name, realm) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guild_bank_favorites (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  PRIMARY KEY (guild_id, account_id, item_key)
);

CREATE TABLE IF NOT EXISTS guild_bank_requests (
  id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  character_name text NOT NULL,
  requester_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','declined','fulfilled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guild_bank_requests_guild_created ON guild_bank_requests(guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guild_news (
  id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  author_name text NOT NULL
);
CREATE INDEX IF NOT EXISTS guild_news_guild_published ON guild_news(guild_id, published_at DESC);

CREATE TABLE IF NOT EXISTS guild_syncs (
  id text NOT NULL,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  status text NOT NULL,
  captured_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL,
  PRIMARY KEY (guild_id, id)
);
CREATE INDEX IF NOT EXISTS guild_syncs_guild_received ON guild_syncs(guild_id, received_at DESC);

-- 3. Normalized account character professions & recipes (formerly account_characters.professions)
CREATE TABLE IF NOT EXISTS account_character_professions (
  character_id text NOT NULL REFERENCES account_characters(id) ON DELETE CASCADE,
  profession_id integer NOT NULL,
  name text NOT NULL,
  rank integer,
  max_rank integer,
  PRIMARY KEY (character_id, profession_id)
);

CREATE TABLE IF NOT EXISTS account_character_recipes (
  character_id text NOT NULL,
  profession_id integer NOT NULL,
  recipe_id integer NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (character_id, profession_id, recipe_id),
  FOREIGN KEY (character_id, profession_id) REFERENCES account_character_professions(character_id, profession_id) ON DELETE CASCADE
);

-- 4. Backfill existing JSONB data into normalized tables
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'guilds' AND column_name = 'state'
  ) THEN
    UPDATE guilds SET
      motd_text = state->'motd'->>'text',
      motd_updated_at = NULLIF(state->'motd'->>'updatedAt', '')::timestamptz,
      motd_updated_by = state->'motd'->>'updatedBy',
      guild_info_text = state->'guildInfo'->>'text',
      guild_info_updated_at = NULLIF(state->'guildInfo'->>'updatedAt', '')::timestamptz,
      guild_info_updated_by = state->'guildInfo'->>'updatedBy',
      roster_captured_at = CASE WHEN (state->>'rosterCapturedAt') ~ '^\d+$' THEN (state->>'rosterCapturedAt')::bigint ELSE NULL END,
      guild_meta_captured_at = CASE WHEN (state->>'guildMetaCapturedAt') ~ '^\d+$' THEN (state->>'guildMetaCapturedAt')::bigint ELSE NULL END
    WHERE state IS NOT NULL;

    INSERT INTO guild_ranks(guild_id, rank_index, name, approve_bank_requests, assign_titles, manage_guild_sync, manage_announcements)
    SELECT g.id, r.key::integer, COALESCE(NULLIF(r.value->>'name', ''), 'Rank ' || r.key),
      COALESCE((r.value->'permissions'->>'approveBankRequests')::boolean, false),
      COALESCE((r.value->'permissions'->>'assignTitles')::boolean, false),
      COALESCE((r.value->'permissions'->>'manageGuildSync')::boolean, false),
      COALESCE((r.value->'permissions'->>'manageAnnouncements')::boolean, false)
    FROM guilds g, jsonb_each(COALESCE(g.state->'rankConfig', '{}'::jsonb)) r
    WHERE r.key ~ '^[0-9]$'
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_characters(guild_id, id, account_id, name, realm, guid, level, class_name, guild_rank, guild_rank_index, is_main, verified, active, online, zone, captured_at, updated_at)
    SELECT g.id, c->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM accounts a WHERE a.id = c->>'accountId') THEN c->>'accountId' ELSE NULL END,
      c->>'name', COALESCE(c->>'realm', g.realm), c->>'guid',
      CASE WHEN (c->>'level') ~ '^\d+$' THEN (c->>'level')::integer ELSE NULL END,
      c->>'className', c->>'guildRank',
      CASE WHEN (c->>'guildRankIndex') ~ '^\d+$' THEN (c->>'guildRankIndex')::integer ELSE NULL END,
      COALESCE((c->>'isMain')::boolean, false),
      COALESCE((c->>'verified')::boolean, false),
      COALESCE((c->>'active')::boolean, true),
      COALESCE((c->>'online')::boolean, false),
      c->>'zone',
      CASE WHEN (c->>'capturedAt') ~ '^\d+$' THEN (c->>'capturedAt')::bigint ELSE NULL END,
      NULLIF(c->>'updatedAt', '')::timestamptz
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'characters', '[]'::jsonb)) c
    WHERE c->>'id' IS NOT NULL AND c->>'name' IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_character_titles(guild_id, character_id, title)
    SELECT g.id, c->>'id', t.title
    FROM guilds g,
      jsonb_array_elements(COALESCE(g.state->'characters', '[]'::jsonb)) c,
      jsonb_array_elements_text(COALESCE(c->'titles', '[]'::jsonb)) t(title)
    WHERE c->>'id' IS NOT NULL AND t.title IS NOT NULL AND btrim(t.title) <> ''
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_character_professions(guild_id, character_id, profession_id, name, rank, max_rank, updated_at)
    SELECT g.id, c->>'id', (p->>'id')::integer, COALESCE(p->>'name', 'Profession'),
      COALESCE((p->>'rank')::integer, 0),
      COALESCE((p->>'maxRank')::integer, COALESCE((p->>'rank')::integer, 0)),
      NULLIF(p->>'updatedAt', '')::timestamptz
    FROM guilds g,
      jsonb_array_elements(COALESCE(g.state->'characters', '[]'::jsonb)) c,
      jsonb_array_elements(COALESCE(c->'professions', '[]'::jsonb)) p
    WHERE c->>'id' IS NOT NULL AND (p->>'id') ~ '^\d+$'
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_character_recipes(guild_id, character_id, profession_id, recipe_id, name, item_id, kind, offered)
    SELECT g.id, c->>'id', (p->>'id')::integer, (r->>'id')::integer, COALESCE(r->>'name', 'Recipe'),
      CASE WHEN (r->>'itemId') ~ '^\d+$' THEN (r->>'itemId')::integer ELSE NULL END,
      r->>'kind',
      COALESCE((r->>'offered')::boolean, false)
    FROM guilds g,
      jsonb_array_elements(COALESCE(g.state->'characters', '[]'::jsonb)) c,
      jsonb_array_elements(COALESCE(c->'professions', '[]'::jsonb)) p,
      jsonb_array_elements(COALESCE(p->'recipes', '[]'::jsonb)) r
    WHERE c->>'id' IS NOT NULL AND (p->>'id') ~ '^\d+$' AND (r->>'id') ~ '^\d+$'
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_recipe_offers(guild_id, recipe_key, offered)
    SELECT g.id, o.key, COALESCE(o.value::text::boolean, false)
    FROM guilds g, jsonb_each(COALESCE(g.state->'offers', '{}'::jsonb)) o
    WHERE o.value::text IN ('true', 'false')
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_roster_members(guild_id, id, name, slug, realm, level, class_name, guild_rank, guild_rank_index, verified, online, zone, updated_at)
    SELECT g.id,
      COALESCE(NULLIF(m->>'id', ''), 'roster:' || lower(COALESCE(m->>'realm', g.realm)) || ':' || lower(m->>'name')),
      m->>'name', m->>'slug', COALESCE(m->>'realm', g.realm),
      CASE WHEN (m->>'level') ~ '^\d+$' THEN (m->>'level')::integer ELSE NULL END,
      m->>'className', m->>'guildRank',
      CASE WHEN (m->>'guildRankIndex') ~ '^\d+$' THEN (m->>'guildRankIndex')::integer ELSE NULL END,
      COALESCE((m->>'verified')::boolean, false),
      COALESCE((m->>'online')::boolean, false),
      m->>'zone',
      NULLIF(m->>'updatedAt', '')::timestamptz
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'roster', '[]'::jsonb)) m
    WHERE m->>'name' IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_designated_banks(guild_id, name, realm)
    SELECT g.id, b->>'name', COALESCE(b->>'realm', g.realm)
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'designatedBanks', '[]'::jsonb)) b
    WHERE b->>'name' IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_banks(guild_id, name, realm, guild_name, view_only, complete, observed_at, captured_at, received_at)
    SELECT g.id, b->>'name', COALESCE(b->>'realm', g.realm), b->>'guildName',
      COALESCE((b->>'viewOnly')::boolean, false),
      COALESCE((b->>'complete')::boolean, false),
      CASE WHEN (b->>'observedAt') ~ '^\d+$' THEN (b->>'observedAt')::bigint ELSE NULL END,
      CASE WHEN (b->>'capturedAt') ~ '^\d+$' THEN (b->>'capturedAt')::bigint ELSE NULL END,
      NULLIF(b->>'receivedAt', '')::timestamptz
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'banks', '[]'::jsonb)) b
    WHERE b->>'name' IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_bank_items(guild_id, bank_name, bank_realm, item_id, suffix_id, enchant_id, name, quality, count)
    SELECT g.id, b->>'name', COALESCE(b->>'realm', g.realm),
      (i->>'itemId')::integer,
      COALESCE((i->>'suffixId')::integer, 0),
      COALESCE((i->>'enchantId')::integer, 0),
      i->>'name',
      CASE WHEN (i->>'quality') ~ '^\d+$' THEN (i->>'quality')::integer ELSE NULL END,
      COALESCE((i->>'count')::integer, 0)
    FROM guilds g,
      jsonb_array_elements(COALESCE(g.state->'banks', '[]'::jsonb)) b,
      jsonb_array_elements(COALESCE(b->'items', '[]'::jsonb)) i
    WHERE b->>'name' IS NOT NULL AND (i->>'itemId') ~ '^\d+$'
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_bank_favorites(guild_id, account_id, item_key)
    SELECT g.id, f.key, item_key
    FROM guilds g,
      jsonb_each(COALESCE(g.state->'favorites', '{}'::jsonb)) f,
      jsonb_array_elements_text(COALESCE(f.value, '[]'::jsonb)) item_key
    WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = f.key)
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_bank_requests(id, guild_id, account_id, item_key, item_name, quantity, character_name, requester_name, status, created_at)
    SELECT r->>'id', g.id, r->>'accountId', r->>'itemKey', r->>'itemName',
      GREATEST(1, COALESCE((r->>'quantity')::integer, 1)),
      COALESCE(r->>'characterName', ''), COALESCE(r->>'requesterName', ''),
      CASE WHEN r->>'status' IN ('pending','approved','declined','fulfilled') THEN r->>'status' ELSE 'pending' END,
      COALESCE(NULLIF(r->>'createdAt', '')::timestamptz, now())
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'requests', '[]'::jsonb)) r
    WHERE r->>'id' IS NOT NULL AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = r->>'accountId')
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_news(id, guild_id, title, body, published_at, author_name)
    SELECT n->>'id', g.id, n->>'title', n->>'body',
      COALESCE(NULLIF(n->>'publishedAt', '')::timestamptz, now()),
      COALESCE(n->>'authorName', 'Guild')
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'news', '[]'::jsonb)) n
    WHERE n->>'id' IS NOT NULL AND n->>'title' IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO guild_syncs(id, guild_id, account_id, status, captured_at, received_at, summary)
    SELECT s->>'id', g.id,
      CASE WHEN EXISTS (SELECT 1 FROM accounts a WHERE a.id = s->>'accountId') THEN s->>'accountId' ELSE NULL END,
      COALESCE(s->>'status', 'success'),
      NULLIF(s->>'capturedAt', '')::timestamptz,
      COALESCE(NULLIF(s->>'receivedAt', '')::timestamptz, now()),
      COALESCE(s->>'summary', '')
    FROM guilds g, jsonb_array_elements(COALESCE(g.state->'syncs', '[]'::jsonb)) s
    WHERE s->>'id' IS NOT NULL
    ON CONFLICT DO NOTHING;

    ALTER TABLE guilds DROP COLUMN state;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'account_characters' AND column_name = 'professions'
  ) THEN
    INSERT INTO account_character_professions(character_id, profession_id, name, rank, max_rank)
    SELECT c.id, (p->>'id')::integer, COALESCE(p->>'name', 'Profession'),
      CASE WHEN (p->>'rank') ~ '^\d+$' THEN (p->>'rank')::integer ELSE NULL END,
      CASE WHEN (p->>'maxRank') ~ '^\d+$' THEN (p->>'maxRank')::integer ELSE NULL END
    FROM account_characters c, jsonb_array_elements(COALESCE(c.professions, '[]'::jsonb)) p
    WHERE (p->>'id') ~ '^\d+$'
    ON CONFLICT DO NOTHING;

    INSERT INTO account_character_recipes(character_id, profession_id, recipe_id, name)
    SELECT c.id, (p->>'id')::integer, (r->>'id')::integer, COALESCE(r->>'name', 'Recipe')
    FROM account_characters c,
      jsonb_array_elements(COALESCE(c.professions, '[]'::jsonb)) p,
      jsonb_array_elements(COALESCE(p->'recipes', '[]'::jsonb)) r
    WHERE (p->>'id') ~ '^\d+$' AND (r->>'id') ~ '^\d+$'
    ON CONFLICT DO NOTHING;

    ALTER TABLE account_characters DROP COLUMN professions;
  END IF;
END $$;
