ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_opted_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_prompted_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verify_token_hash text,
  ADD COLUMN IF NOT EXISTS email_verify_expires_at timestamptz;
