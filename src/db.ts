import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

export const CODE_SCHEMA_VERSION = 5;

export interface DBContext {
  db: Database.Database;
  dbPath: string;
}

export function resolveDefaultDBPath(): string {
  // Allow overriding via env; prioritize VIBEPORTS_DB, fallback to legacy KVPORT_DB
  const env = process.env.VIBEPORTS_DB || process.env.KVPORT_DB;
  if (env && env.trim().length > 0) return path.resolve(env);
  return path.join(os.homedir(), '.vibeports', 'vibeports.sqlite3');
}

export function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function openDB(customPath?: string): DBContext {
  const dbPath = customPath ? path.resolve(customPath) : resolveDefaultDBPath();
  ensureDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 2000');
  db.pragma('foreign_keys = ON');
  maybeMigrate(db);
  return { db, dbPath };
}

function maybeMigrate(db: Database.Database) {
  const baselinePath = path.join(__dirname, '..', 'db', 'baseline.sql');
  const hasBindings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bindings'").get();
  if (!hasBindings) {
    const sql = fs.readFileSync(baselinePath, 'utf8');
    db.exec(sql);
    setDbVersion(db, CODE_SCHEMA_VERSION);
    return;
  }
  // Ensure meta exists
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);");
  let dbVersion = getDbVersion(db);
  if (dbVersion === null) {
    // Detect by schema
    const cols = db.prepare("PRAGMA table_info('bindings')").all() as Array<{ name: string }>;
    const hasName = cols.some((c) => c.name === 'name');
    dbVersion = hasName ? 2 : 1;
    setDbVersion(db, dbVersion);
  }
  if (dbVersion > CODE_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${dbVersion} is newer than supported ${CODE_SCHEMA_VERSION}. Please upgrade vibe-ports.`
    );
  }
  // Apply stepwise migrations
  while (dbVersion < CODE_SCHEMA_VERSION) {
    if (dbVersion === 1) {
      // v1 -> v2: add name column and adjust unique index
      db.exec("ALTER TABLE bindings ADD COLUMN name TEXT NOT NULL DEFAULT 'default'");
      db.exec("DROP INDEX IF EXISTS idx_bindings_unique_combo;");
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_combo ON bindings(project, branch, purpose, name);"
      );
      dbVersion = 2;
      setDbVersion(db, dbVersion);
      continue;
    }
    if (dbVersion === 2) {
      // v2 -> v3: add purpose_ranges and reserved_ports
      db.exec(`
        CREATE TABLE IF NOT EXISTS purpose_ranges (
          purpose TEXT PRIMARY KEY,
          start INTEGER NOT NULL,
          end INTEGER NOT NULL,
          is_custom INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          CHECK (start >= 1 AND start <= 65535),
          CHECK (end >= 1 AND end <= 65535)
        );
        CREATE TABLE IF NOT EXISTS reserved_ports (
          port INTEGER PRIMARY KEY,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          CHECK (port >= 1 AND port <= 65535)
        );
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (22,'ssh');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (80,'http');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (443,'https');
      `);
      dbVersion = 3;
      setDbVersion(db, dbVersion);
      continue;
    }
    if (dbVersion === 3) {
      // v3 -> v4: seed additional reserved ports (idempotent)
      db.exec(`
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (3306,'mysql');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (5432,'postgres');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (6379,'redis');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (27017,'mongodb');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (9200,'elasticsearch');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (5601,'kibana');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (11211,'memcached');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (9092,'kafka');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (5672,'rabbitmq');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (15672,'rabbitmq-mgmt');
      `);
      dbVersion = 4;
      setDbVersion(db, dbVersion);
      continue;
    }
    if (dbVersion === 4) {
      // v4 -> v5: add claimed column to bindings
      const cols = db.prepare("PRAGMA table_info('bindings')").all() as Array<{ name: string }>;
      const hasClaimed = cols.some((c) => c.name === 'claimed');
      if (!hasClaimed) {
        db.exec("ALTER TABLE bindings ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0");
      }
      dbVersion = 5;
      setDbVersion(db, dbVersion);
      continue;
    }
    break;
  }
  // Re-apply guarded statements from baseline to ensure indexes/triggers/meta defaults
  const sql = fs.readFileSync(baselinePath, 'utf8');
  db.exec(sql);
}

export function getDbVersion(db: Database.Database): number | null {
  try {
    const r = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
    if (!r) return null;
    const n = parseInt(String(r.value), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function setDbVersion(db: Database.Database, v: number) {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);");
  db.prepare("INSERT INTO meta(key,value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    String(v)
  );
}

export function closeDB(ctx: DBContext) {
  ctx.db.close();
}
