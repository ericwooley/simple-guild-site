-- 029_review_r10_fixes.sql
-- Round 10 audit fixes:
-- 1. Persist source_version and view_only_captured_at on guild_banks so unchanged Ultimate Bank re-exports
--    do not prematurely reconcile fulfilled reservations and delayed snapshots cannot undo newer view_only restrictions.

ALTER TABLE guild_banks
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS view_only_captured_at bigint;
