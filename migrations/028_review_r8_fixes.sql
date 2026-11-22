-- 028_review_r8_fixes.sql
-- Round 8/9 audit fixes:
-- Keep contribution attribution strictly keyed by verified Blizzard ID (never reassign by character name alone).
-- Re-runs exact bnet:<region>:char:<blizzard_id> resolution idempotently.

WITH unique_contrib_matches AS (
  SELECT c.id AS contrib_id, min(ac.id) AS target_char_id
  FROM guild_bank_contributions c
  JOIN guilds g ON g.id = c.guild_id
  JOIN account_characters ac
    ON ac.verified = true
   AND ac.region = g.region
   AND ac.blizzard_id IS NOT NULL
   AND c.character_id = ('bnet:' || g.region || ':char:' || ac.blizzard_id::text)
  WHERE c.character_id IS NOT NULL
    AND c.character_id LIKE 'bnet:%:char:%'
  GROUP BY c.id
  HAVING count(*) = 1
)
UPDATE guild_bank_contributions c
SET character_id = m.target_char_id
FROM unique_contrib_matches m
WHERE c.id = m.contrib_id;
