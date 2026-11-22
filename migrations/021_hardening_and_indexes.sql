-- 021_hardening_and_indexes.sql
-- Security, data integrity, soft-delete commendation audit history, and query-coverage indexes.

-- 1. Soft-delete support on guild_commendations so deleting a note hides it and revokes points
--    while preserving immutable 24h cooldown and diminishing-returns history.
ALTER TABLE guild_commendations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2. Email verification resend rate-limit timestamp
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verify_sent_at timestamptz;

-- 3. Composite foreign key on guild_commendation_recipients enforcing same-guild parent
CREATE UNIQUE INDEX IF NOT EXISTS guild_commendations_guild_id_id_uidx
  ON guild_commendations (guild_id, id);

DELETE FROM guild_commendation_recipients r
WHERE NOT EXISTS (
  SELECT 1 FROM guild_commendations c
  WHERE c.guild_id = r.guild_id AND c.id = r.commendation_id
);

ALTER TABLE guild_commendation_recipients
  DROP CONSTRAINT IF EXISTS guild_commendation_recipients_commendation_id_fkey;
ALTER TABLE guild_commendation_recipients
  DROP CONSTRAINT IF EXISTS guild_commendation_recipients_guild_comm_fk;
ALTER TABLE guild_commendation_recipients
  ADD CONSTRAINT guild_commendation_recipients_guild_comm_fk
  FOREIGN KEY (guild_id, commendation_id)
  REFERENCES guild_commendations (guild_id, id)
  ON DELETE CASCADE;

-- 4. Deduplicate any multiple is_main=true rows per account before adding partial unique index
WITH ranked AS (
  SELECT id, account_id,
         ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY updated_at DESC NULLS LAST, id ASC) AS rn
  FROM account_characters
  WHERE is_main = true
)
UPDATE account_characters ac
SET is_main = false
FROM ranked r
WHERE ac.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS account_characters_one_main_uidx
  ON account_characters (account_id)
  WHERE is_main = true;

-- 5. Unique email verification token hash
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_verify_token_hash_uidx
  ON accounts (email_verify_token_hash)
  WHERE email_verify_token_hash IS NOT NULL;

-- 6. Integrity CHECK constraints (clean any invalid legacy values first)
UPDATE accounts
SET email_verify_token_hash = NULL, email_verify_expires_at = NULL
WHERE (email_verify_token_hash IS NULL) <> (email_verify_expires_at IS NULL);

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_email_verify_pair_chk;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_email_verify_pair_chk
  CHECK ((email_verify_token_hash IS NULL) = (email_verify_expires_at IS NULL));

DELETE FROM guild_bank_items WHERE count <= 0 OR item_id <= 0;
ALTER TABLE guild_bank_items
  DROP CONSTRAINT IF EXISTS guild_bank_items_positive_chk;
ALTER TABLE guild_bank_items
  ADD CONSTRAINT guild_bank_items_positive_chk
  CHECK (count > 0 AND item_id > 0);

UPDATE guild_commendation_recipients SET points_awarded = 0 WHERE points_awarded < 0;
ALTER TABLE guild_commendation_recipients
  DROP CONSTRAINT IF EXISTS guild_commendation_recipients_points_chk;
ALTER TABLE guild_commendation_recipients
  ADD CONSTRAINT guild_commendation_recipients_points_chk
  CHECK (points_awarded >= 0);

UPDATE item_catalog SET sell_price_copper = 0 WHERE sell_price_copper < 0;
ALTER TABLE item_catalog
  DROP CONSTRAINT IF EXISTS item_catalog_price_chk;
ALTER TABLE item_catalog
  ADD CONSTRAINT item_catalog_price_chk
  CHECK (sell_price_copper >= 0);

-- 7. Query-coverage indexes from DB schema & indexing audit
CREATE INDEX IF NOT EXISTS memberships_guild_active_idx
  ON memberships (guild_id, account_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS sync_tokens_account_guild_created_idx
  ON sync_tokens (account_id, guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sync_tokens_account_active_idx
  ON sync_tokens (account_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS account_notifications_unread_idx
  ON account_notifications (account_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS guild_bank_favorites_restock_idx
  ON guild_bank_favorites (guild_id, item_key, account_id);

CREATE INDEX IF NOT EXISTS guild_commendations_author_recent_idx
  ON guild_commendations (guild_id, author_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guild_commendations_guild_active_idx
  ON guild_commendations (guild_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS guild_commendation_recipients_guild_norm_idx
  ON guild_commendation_recipients (guild_id, lower(btrim(character_name)));

CREATE INDEX IF NOT EXISTS guild_bank_contributions_guild_norm_idx
  ON guild_bank_contributions (guild_id, lower(btrim(character_name)));

CREATE INDEX IF NOT EXISTS guild_bank_transactions_guild_donor_norm_idx
  ON guild_bank_transactions (guild_id, lower(btrim(actor_name)))
  WHERE is_donation = true;

CREATE INDEX IF NOT EXISTS guild_bank_transactions_guild_item_idx
  ON guild_bank_transactions (guild_id, item_id)
  WHERE tx_type IN ('deposit', 'withdraw');

CREATE INDEX IF NOT EXISTS guild_bank_transactions_guild_occurred_id_idx
  ON guild_bank_transactions (guild_id, occurred_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS guild_news_guild_published_idx
  ON guild_news (guild_id, published_at DESC);

CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx
  ON oauth_states (expires_at);

CREATE INDEX IF NOT EXISTS desktop_auth_handoffs_expires_at_idx
  ON desktop_auth_handoffs (expires_at);
