PRAGMA foreign_keys=ON;
-- Enable WAL journal for better concurrency on multi-process usage
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=2000;

-- Meta table for schema versioning
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  branch TEXT NOT NULL,
  purpose TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'default',
  claimed INTEGER NOT NULL DEFAULT 0,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(project)) > 0),
  CHECK (length(trim(branch)) > 0),
  CHECK (length(trim(purpose)) > 0),
  CHECK (length(trim(name)) > 0)
);

-- Uniqueness constraints
DROP INDEX IF EXISTS idx_bindings_unique_combo;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_combo
  ON bindings(project, branch, purpose, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_port_unique
  ON bindings(port);

-- updated_at trigger
CREATE TRIGGER IF NOT EXISTS trg_bindings_updated_at
AFTER UPDATE ON bindings
FOR EACH ROW
BEGIN
  UPDATE bindings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Set current schema version if not present (code expects 2)
INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '5');

-- Purpose ranges (customizable). If a purpose exists here, it overrides built-ins.
CREATE TABLE IF NOT EXISTS purpose_ranges (
  purpose TEXT PRIMARY KEY,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start >= 1 AND start <= 65535),
  CHECK (end >= 1 AND end <= 65535)
);

-- Reserved ports: allocator/claimer should skip these ports.
CREATE TABLE IF NOT EXISTS reserved_ports (
  port INTEGER PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (port >= 1 AND port <= 65535)
);

-- Minimal default reserved ports
INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES
  (22,   'ssh'),
  (80,   'http'),
  (443,  'https'),
  (3306, 'mysql'),
  (5432, 'postgres'),
  (6379, 'redis'),
  (27017,'mongodb'),
  (9200, 'elasticsearch'),
  (5601, 'kibana'),
  (11211,'memcached'),
  (9092, 'kafka'),
  (5672, 'rabbitmq'),
  (15672,'rabbitmq-mgmt');
