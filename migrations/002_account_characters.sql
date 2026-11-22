CREATE TABLE IF NOT EXISTS account_characters (
 id text PRIMARY KEY,
 account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 blizzard_id bigint,
 name text NOT NULL,
 realm text NOT NULL,
 region text NOT NULL,
 namespace text NOT NULL,
 level integer,
 class_name text,
 race_name text,
 faction text,
 is_main boolean NOT NULL DEFAULT false,
 verified boolean NOT NULL DEFAULT true,
 verified_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_characters_account_idx ON account_characters(account_id);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS characters_synced_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS characters_sync_error text;
