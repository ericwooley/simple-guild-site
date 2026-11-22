-- 023_review_r3_fixes.sql
-- Round 3 audit fixes:
-- 1. Backfill guild_bank_requests.character_id from unique verified account_characters matches.
-- 2. Add explicit desktop pairing confirmation columns on desktop_auth_handoffs.

WITH unique_matches AS (
  SELECT r.id AS req_id, min(ac.id) AS char_id
  FROM guild_bank_requests r
  JOIN guilds g ON g.id = r.guild_id
  JOIN account_characters ac
    ON ac.account_id = r.account_id
   AND ac.verified = true
   AND ac.region = g.region
   AND g.id LIKE 'bnet:%'
   AND ac.guild_slug = split_part(g.id, ':', 3)
   AND lower(btrim(ac.name)) = lower(btrim(r.character_name))
  WHERE r.character_id IS NULL
  GROUP BY r.id
  HAVING count(*) = 1
)
UPDATE guild_bank_requests r
SET character_id = um.char_id
FROM unique_matches um
WHERE r.id = um.req_id;

ALTER TABLE desktop_auth_handoffs
  ADD COLUMN IF NOT EXISTS pending_account_id text REFERENCES accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS confirm_token_hash text;
