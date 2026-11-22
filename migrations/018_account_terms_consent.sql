ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS terms_agreed_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_agreed_ip text,
  ADD COLUMN IF NOT EXISTS terms_version text;

ALTER TABLE oauth_states
  ADD COLUMN IF NOT EXISTS agreed_terms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_ip text;
