ALTER TABLE guilds ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS logo_name text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS logo_bytes bytea;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS logo_mime text;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS logo_updated_at timestamptz;
