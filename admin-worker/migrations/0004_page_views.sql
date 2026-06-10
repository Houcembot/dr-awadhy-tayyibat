CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip TEXT NOT NULL,
  country TEXT,
  page_path TEXT NOT NULL,
  lang TEXT,
  referer TEXT,
  user_agent TEXT,
  duration_ms INTEGER,
  is_chatbot_question INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pv_ts ON page_views(ts DESC);
CREATE INDEX idx_pv_ip ON page_views(ip);
CREATE INDEX idx_pv_country ON page_views(country);
CREATE INDEX idx_pv_chatbot ON page_views(is_chatbot_question) WHERE is_chatbot_question = 1;
