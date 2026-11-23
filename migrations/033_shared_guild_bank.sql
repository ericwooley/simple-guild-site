ALTER TABLE guild_banks
  ADD COLUMN guild_tab_id integer CHECK (guild_tab_id BETWEEN 1 AND 8),
  ADD COLUMN guild_tab_name text;

CREATE TABLE guild_bank_history_captures (
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  tab_id integer NOT NULL CHECK (tab_id BETWEEN 1 AND 8),
  observed_at bigint NOT NULL,
  PRIMARY KEY (guild_id, tab_id)
);

CREATE TABLE guild_bank_history_entries (
  guild_id text NOT NULL,
  tab_id integer NOT NULL,
  position integer NOT NULL,
  type text NOT NULL CHECK (type IN ('deposit','withdraw','move')),
  actor text NOT NULL,
  item_id integer NOT NULL,
  item_name text NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  age_seconds bigint NOT NULL CHECK (age_seconds >= 0),
  from_tab integer,
  to_tab integer,
  PRIMARY KEY (guild_id, tab_id, position),
  FOREIGN KEY (guild_id, tab_id) REFERENCES guild_bank_history_captures(guild_id, tab_id) ON DELETE CASCADE
);
