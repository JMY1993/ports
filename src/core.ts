import { openDB, closeDB } from './db';
import { PURPOSE_RANGES, normalizePurpose, Purpose } from './ranges';

export type { Purpose } from './ranges';

export interface BindingRow {
  project: string;
  branch: string;
  purpose: string;
  port: number;
  created_at: string;
  updated_at: string;
}

export function allocatePort(dbPath: string | undefined, project: string, branch: string, purpose: Purpose): number {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const selectExisting = db.prepare(
      'SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ?'
    );
    const existing = selectExisting.get(project, branch, purpose) as { port: number } | undefined;
    if (existing && typeof existing.port === 'number') {
      return existing.port;
    }

    const insertStmt = db.prepare(
      'INSERT INTO bindings (project, branch, purpose, port) VALUES (?, ?, ?, ?)'
    );

    const range = PURPOSE_RANGES[purpose];

    const allocateTxn = db.transaction(() => {
      const again = selectExisting.get(project, branch, purpose) as { port: number } | undefined;
      if (again && typeof again.port === 'number') return again.port;

      for (let p = range.start; p <= range.end; p++) {
        try {
          insertStmt.run(project, branch, purpose, p);
          return p;
        } catch (err: any) {
          const msg: string = err?.message ?? '';
          const code: string | undefined = err?.code;
          if (code === 'SQLITE_CONSTRAINT' || /UNIQUE constraint failed/.test(msg)) {
            const now = selectExisting.get(project, branch, purpose) as { port: number } | undefined;
            if (now && typeof now.port === 'number') return now.port;
            continue;
          }
          throw err;
        }
      }
      throw new Error(`No available port in range ${range.start}-${range.end} for purpose '${purpose}'.`);
    });

    return allocateTxn();
  } finally {
    closeDB(ctx);
  }
}

export function getPort(dbPath: string | undefined, project: string, branch: string, purpose: Purpose): number {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const row = db
      .prepare('SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ?')
      .get(project, branch, purpose) as { port: number } | undefined;
    if (!row) throw new Error('Not found');
    return row.port;
  } finally {
    closeDB(ctx);
  }
}

export function deleteBinding(dbPath: string | undefined, project: string, branch: string, purpose: Purpose): boolean {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const res = db
      .prepare('DELETE FROM bindings WHERE project = ? AND branch = ? AND purpose = ?')
      .run(project, branch, purpose);
    return (res.changes ?? 0) > 0;
  } finally {
    closeDB(ctx);
  }
}

export function listBindings(dbPath: string | undefined): BindingRow[] {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const rows = db
      .prepare('SELECT project, branch, purpose, port, created_at, updated_at FROM bindings ORDER BY project, branch, purpose')
      .all() as BindingRow[];
    return rows;
  } finally {
    closeDB(ctx);
  }
}

