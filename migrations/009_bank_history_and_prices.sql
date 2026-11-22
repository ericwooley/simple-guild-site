CREATE TABLE IF NOT EXISTS item_catalog (
  item_id integer PRIMARY KEY,
  name text NOT NULL,
  sell_price_copper integer NOT NULL DEFAULT 0 CHECK (sell_price_copper >= 0),
  quality text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guild_bank_transactions (
  id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  tx_type text NOT NULL CHECK (tx_type IN ('deposit','withdraw','money-deposit','money-withdraw','requested','mailed','handed','cancelled','reopened')),
  bank_name text NOT NULL,
  actor_name text,
  item_id integer,
  suffix_id integer NOT NULL DEFAULT 0,
  item_name text,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  money_copper integer NOT NULL DEFAULT 0 CHECK (money_copper >= 0),
  unit_vendor_copper integer,
  total_vendor_copper bigint NOT NULL DEFAULT 0 CHECK (total_vendor_copper >= 0),
  is_donation boolean NOT NULL DEFAULT false,
  note text,
  occurred_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guild_bank_transactions_guild_occurred
  ON guild_bank_transactions (guild_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS guild_bank_transactions_guild_donations
  ON guild_bank_transactions (guild_id, is_donation, actor_name);
