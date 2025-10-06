import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

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
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bindings'").get();
  if (!row) {
    const baselinePath = path.join(__dirname, '..', 'db', 'baseline.sql');
    const sql = fs.readFileSync(baselinePath, 'utf8');
    db.exec(sql);
  } else {
    // Even if table exists, ensure essential indexes/triggers exist by re-running guarded statements.
    const baselinePath = path.join(__dirname, '..', 'db', 'baseline.sql');
    const sql = fs.readFileSync(baselinePath, 'utf8');
    db.exec(sql);
  }
}

export function closeDB(ctx: DBContext) {
  ctx.db.close();
}
