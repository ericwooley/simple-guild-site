-- 032_ah_prices.sql
-- Store live Blizzard WoW Forever Auction House market price snapshots per (region, ruleset, faction, item_id)
-- and track price_source ('ah' | 'vendor') on guild_bank_transactions.

CREATE TABLE IF NOT EXISTS item_ah_prices (
  region text NOT NULL,
  ruleset text NOT NULL,
  faction text NOT NULL,
  item_id integer NOT NULL,
  market_copper bigint NOT NULL CHECK (market_copper >= 0),
  min_buyout_copper bigint NOT NULL CHECK (min_buyout_copper >= 0),
  listing_count integer NOT NULL DEFAULT 0 CHECK (listing_count >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, ruleset, faction, item_id)
);

CREATE INDEX IF NOT EXISTS item_ah_prices_lookup_idx
  ON item_ah_prices (region, ruleset, faction, observed_at DESC);

ALTER TABLE guild_bank_transactions
  ADD COLUMN IF NOT EXISTS price_source text;
