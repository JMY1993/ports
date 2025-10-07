import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { claimPort, getPort, listBindings } from '../src/core';

function tmpDB(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeports-mig-'));
  return path.join(dir, `${name}.sqlite3`);
}

describe('migration from pre-name schema', () => {
  it('adds name column and updates unique index, keeping old data', async () => {
    const dbPath = tmpDB('old');
    const db = new Database(dbPath);
    try {
      db.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE bindings (
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
        CREATE UNIQUE INDEX idx_bindings_unique_combo ON bindings(project, branch, purpose);
        CREATE UNIQUE INDEX idx_bindings_port_unique ON bindings(port);
        INSERT INTO bindings(project, branch, purpose, port) VALUES('projM','feat-m','backend',8123);
      `);
    } finally {
      db.close();
    }

    // Trigger open + migration by claiming a different name under same tuple
    const pNew = await claimPort(dbPath, 'projM', 'feat-m', 'backend', 'api');
    expect(pNew).toBeGreaterThanOrEqual(8000);
    expect(pNew).toBeLessThanOrEqual(8999);

    // Old row should be accessible via default name
    const pOld = getPort(dbPath, 'projM', 'feat-m', 'backend');
    expect(pOld).toBe(8123);

    // Name column exists and two rows present
    const rows = listBindings(dbPath).filter(r => r.project==='projM' && r.branch==='feat-m' && r.purpose==='backend');
    expect(rows.map(r => r.name).sort()).toEqual(['api','default']);
  });
});

