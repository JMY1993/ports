import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { allocatePort, getPort, deleteBinding, listBindings, Purpose, claimPort, findFreePort, deleteByPort, deleteByRange } from '../src/core';
import { isPortFree } from '../src/netutil';

function tmpDB(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeports-'));
  return path.join(dir, `${name}.sqlite3`);
}

describe('core allocate/get/delete/list', () => {
  let dbPath: string;
  const project = 'proj1';
  const branch = 'feat-x';
  const purpose: Purpose = 'frontend';

  beforeEach(() => {
    dbPath = tmpDB('testdb');
  });

  it('allocates within range and is idempotent', () => {
    const p1 = allocatePort(dbPath, project, branch, purpose);
    expect(p1).toBeGreaterThanOrEqual(3000);
    expect(p1).toBeLessThanOrEqual(3999);

    const p2 = allocatePort(dbPath, project, branch, purpose);
    expect(p2).toBe(p1);
  });

  it('fail-if-exists causes allocate to throw when tuple exists', () => {
    const p1 = allocatePort(dbPath, project, branch, purpose);
    expect(p1).toBeTypeOf('number');
    expect(() => allocatePort(dbPath, project, branch, purpose, { failIfExists: true }))
      .toThrowError();
  });

  it('get returns the allocated port', () => {
    const p = allocatePort(dbPath, project, branch, purpose);
    const got = getPort(dbPath, project, branch, purpose);
    expect(got).toBe(p);
  });

  it('delete removes the binding', () => {
    allocatePort(dbPath, project, branch, purpose);
    const ok = deleteBinding(dbPath, project, branch, purpose);
    expect(ok).toBe(true);
    expect(() => getPort(dbPath, project, branch, purpose)).toThrowError();
  });

  it('port uniqueness across tuples (backend range separated)', () => {
    const pA = allocatePort(dbPath, 'projA', 'b1', 'frontend');
    const pB = allocatePort(dbPath, 'projB', 'b2', 'frontend');
    expect(pA).not.toBe(pB);
  });

  it('list shows all', () => {
    allocatePort(dbPath, 'proj1', 'b1', 'frontend');
    allocatePort(dbPath, 'proj2', 'b2', 'backend');
    const rows = listBindings(dbPath);
    expect(rows.length).toBe(2);
    const ports = rows.map(r => r.port);
    expect(ports[0]).not.toBe(ports[1]);
  });

  it('supports multiple backends in the same branch via name', () => {
    const p1 = allocatePort(dbPath, 'proj1', 'same', 'backend', { name: 'api' });
    const p2 = allocatePort(dbPath, 'proj1', 'same', 'backend', { name: 'worker' });
    expect(p1).not.toBe(p2);
    const rows = listBindings(dbPath).filter(r => r.project === 'proj1' && r.branch === 'same' && r.purpose === 'backend');
    expect(rows.map(r => r.name).sort()).toEqual(['api', 'worker']);
  });

  it('claim safe allocation then idempotent return', async () => {
    const port = await claimPort(dbPath, 'projC', 'feat-y', 'backend', 'api');
    expect(port).toBeGreaterThanOrEqual(8000);
    expect(port).toBeLessThanOrEqual(8999);
    const again = await claimPort(dbPath, 'projC', 'feat-y', 'backend', 'api');
    expect(again).toBe(port);
  });

  it('findFreePort returns a port that is OS-free and not registered by default', async () => {
    const start = 3100, end = 3110;
    const free = await findFreePort(dbPath, start, end);
    expect(free).toBeGreaterThanOrEqual(start);
    expect(free).toBeLessThanOrEqual(end);
    const ok = await isPortFree(free);
    expect(ok).toBe(true);
  });

  it('delete by port and by range work', async () => {
    const p1 = allocatePort(dbPath, 'projD', 'br', 'backend', { name: 'a' });
    const p2 = allocatePort(dbPath, 'projD', 'br', 'backend', { name: 'b' });
    expect(p1).not.toBe(p2);
    // delete by port
    const ok1 = deleteByPort(dbPath, p1);
    expect(ok1).toBe(true);
    // delete remaining by range
    const minP = Math.min(p1, p2);
    const maxP = Math.max(p1, p2);
    const { count, ports } = deleteByRange(dbPath, minP, maxP);
    expect(count).toBe(1);
    expect(ports).toContain(p2);
    const left = listBindings(dbPath).filter(r => r.project === 'projD' && r.branch === 'br');
    expect(left.length).toBe(0);
  });
});
