CREATE TABLE video_whitelist (
  external_id TEXT PRIMARY KEY,
  title TEXT,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_whitelist_added ON video_whitelist(added_at DESC);
