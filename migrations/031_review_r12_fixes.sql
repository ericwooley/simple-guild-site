-- 031_review_r12_fixes.sql
-- Round 12 audit fixes:
-- 1. Backfill guilds.blizzard_guild_id for existing bnet:* guilds where verified account_characters agree on one guild_id.
-- 2. Backfill guild_banks.view_only_captured_at from captured_at for existing view_only=true rows so same-second captures cannot clear legacy view-only restrictions.

WITH unambiguous_guild_ids AS (
  SELECT g.id AS portal_guild_id, min(ac.guild_id) AS bnet_guild_id
  FROM guilds g
  JOIN account_characters ac
    ON ac.verified = true
   AND ac.region = g.region
   AND ac.guild_slug = substring(g.id FROM '^bnet:[^:]+:(.*)$')
   AND ac.guild_id IS NOT NULL
  WHERE g.id LIKE 'bnet:%'
    AND g.blizzard_guild_id IS NULL
  GROUP BY g.id
  HAVING count(DISTINCT ac.guild_id) = 1
)
UPDATE guilds g
SET blizzard_guild_id = u.bnet_guild_id
FROM unambiguous_guild_ids u
WHERE g.id = u.portal_guild_id
  AND g.blizzard_guild_id IS NULL;

UPDATE guild_banks
SET view_only_captured_at = captured_at
WHERE view_only = true
  AND view_only_captured_at IS NULL
  AND captured_at IS NOT NULL;
