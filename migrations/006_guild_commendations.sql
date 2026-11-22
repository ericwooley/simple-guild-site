CREATE TABLE IF NOT EXISTS guild_commendations (
  id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  character_name text NOT NULL,
  author_account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author_character_id text,
  author_name text NOT NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guild_commendations_guild_created
  ON guild_commendations (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guild_commendations_guild_character
  ON guild_commendations (guild_id, character_id);
