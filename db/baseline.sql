PRAGMA foreign_keys=ON;
-- Enable WAL journal for better concurrency on multi-process usage
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=2000;

CREATE TABLE IF NOT EXISTS bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  branch TEXT NOT NULL,
  purpose TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(project)) > 0),
  CHECK (length(trim(branch)) > 0),
  CHECK (length(trim(purpose)) > 0)
);

-- Uniqueness constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_combo
  ON bindings(project, branch, purpose);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_port_unique
  ON bindings(port);

-- updated_at trigger
CREATE TRIGGER IF NOT EXISTS trg_bindings_updated_at
AFTER UPDATE ON bindings
FOR EACH ROW
BEGIN
  UPDATE bindings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

