-- 030_review_r11_fixes.sql
-- Round 11 audit fixes:
-- 1. Persist blizzard_guild_id on guilds so same-slug guilds with different Blizzard IDs never mix rosters or memberships.
-- 2. Persist stock_changed_at on guild_banks to separate latest confirmed capture time (captured_at) from
--    actual Ultimate Bank inventory change time (stock_changed_at) for fulfilled reservation reconciliation.

ALTER TABLE guilds
  ADD COLUMN IF NOT EXISTS blizzard_guild_id bigint;

ALTER TABLE guild_banks
  ADD COLUMN IF NOT EXISTS stock_changed_at bigint;
