-- 022_review_r2_fixes.sql
-- Round 2 audit fixes: bank request character_id + fulfilled_at reservation tracking,
-- PKCE desktop auth handoff account_id, and open-request index.

ALTER TABLE guild_bank_requests ADD COLUMN IF NOT EXISTS character_id text;
ALTER TABLE guild_bank_requests ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

ALTER TABLE desktop_auth_handoffs ADD COLUMN IF NOT EXISTS account_id text REFERENCES accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS guild_bank_requests_open_idx
  ON guild_bank_requests (guild_id, account_id)
  WHERE status IN ('pending', 'approved');
