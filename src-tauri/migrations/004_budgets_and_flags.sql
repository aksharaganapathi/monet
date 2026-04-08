CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) UNIQUE,
  amount REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE transactions ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;

ALTER TABLE budgets ADD COLUMN amount REAL;
ALTER TABLE budgets ADD COLUMN period TEXT DEFAULT 'monthly';
ALTER TABLE budgets ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
ALTER TABLE budgets ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

UPDATE budgets
SET amount = COALESCE(amount, monthly_limit)
WHERE amount IS NULL;

UPDATE budgets
SET period = COALESCE(period, 'monthly'),
    created_at = COALESCE(created_at, datetime('now')),
    updated_at = COALESCE(updated_at, datetime('now'));
