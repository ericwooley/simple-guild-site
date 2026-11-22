-- 026_review_r6_fixes.sql
-- Round 6 audit fixes:
-- Replace item_key-first partial index with (guild_id, fulfilled_at) for batched fulfillment reconciliation.

DROP INDEX IF EXISTS guild_bank_requests_unreconciled_fulfilled_idx;

CREATE INDEX IF NOT EXISTS guild_bank_requests_unreconciled_fulfilled_idx
  ON guild_bank_requests (guild_id, fulfilled_at)
  WHERE status = 'fulfilled' AND reconciled_at IS NULL;
