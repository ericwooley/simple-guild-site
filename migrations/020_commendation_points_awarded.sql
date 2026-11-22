ALTER TABLE guild_commendation_recipients
  ADD COLUMN IF NOT EXISTS points_awarded integer NOT NULL DEFAULT 1;

UPDATE guild_commendation_recipients r
SET points_awarded = GREATEST(1, FLOOR(COALESCE(c.author_level, 1) / 2.0))::int
FROM guild_commendations c
WHERE c.id = r.commendation_id;
