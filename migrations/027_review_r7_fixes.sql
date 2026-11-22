-- 027_review_r7_fixes.sql
-- Round 7 audit fixes:
-- 1. Persist complete profession observation timestamp on guild_characters so older uploads cannot restore dropped professions.
-- 2. Track bank stock source_kind ('ultimate-bank' vs 'native') on guild_banks so Ultimate Bank privacy/view-only rules take precedence cleanly.
-- 3. Record supplying bank on fulfilled guild_bank_requests so per-bank reconciliation never releases reservations prematurely.
-- 4. Re-run exact Blizzard-ID contribution backfill for databases that already applied migration 024, and repair any mismatched name-backfilled rows.

ALTER TABLE guild_characters
  ADD COLUMN IF NOT EXISTS professions_complete_observed_at timestamptz;

ALTER TABLE guild_banks
  ADD COLUMN IF NOT EXISTS source_kind text;

ALTER TABLE guild_bank_requests
  ADD COLUMN IF NOT EXISTS fulfilled_bank_name text,
  ADD COLUMN IF NOT EXISTS fulfilled_bank_realm text;

-- 4a. Exact Blizzard-ID backfill for any legacy bnet:<region>:char:<blizzard_id> contributions
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
