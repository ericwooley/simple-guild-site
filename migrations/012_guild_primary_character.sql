ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS primary_character_id text;
