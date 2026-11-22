-- 024_review_r4_fixes.sql
-- Round 4 audit fixes:
-- 1. Monotonic account Battle.net sync generation & email change revision
-- 2. Per-guild Battle.net roster observation timestamp
-- 3. Persisted bank request reservation reconciliation timestamp
-- 4. OAuth state binding on desktop_auth_handoffs
-- 5. Guild-scoped verified account_characters index & legacy contribution backfill

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS bnet_sync_gen bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_change_rev bigint NOT NULL DEFAULT 0;

ALTER TABLE guilds
  ADD COLUMN IF NOT EXISTS bnet_roster_synced_at timestamptz;

ALTER TABLE guild_bank_requests
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

UPDATE guild_bank_requests
SET reconciled_at = COALESCE(fulfilled_at, created_at)
WHERE status = 'fulfilled' AND fulfilled_at IS NULL AND reconciled_at IS NULL;

ALTER TABLE desktop_auth_handoffs
  ADD COLUMN IF NOT EXISTS oauth_state_hash text;

CREATE INDEX IF NOT EXISTS account_characters_guild_region_verified_idx
  ON account_characters (guild_slug, region)
  WHERE verified = true;

-- Backfill manual contributions stored under bnet:<region>:char:<blizzard_id> by exact region + blizzard_id match only.
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
