CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','verificateur')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_login_at TEXT
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK(platform IN ('youtube','facebook','instagram','tiktok')),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  embed_url TEXT,
  title TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'pas_valide' CHECK(status IN ('valide','pas_valide')),
  note TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_changed_at TEXT,
  UNIQUE(platform, external_id)
);
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_platform ON videos(platform);

CREATE TABLE validation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('added','validated','unvalidated','deleted','noted')),
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_log_video ON validation_log(video_id, created_at);
