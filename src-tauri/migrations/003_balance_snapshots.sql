CREATE TABLE IF NOT EXISTS balance_snapshots (
  snapshot_date TEXT PRIMARY KEY,
  total_balance REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
