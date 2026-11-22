CREATE TABLE IF NOT EXISTS guild_macros (
  id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guild_macros_guild_idx ON guild_macros(guild_id, sort_order ASC, created_at ASC);
