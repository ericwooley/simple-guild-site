CREATE TABLE IF NOT EXISTS feedback_short_links (
  character_id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  short_url TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'is.gd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
