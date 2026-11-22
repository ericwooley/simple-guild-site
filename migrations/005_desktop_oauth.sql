ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS desktop_state_hash text;
CREATE TABLE IF NOT EXISTS desktop_auth_handoffs (
  state_hash text PRIMARY KEY,
  session_token text,
  expires_at timestamptz NOT NULL
);
