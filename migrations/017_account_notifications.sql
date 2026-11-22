CREATE TABLE IF NOT EXISTS account_notifications (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  guild_id text REFERENCES guilds(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_notifications_acct_idx ON account_notifications(account_id, created_at DESC);
