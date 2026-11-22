CREATE TABLE IF NOT EXISTS guild_bank_contributions (
  id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  character_name text NOT NULL,
  copper integer NOT NULL CHECK (copper <> 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  awarded_by_account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  awarded_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guild_bank_contributions_guild_char
  ON guild_bank_contributions (guild_id, character_id);

CREATE INDEX IF NOT EXISTS guild_bank_contributions_guild_created
  ON guild_bank_contributions (guild_id, created_at DESC);
