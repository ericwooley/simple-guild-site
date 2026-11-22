ALTER TABLE guild_commendations
  ADD COLUMN IF NOT EXISTS author_level integer;
