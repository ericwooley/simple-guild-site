CREATE TABLE IF NOT EXISTS guild_commendation_recipients (
  commendation_id text NOT NULL REFERENCES guild_commendations(id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  character_name text NOT NULL,
  PRIMARY KEY (commendation_id, character_id)
);

CREATE INDEX IF NOT EXISTS guild_commendation_recipients_guild_char
  ON guild_commendation_recipients (guild_id, character_id);

INSERT INTO guild_commendation_recipients (commendation_id, guild_id, character_id, character_name)
SELECT id, guild_id, character_id, character_name
FROM guild_commendations
WHERE character_id IS NOT NULL
ON CONFLICT DO NOTHING;
