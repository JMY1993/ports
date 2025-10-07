import { openDB, closeDB } from './db';
import { PURPOSE_RANGES, normalizePurpose, Purpose } from './ranges';
import { isPortFree, killPortOccupants } from './netutil';

export type { Purpose } from './ranges';

export interface BindingRow {
  project: string;
  branch: string;
  purpose: string;
  name: string;
  claimed: number;
  port: number;
  created_at: string;
  updated_at: string;
}

// Resolve effective port range for a purpose: custom from DB overrides built-ins.
export function getRangeForPurposeFromDB(db: any, purpose: Purpose): { start: number; end: number } | null {
  const row = db
    .prepare('SELECT start, end FROM purpose_ranges WHERE purpose = ?')
    .get(purpose) as { start: number; end: number } | undefined;
  if (row) return { start: row.start, end: row.end };
  if (purpose === 'frontend' || purpose === 'backend') {
    return PURPOSE_RANGES[purpose as 'frontend' | 'backend'];
  }
  return null;
}

export function allocatePort(
  dbPath: string | undefined,
  project: string,
  branch: string,
  purpose: Purpose,
  opts?: { failIfExists?: boolean; name?: string }
): number {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const name = (opts?.name ?? 'default').trim() || 'default';
    const selectExisting = db.prepare(
      'SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?'
    );
    const existing = selectExisting.get(project, branch, purpose, name) as { port: number } | undefined;
    if (existing && typeof existing.port === 'number') {
      if (opts?.failIfExists) {
        throw new Error('Already exists');
      }
      return existing.port;
    }

    const insertStmt = db.prepare(
      'INSERT INTO bindings (project, branch, purpose, name, claimed, port) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const range = getRangeForPurposeFromDB(db, purpose);
    if (!range) {
      throw new Error(
        `No port range configured for purpose '${purpose}'. Use 'ports purpose set ${purpose} START-END'.`
      );
    }

    const allocateTxn = db.transaction(() => {
      const again = selectExisting.get(project, branch, purpose, name) as { port: number } | undefined;
      if (again && typeof again.port === 'number') {
        if (opts?.failIfExists) {
          throw new Error('Already exists');
        }
        return again.port;
      }

      const isReserved = db.prepare('SELECT 1 FROM reserved_ports WHERE port = ? LIMIT 1');
      for (let p = range.start; p <= range.end; p++) {
        if (isReserved.get(p)) continue;
        try {
          insertStmt.run(project, branch, purpose, name, 0, p);
          return p;
        } catch (err: any) {
          const msg: string = err?.message ?? '';
          const code: string | undefined = err?.code;
          if (code === 'SQLITE_CONSTRAINT' || /UNIQUE constraint failed/.test(msg)) {
            const now = selectExisting.get(project, branch, purpose, name) as { port: number } | undefined;
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
      .prepare('SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?')
      .get(project, branch, purpose, 'default') as { port: number } | undefined;
    if (!row) throw new Error('Not found');
    return row.port;
  } finally {
    closeDB(ctx);
  }
}

export function deleteBinding(dbPath: string | undefined, project: string, branch: string, purpose: Purpose, name = 'default'): boolean {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const res = db
      .prepare('DELETE FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?')
      .run(project, branch, purpose, name);
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
      .prepare('SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings ORDER BY project, branch, purpose, name')
      .all() as BindingRow[];
    return rows;
  } finally {
    closeDB(ctx);
  }
}

export function listBindingsFiltered(
  dbPath: string | undefined,
  filters?: { project?: string; branch?: string; purpose?: string; name?: string }
): BindingRow[] {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const conds: string[] = [];
    const params: any[] = [];
    if (filters?.project) { conds.push('project = ?'); params.push(filters.project); }
    if (filters?.branch) { conds.push('branch = ?'); params.push(filters.branch); }
    if (filters?.purpose) { conds.push('purpose = ?'); params.push(filters.purpose); }
    if (filters?.name) { conds.push('name = ?'); params.push(filters.name); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings ${where} ORDER BY project, branch, purpose, name`;
    const rows = db.prepare(sql).all(...params) as BindingRow[];
    return rows;
  } finally {
    closeDB(ctx);
  }
}

export function getRangeForPurpose(purpose: Purpose): { start: number; end: number } {
  return PURPOSE_RANGES[purpose];
}

export async function claimPort(
  dbPath: string | undefined,
  project: string,
  branch: string,
  purpose: Purpose,
  name: string,
  opts?: { savage?: boolean }
): Promise<number> {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const select = db.prepare(
      'SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?'
    );
    const row = select.get(project, branch, purpose, name) as { port: number } | undefined;
    if (!row) {
      // Safe allocate: skip ports that are OS-occupied
      const range = getRangeForPurposeFromDB(db, purpose);
      if (!range) {
        throw new Error(
          `No port range configured for purpose '${purpose}'. Use 'ports purpose set ${purpose} START-END'.`
        );
      }
      const insert = db.prepare(
        'INSERT INTO bindings (project, branch, purpose, name, claimed, port) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const checkAgain = () => select.get(project, branch, purpose, name) as { port: number } | undefined;
      if (checkAgain()) return (checkAgain() as any).port;
      const range2 = range;
      const insertOnce = (port: number) => {
        const tx = db.transaction((p: number) => {
          const a = checkAgain();
          if (a) return a.port;
          insert.run(project, branch, purpose, name, opts?.savage ? 1 : 0, p);
          return p;
        });
        return tx(port);
      };
      const isReserved = db.prepare('SELECT 1 FROM reserved_ports WHERE port = ? LIMIT 1');
      for (let p = range2.start; p <= range2.end; p++) {
        if (isReserved.get(p)) continue;
        // safe check against OS occupancy
        // eslint-disable-next-line no-await-in-loop
        const free = await isPortFree(p);
        if (!free) continue;
        try {
          const got = insertOnce(p);
          if (opts?.savage) {
            db.prepare('UPDATE bindings SET claimed = 1 WHERE port = ?').run(got as number);
          }
          return got as number;
        } catch (e: any) {
          // unique conflict on port or combo -> try next
          continue;
        }
      }
      throw new Error(`No available port in range ${range2.start}-${range2.end} for purpose '${purpose}'.`);
    }
    // Existing binding
    const currentPort = row.port;
    if (opts?.savage) {
      const free = await isPortFree(currentPort);
      if (!free) {
        await killPortOccupants(currentPort);
      }
      // Mark as claimed (owner uses savage)
      db.prepare('UPDATE bindings SET claimed = 1 WHERE port = ?').run(currentPort);
      return currentPort;
    }
    return currentPort;
  } finally {
    closeDB(ctx);
  }
}

export async function findFreePort(
  dbPath: string | undefined,
  start: number,
  end: number,
  opts?: { includeRegistered?: boolean; includeReserved?: boolean }
): Promise<number> {
  if (start > end) [start, end] = [end, start];
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const isRegistered = db.prepare('SELECT 1 FROM bindings WHERE port = ? LIMIT 1');
    const isReserved = db.prepare('SELECT 1 FROM reserved_ports WHERE port = ? LIMIT 1');
    for (let p = start; p <= end; p++) {
      if (!Number.isInteger(p) || p < 1 || p > 65535) continue;
      if (!opts?.includeRegistered) {
        const used = isRegistered.get(p) as any;
        if (used) continue;
      }
      if (!opts?.includeReserved) {
        const resv = isReserved.get(p) as any;
        if (resv) continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const free = await isPortFree(p);
      if (free) return p;
    }
    throw new Error(`No free port found in range ${start}-${end}${opts?.includeRegistered ? '' : ' (excluding registered ports)'}${opts?.includeReserved ? '' : ' (excluding reserved ports)'}.`);
  } finally {
    closeDB(ctx);
  }
}

export function deleteByPort(dbPath: string | undefined, port: number): boolean {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const res = db.prepare('DELETE FROM bindings WHERE port = ?').run(port);
    return (res.changes ?? 0) > 0;
  } finally {
    closeDB(ctx);
  }
}

export function deleteByRange(
  dbPath: string | undefined,
  start: number,
  end: number
): { count: number; ports: number[] } {
  if (start > end) [start, end] = [end, start];
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const tx = db.transaction((a: number, b: number) => {
      const rows = db
        .prepare('SELECT port FROM bindings WHERE port BETWEEN ? AND ? ORDER BY port')
        .all(a, b) as Array<{ port: number }>;
      const ports = rows.map((r) => r.port);
      const res = db.prepare('DELETE FROM bindings WHERE port BETWEEN ? AND ?').run(a, b);
      return { count: res.changes ?? 0, ports };
    });
    return tx(start, end);
  } finally {
    closeDB(ctx);
  }
}

// Helpers for advanced delete workflows
export function getBindingByPort(
  dbPath: string | undefined,
  port: number
): BindingRow | undefined {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const row = db
      .prepare(
        'SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings WHERE port = ? LIMIT 1'
      )
      .get(port) as BindingRow | undefined;
    return row;
  } finally {
    closeDB(ctx);
  }
}

export function listBindingsByPortRange(
  dbPath: string | undefined,
  start: number,
  end: number
): BindingRow[] {
  if (start > end) [start, end] = [end, start];
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const rows = db
      .prepare(
        'SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings WHERE port BETWEEN ? AND ? ORDER BY port'
      )
      .all(start, end) as BindingRow[];
    return rows;
  } finally {
    closeDB(ctx);
  }
}
