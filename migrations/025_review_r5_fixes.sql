-- 025_review_r5_fixes.sql
-- Round 5 audit fixes:
-- 1. Partial index for batched fulfilled bank request reconciliation.
-- 2. Observation timestamp on guild_character_professions so freshness compares observation time, not write order.

CREATE INDEX IF NOT EXISTS guild_bank_requests_unreconciled_fulfilled_idx
  ON guild_bank_requests (guild_id, item_key, fulfilled_at)
  WHERE status = 'fulfilled' AND reconciled_at IS NULL;

ALTER TABLE guild_character_professions
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;
