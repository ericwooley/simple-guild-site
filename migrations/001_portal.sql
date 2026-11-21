CREATE TABLE IF NOT EXISTS guilds (
 id text PRIMARY KEY, name text NOT NULL, realm text NOT NULL, region text NOT NULL,
 state jsonb NOT NULL DEFAULT '{"characters":[],"roster":[],"banks":[],"requests":[],"favorites":{},"syncs":[]}'::jsonb
);
CREATE TABLE IF NOT EXISTS accounts (
 id text PRIMARY KEY, battle_tag text NOT NULL, test_account boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS memberships (
 account_id text REFERENCES accounts(id), guild_id text REFERENCES guilds(id),
 role text NOT NULL CHECK(role IN ('owner','member')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(account_id,guild_id)
);
CREATE TABLE IF NOT EXISTS sessions (
 id_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id),
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_tokens (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id), guild_id text NOT NULL REFERENCES guilds(id),
 scope text NOT NULL CHECK(scope IN ('member','guild')), created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, last_used_at timestamptz
);
CREATE TABLE IF NOT EXISTS sync_uploads (
 account_id text REFERENCES accounts(id), snapshot_id text NOT NULL, digest text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,snapshot_id)
);
CREATE TABLE IF NOT EXISTS oauth_states (
 id_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
