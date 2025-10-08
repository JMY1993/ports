import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync, spawnSync } from 'node:child_process';

function tmpDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCLI(cwd: string, args: string[], env?: Record<string, string>) {
  const bin = path.resolve(__dirname, '..', 'dist', 'index.js');
  const res = spawnSync('node', [bin, ...args], {
    cwd,
    env: { ...process.env, ...(env || {}) },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`CLI failed (${res.status}):\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`);
  }
  return { stdout: res.stdout.trim(), stderr: res.stderr.trim() };
}

describe('auto commands (git-derived)', () => {
  const repo = tmpDir('vibeports-repo-');
  const dbPath = path.join(repo, 'test.sqlite3');

  beforeAll(() => {
    // Ensure dist exists
    execSync('npm run -s build', { cwd: path.resolve(__dirname, '..') });
    // init a temp git repo with branch feat/x and origin url
    execSync('git init', { cwd: repo });
    execSync('git checkout -b feat/x', { cwd: repo });
    execSync('git remote add origin https://example.com/acme/my_repo.git', { cwd: repo });
  });

  it('auto keys derives project/branch/slug', () => {
    const out = runCLI(repo, ['auto', 'keys']).stdout;
    const obj = JSON.parse(out);
    expect(obj.project).toBe('my_repo');
    expect(obj.branch).toBe('feat/x');
    expect(obj.slug).toContain('my_repo');
    expect(obj.slug).toContain('feat_x');
    expect(obj.slug_pg).toMatch(/_([0-9a-f]{6})$/);
  });

  it('auto claim/get/delete works on derived keys', () => {
    const claim = runCLI(repo, ['auto', 'claim', '-u', 'backend', '-n', 'auto', '-D', dbPath]).stdout;
    const port = Number(claim);
    expect(port).toBeGreaterThanOrEqual(8000);
    expect(port).toBeLessThanOrEqual(8999);
    const get = runCLI(repo, ['auto', 'get', '-u', 'backend', '-n', 'auto', '-D', dbPath]).stdout;
    expect(Number(get)).toBe(port);
    // delete by key
    const del = runCLI(repo, ['auto', 'delete', '-u', 'backend', '-n', 'auto', '-D', dbPath, '--yes', '--json']).stdout;
    const obj = JSON.parse(del);
    expect(obj.deleted).toBe(1);
  });
});
