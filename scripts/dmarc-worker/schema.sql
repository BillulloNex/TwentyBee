CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  policy_domain TEXT NOT NULL,
  policy TEXT,
  begin_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  emailed_at TEXT
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL REFERENCES reports(report_id),
  policy_domain TEXT NOT NULL,
  header_from TEXT,
  source_ip TEXT NOT NULL,
  count INTEGER NOT NULL,
  disposition TEXT,
  dkim_aligned TEXT,
  spf_aligned TEXT,
  dkim_domains TEXT,
  spf_domains TEXT
);

CREATE INDEX IF NOT EXISTS records_report_id ON records(report_id);
CREATE INDEX IF NOT EXISTS reports_end_at ON reports(end_at);
CREATE INDEX IF NOT EXISTS reports_emailed_at ON reports(emailed_at);
