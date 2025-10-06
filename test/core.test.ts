import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { allocatePort, getPort, deleteBinding, listBindings, Purpose } from '../src/core';

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
});

