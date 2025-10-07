#!/usr/bin/env node
import { Command } from 'commander';
import { resolveDefaultDBPath, CODE_SCHEMA_VERSION, openDB, closeDB, getDbVersion } from './db';
import { normalizePurpose, Purpose } from './ranges';
import { allocatePort, getPort, deleteBinding, listBindings, claimPort, findFreePort, deleteByPort, deleteByRange, listBindingsFiltered, getBindingByPort, listBindingsByPortRange } from './core';
import { findPidsByPort, killPortOccupants, isPortFree } from './netutil';
import { startMCP } from './mcp';

type OutputMode = 'text' | 'json';

interface CommonOpts {
  db?: string;
  json?: boolean;
}

function toOutputMode(opts: { json?: boolean }): OutputMode {
  return opts.json ? 'json' : 'text';
}

function printResult(mode: OutputMode, payload: any) {
  if (mode === 'json') {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    if (typeof payload === 'number' || typeof payload === 'string') {
      process.stdout.write(String(payload) + '\n');
    } else if (payload && typeof payload.port !== 'undefined') {
      process.stdout.write(String(payload.port) + '\n');
    } else {
      process.stdout.write(JSON.stringify(payload) + '\n');
    }
  }
}

function fail(message: string): never {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function sanitizeText(input: string, name: string): string {
  const v = (input ?? '').toString().trim();
  if (!v) fail(`${name} is required`);
  return v;
}

function ensurePurpose(input: string): Purpose {
  try {
    return normalizePurpose(input);
  } catch (e: any) {
    fail(e.message);
  }
}

const program = new Command();
program
  .name('ports')
  .description('Allocate, query and delete unique ports by (project, branch, purpose).')
  .version('0.2.1', '-v, --version', 'Show version')
  .helpOption('-h, --help', 'Show help')
  .addHelpCommand('help [command]', 'Show help for command')
  .showHelpAfterError()
  .option('-D, --db <path>', 'Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)')
  .option('-j, --json', 'Output JSON', false)
  .hook('preAction', () => {
    // placeholder for future hooks
  });

program
  .command('allocate')
  .description('Allocate a port for given project, branch and purpose (idempotent).')
  .requiredOption('-p, --project <project>', 'Project name')
  .requiredOption('-b, --branch <branch>', 'Branch name')
  .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
  .option('-n, --name <name>', 'Component/service name (default: default)')
  .option('-F, --fail-if-exists', 'Fail if the tuple already exists instead of returning existing port', false)
  .action((cmdOpts: { project: string; branch: string; purpose: string; name?: string; failIfExists?: boolean }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const project = sanitizeText(cmdOpts.project, 'project');
    const branch = sanitizeText(cmdOpts.branch, 'branch');
    const purpose = ensurePurpose(cmdOpts.purpose);
    const name = (cmdOpts.name ?? 'default').trim() || 'default';
    const port = allocatePort(opts.db, project, branch, purpose, { failIfExists: !!cmdOpts.failIfExists, name });
    printResult(mode, { project, branch, purpose, name, port, db: opts.db ?? resolveDefaultDBPath() });
  });

program
  .command('get')
  .description('Get the port for given project, branch and purpose.')
  .requiredOption('-p, --project <project>', 'Project name')
  .requiredOption('-b, --branch <branch>', 'Branch name')
  .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
  .option('-n, --name <name>', 'Component/service name (default: default)')
  .action((cmdOpts: { project: string; branch: string; purpose: string; name?: string }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const project = sanitizeText(cmdOpts.project, 'project');
    const branch = sanitizeText(cmdOpts.branch, 'branch');
    const purpose = ensurePurpose(cmdOpts.purpose);
    const name = (cmdOpts.name ?? 'default').trim() || 'default';
    // Reuse core get by adding name support via list + filter for simplicity
    const rows = listBindings(opts.db).filter(r => r.project === project && r.branch === branch && r.purpose === purpose && r.name === name);
    if (rows.length === 0) fail('Not found');
    const port = rows[0].port;
    printResult(mode, { project, branch, purpose, name, port, db: opts.db ?? resolveDefaultDBPath() });
  });

program
  .command('delete')
  .description('Delete a binding by key (project/branch/purpose/name) or by --port.')
  .option('-p, --project <project>', 'Project name')
  .option('-b, --branch <branch>', 'Branch name')
  .option('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
  .option('-n, --name <name>', 'Component/service name (default: default)')
  .option('-P, --port <port>', 'Delete by port number')
  .option('-R, --range <start-end>', 'Delete all bindings whose port in range START-END')
  .option('-A, --all', 'Delete all matches for the provided filters (requires at least --project)', false)
  .option('-K, --kill', 'Kill listeners on the matched ports before deletion', false)
  .option('-y, --yes', 'Confirm deleting multiple entries (non-interactive)', false)
  .option('-d, --dry-run', 'Preview actions without killing or deleting', false)
  .option('-f, --force', 'Delete records even if port cannot be freed', false)
  .action(async (cmdOpts: { project?: string; branch?: string; purpose?: string; name?: string; port?: string; range?: string; all?: boolean; kill?: boolean; yes?: boolean; dryRun?: boolean; force?: boolean }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    if (cmdOpts.port && cmdOpts.range) {
      fail('Provide either --port or --range, not both.');
    }
    // Fast-path: legacy behavior when no advanced flags are used
    const advancedFlags = !!(cmdOpts.all || cmdOpts.kill || cmdOpts.dryRun || cmdOpts.force || cmdOpts.yes);

    if (cmdOpts.range && !advancedFlags) {
      const m = cmdOpts.range.match(/^(\d+)-(\d+)$/);
      if (!m) fail('Invalid --range. Use START-END');
      let start = parseInt(m[1], 10);
      let end = parseInt(m[2], 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < 1 || start > 65535 || end > 65535) {
        fail('Ports in --range must be 1-65535');
      }
      const { count, ports } = deleteByRange(opts.db, start, end);
      if (mode === 'json') {
        printResult(mode, { range: { start: Math.min(start, end), end: Math.max(start, end) }, deleted: count, ports, db: opts.db ?? resolveDefaultDBPath() });
      } else {
        process.stdout.write(`Deleted ${count} bindings in range ${Math.min(start, end)}-${Math.max(start, end)}\n`);
      }
      return;
    }
    if (cmdOpts.port && !advancedFlags) {
      const port = parseInt(cmdOpts.port, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid --port');
      const ok = deleteByPort(opts.db, port);
      if (!ok) fail('Not found');
      printResult(mode, { port, deleted: true, db: opts.db ?? resolveDefaultDBPath() });
      return;
    }
    // Advanced path: supports --kill / --all / --dry-run / --force / --yes
    // Build match set
    type Item = { project: string; branch: string; purpose: string; name: string; port: number };
    let matches: Item[] = [];

    if (cmdOpts.range) {
      const m = cmdOpts.range.match(/^(\d+)-(\d+)$/);
      if (!m) fail('Invalid --range. Use START-END');
      let start = parseInt(m[1], 10);
      let end = parseInt(m[2], 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < 1 || start > 65535 || end > 65535) {
        fail('Ports in --range must be 1-65535');
      }
      const rows = listBindingsByPortRange(opts.db, start, end);
      matches = rows.map(r => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
    } else if (cmdOpts.port) {
      const port = parseInt(cmdOpts.port, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid --port');
      const row = getBindingByPort(opts.db, port);
      if (!row) fail('Not found');
      matches = [{ project: row.project, branch: row.branch, purpose: row.purpose, name: row.name, port: row.port }];
    } else if (cmdOpts.all) {
      if (!cmdOpts.project) fail('When using --all, at least --project is required');
      const project = sanitizeText(cmdOpts.project!, 'project');
      const branch = cmdOpts.branch ? sanitizeText(cmdOpts.branch, 'branch') : undefined;
      const purpose = cmdOpts.purpose ? ensurePurpose(cmdOpts.purpose) : undefined;
      const rows = listBindingsFiltered(opts.db, { project, branch, purpose, name: undefined });
      matches = rows.map(r => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
    } else {
      // Expect full key delete (project/branch/purpose[/name])
      if (!cmdOpts.project || !cmdOpts.branch || !cmdOpts.purpose) {
        fail('Provide either --port/--range, or all of --project, --branch, --purpose [--name]');
      }
      const project = sanitizeText(cmdOpts.project!, 'project');
      const branch = sanitizeText(cmdOpts.branch!, 'branch');
      const purpose = ensurePurpose(cmdOpts.purpose!);
      const name = (cmdOpts.name ?? 'default').trim() || 'default';
      const rows = listBindingsFiltered(opts.db, { project, branch, purpose, name });
      if (rows.length === 0) fail('Not found');
      matches = rows.map(r => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
    }

    if (matches.length === 0) {
      if (mode === 'json') { printResult(mode, { matched: 0, deleted: 0, items: [], db: opts.db ?? resolveDefaultDBPath() }); return; }
      fail('No matching bindings');
    }

    // If multiple and not confirmed and not dry-run, abort to prevent accidental mass deletion
    if (matches.length > 1 && !cmdOpts.yes && !cmdOpts.dryRun) {
      fail(`Matched ${matches.length} items. Re-run with --yes to proceed, or use --dry-run to preview.`);
    }

    // Process items one by one
    const results: Array<{ project: string; branch: string; purpose: string; name: string; port: number; killed_pids?: number[]; deleted: boolean; reason?: string }>
      = [];
    for (const m of matches) {
      if (cmdOpts.dryRun) {
        const pids = await findPidsByPort(m.port);
        results.push({ ...m, killed_pids: cmdOpts.kill ? pids : [], deleted: false, reason: 'dry-run' });
        continue;
      }
      try {
        if (cmdOpts.kill) {
          try {
            const { killed } = await killPortOccupants(m.port);
            results.push({ ...m, killed_pids: killed, deleted: false });
          } catch (e: any) {
            if (!cmdOpts.force) {
              results.push({ ...m, deleted: false, reason: `kill failed: ${e?.message || String(e)}` });
              continue;
            } else {
              results.push({ ...m, killed_pids: [], deleted: false, reason: `kill failed but forcing delete: ${e?.message || String(e)}` });
            }
          }
        } else {
          // If not killing, ensure the port is free unless forcing deletion
          if (!cmdOpts.force) {
            const free = await isPortFree(m.port);
            if (!free) {
              results.push({ ...m, deleted: false, reason: 'port occupied; use --kill or --force to delete record anyway' });
              continue;
            }
          }
        }
        const ok = deleteByPort(opts.db, m.port);
        if (!ok) {
          results.push({ ...m, deleted: false, reason: 'not found (already deleted?)' });
        } else {
          // Mark this entry as deleted
          const last = results[results.length - 1];
          if (last && last.port === m.port) {
            last.deleted = true;
          } else {
            results.push({ ...m, deleted: true });
          }
        }
      } catch (e: any) {
        results.push({ ...m, deleted: false, reason: e?.message || String(e) });
      }
    }

    const deletedCount = results.filter(r => r.deleted).length;
    if (mode === 'json') {
      printResult(mode, { matched: matches.length, deleted: deletedCount, items: results, db: opts.db ?? resolveDefaultDBPath() });
    } else {
      for (const r of results) {
        const head = `${r.project}/${r.branch}/${r.purpose}/${r.name} port=${r.port}`;
        if (r.deleted) {
          process.stdout.write(`${head} -> deleted${r.killed_pids && r.killed_pids.length ? ` (killed: ${r.killed_pids.join(',')})` : ''}\n`);
        } else {
          process.stdout.write(`${head} -> skipped${r.reason ? ` (${r.reason})` : ''}\n`);
        }
      }
      process.stdout.write(`\nDeleted ${deletedCount} of ${matches.length} matching bindings.\n`);
    }
  });

program
  .command('list')
  .alias('ls')
  .alias('view')
  .description('List all bindings in a table (or JSON with --json).')
  .option('-p, --project <project>', 'Filter by project')
  .option('-b, --branch <branch>', 'Filter by branch')
  .option('-u, --purpose <purpose>', 'Filter by purpose')
  .option('-n, --name <name>', 'Filter by name')
  .action((cmdOpts: { project?: string; branch?: string; purpose?: string; name?: string }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const rows = listBindingsFiltered(opts.db, {
      project: cmdOpts.project,
      branch: cmdOpts.branch,
      purpose: cmdOpts.purpose ? normalizePurpose(cmdOpts.purpose) : undefined,
      name: cmdOpts.name,
    });
    if (mode === 'json') {
      printResult('json', { db: opts.db ?? resolveDefaultDBPath(), count: rows.length, items: rows });
      return;
    }
    if (rows.length === 0) {
      process.stdout.write('No bindings found.\n');
      return;
    }
    const headers = ['PROJECT', 'BRANCH', 'PURPOSE', 'NAME', 'CLAIMED', 'PORT', 'CREATED_AT', 'UPDATED_AT'];
    const widths = [
      Math.max(headers[0].length, ...rows.map(r => r.project.length)),
      Math.max(headers[1].length, ...rows.map(r => r.branch.length)),
      Math.max(headers[2].length, ...rows.map(r => r.purpose.length)),
      Math.max(headers[3].length, ...rows.map(r => r.name.length)),
      Math.max(headers[4].length, ...rows.map(r => String(r.claimed ?? 0).length)),
      Math.max(headers[5].length, ...rows.map(r => String(r.port).length)),
      Math.max(headers[6].length, ...rows.map(r => r.created_at.length)),
      Math.max(headers[7].length, ...rows.map(r => r.updated_at.length)),
    ];
    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
    const line = (cols: string[]) => cols.map((c, i) => pad(c, widths[i])).join('  ') + '\n';
    process.stdout.write(line(headers));
    process.stdout.write(line(widths.map(w => '-'.repeat(w))));
    for (const r of rows) {
      process.stdout.write(
        line([r.project, r.branch, r.purpose, r.name, String(r.claimed ?? 0), String(r.port), r.created_at, r.updated_at])
      );
    }
    process.stdout.write(`\nTotal: ${rows.length}  DB: ${opts.db ?? resolveDefaultDBPath()}\n`);
  });

program
  .command('claim')
  .description('Safely claim a port for a given key, or, with --savage, reclaim it if currently occupied.')
  .requiredOption('-p, --project <project>', 'Project name')
  .requiredOption('-b, --branch <branch>', 'Branch name')
  .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
  .option('-n, --name <name>', 'Component/service name (default: default)')
  .option('-S, --savage', 'Reclaim the bound port by killing current listeners if occupied (only when record exists)', false)
  .action(async (cmdOpts: { project: string; branch: string; purpose: string; name?: string; savage?: boolean }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const project = sanitizeText(cmdOpts.project, 'project');
    const branch = sanitizeText(cmdOpts.branch, 'branch');
    const purpose = ensurePurpose(cmdOpts.purpose);
    const name = (cmdOpts.name ?? 'default').trim() || 'default';
    const port = await claimPort(opts.db, project, branch, purpose, name, { savage: !!cmdOpts.savage });
    printResult(mode, { project, branch, purpose, name, port, db: opts.db ?? resolveDefaultDBPath(), savage: !!cmdOpts.savage });
  });

// Purpose range management
program
  .command('purpose')
  .description('Manage custom purpose port ranges')
  .command('set <purpose> <range>')
  .description('Set or override a purpose range, e.g. job 9000-9099 or override frontend/backend')
  .action((purpose: string, range: string) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const m = range.match(/^(\d+)-(\d+)$/);
    if (!m) fail('Invalid range. Use START-END');
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > 65535 || end > 65535) {
      fail('Ports in range must be 1-65535');
    }
    const p = normalizePurpose(purpose);
    const ctx = require('./db');
    const { db } = ctx.openDB(opts.db);
    try {
      db.prepare('INSERT INTO purpose_ranges(purpose,start,end,is_custom) VALUES(?,?,?,1) ON CONFLICT(purpose) DO UPDATE SET start=excluded.start, end=excluded.end, is_custom=1, updated_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')').run(p, Math.min(start, end), Math.max(start, end));
      if (mode === 'json') {
        printResult('json', { purpose: p, start: Math.min(start, end), end: Math.max(start, end) });
      } else {
        process.stdout.write(`Set purpose '${p}' to ${Math.min(start, end)}-${Math.max(start, end)}\n`);
      }
    } finally {
      ctx.closeDB({ db, dbPath: '' });
    }
  });

program
  .command('purpose-get <purpose>')
  .description('Get effective purpose range (custom or built-in)')
  .action((purpose: string) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const p = normalizePurpose(purpose);
    const { db } = require('./db').openDB(opts.db);
    try {
      const row = db.prepare('SELECT start, end FROM purpose_ranges WHERE purpose = ?').get(p) as { start: number; end: number } | undefined;
      let range = row ? row : undefined;
      if (!range && (p === 'frontend' || p === 'backend')) {
        const def = require('./ranges').PURPOSE_RANGES[p];
        range = def;
      }
      if (!range) fail(`No range for purpose '${p}'`);
      printResult(mode, { purpose: p, start: range.start, end: range.end });
    } finally {
      require('./db').closeDB({ db, dbPath: '' });
    }
  });

program
  .command('purpose-list')
  .description('List all custom purpose ranges')
  .action(() => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const { db } = require('./db').openDB(opts.db);
    try {
      const rows = db.prepare('SELECT purpose, start, end, is_custom, updated_at FROM purpose_ranges ORDER BY purpose').all();
      if (mode === 'json') {
        printResult('json', { count: rows.length, items: rows });
      } else {
        if (rows.length === 0) { process.stdout.write('No custom purposes.\n'); return; }
        const headers = ['PURPOSE','START','END','UPDATED_AT'];
        const w = [headers[0].length, headers[1].length, headers[2].length, headers[3].length];
        for (const r of rows) {
          w[0] = Math.max(w[0], String(r.purpose).length);
          w[1] = Math.max(w[1], String(r.start).length);
          w[2] = Math.max(w[2], String(r.end).length);
          w[3] = Math.max(w[3], String(r.updated_at).length);
        }
        const pad = (s: string, ww: number) => s + ' '.repeat(Math.max(0, ww - s.length));
        const line = (cols: string[]) => cols.map((c, i) => pad(c, w[i])).join('  ') + '\n';
        process.stdout.write(line(headers));
        process.stdout.write(line(w.map(n => '-'.repeat(n))));
        for (const r of rows) process.stdout.write(line([r.purpose, String(r.start), String(r.end), r.updated_at]));
      }
    } finally {
      require('./db').closeDB({ db, dbPath: '' });
    }
  });

program
  .command('purpose-delete <purpose>')
  .description('Delete a custom purpose range (builtin purposes will fall back to defaults)')
  .action((purpose: string) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const p = normalizePurpose(purpose);
    const { db } = require('./db').openDB(opts.db);
    try {
      const res = db.prepare('DELETE FROM purpose_ranges WHERE purpose = ?').run(p);
      if (mode === 'json') printResult('json', { purpose: p, deleted: res.changes ?? 0 });
      else process.stdout.write(`Deleted ${res.changes ?? 0} rows for purpose '${p}'\n`);
    } finally {
      require('./db').closeDB({ db, dbPath: '' });
    }
  });

// Reserved ports management
program
  .command('reserved')
  .description('Manage reserved ports (allocator/claimer will skip these)')
  .command('add <port> [reason...]')
  .description('Reserve a port with optional reason')
  .action((portStr: string, reasonParts: string[]) => {
    const port = parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid port');
    const reason = (reasonParts || []).join(' ') || null;
    const opts = program.opts<CommonOpts>();
    const { db } = require('./db').openDB(opts.db);
    try {
      db.prepare('INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES(?, ?)').run(port, reason);
      process.stdout.write(`Reserved port ${port}${reason ? ` (${reason})` : ''}\n`);
    } finally { require('./db').closeDB({ db, dbPath: '' }); }
  });

program
  .command('reserved-remove <port>')
  .description('Unreserve a port')
  .action((portStr: string) => {
    const port = parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid port');
    const opts = program.opts<CommonOpts>();
    const { db } = require('./db').openDB(opts.db);
    try {
      const res = db.prepare('DELETE FROM reserved_ports WHERE port = ?').run(port);
      process.stdout.write(`Removed ${res.changes ?? 0} reservations for port ${port}\n`);
    } finally { require('./db').closeDB({ db, dbPath: '' }); }
  });

program
  .command('reserved-list')
  .description('List reserved ports')
  .action(() => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const { db } = require('./db').openDB(opts.db);
    try {
      const rows = db.prepare('SELECT port, reason, created_at FROM reserved_ports ORDER BY port').all();
      if (mode === 'json') printResult('json', { count: rows.length, items: rows });
      else {
        if (rows.length === 0) { process.stdout.write('No reserved ports.\n'); return; }
        const headers = ['PORT','REASON','CREATED_AT'];
        const w = [headers[0].length, headers[1].length, headers[2].length];
        for (const r of rows) {
          w[0] = Math.max(w[0], String(r.port).length);
          w[1] = Math.max(w[1], String(r.reason || '').length);
          w[2] = Math.max(w[2], String(r.created_at).length);
        }
        const pad = (s: string, ww: number) => s + ' '.repeat(Math.max(0, ww - s.length));
        const line = (cols: string[]) => cols.map((c, i) => pad(c, w[i])).join('  ') + '\n';
        process.stdout.write(line(headers));
        process.stdout.write(line(w.map(n => '-'.repeat(n))));
        for (const r of rows) process.stdout.write(line([String(r.port), String(r.reason || ''), String(r.created_at)]));
      }
    } finally { require('./db').closeDB({ db, dbPath: '' }); }
  });

program
  .command('migrate')
  .description('Show DB schema version and optionally apply automatic migrations')
  .option('-s, --status', 'Show current DB and code schema versions', false)
  .option('-a, --apply', 'Apply migrations to upgrade DB to current schema', false)
  .action((cmdOpts: { status?: boolean; apply?: boolean }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const ctx = openDB(opts.db);
    try {
      const dbVer = getDbVersion(ctx.db);
      if (cmdOpts.apply) {
        // maybeMigrate is called inside openDB already; re-open to ensure idempotent run
        closeDB(ctx);
        const ctx2 = openDB(opts.db);
        const newVer = getDbVersion(ctx2.db);
        closeDB(ctx2);
        if (mode === 'json') {
          printResult('json', { db: opts.db ?? resolveDefaultDBPath(), code_version: CODE_SCHEMA_VERSION, db_version: newVer, migrated: true });
        } else {
          process.stdout.write(`Migrated. DB schema=${newVer}, code schema=${CODE_SCHEMA_VERSION}\n`);
        }
        return;
      }
      // status
      if (mode === 'json') {
        printResult('json', { db: opts.db ?? resolveDefaultDBPath(), code_version: CODE_SCHEMA_VERSION, db_version: dbVer });
      } else {
        process.stdout.write(`DB schema=${dbVer ?? 'unknown'}, code schema=${CODE_SCHEMA_VERSION}\n`);
      }
    } finally {
      try { closeDB(ctx); } catch {}
    }
  });

program
  .command('find')
  .alias('free')
  .description('Find a free OS port (and by default, not already registered) from a given port or range START-END')
  .argument('<spec>', 'Port or range, e.g. 3000 or 3000-3999')
  .option('-I, --include-registered', 'Ignore DB registrations; only check OS occupancy', false)
  .option('-R, --include-reserved', 'Ignore reserved ports; only check registration/OS', false)
  .action(async (spec: string, cmdOpts: { includeRegistered?: boolean; includeReserved?: boolean }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const m = spec.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) fail('Invalid spec. Use PORT or START-END');
    let start = parseInt(m[1], 10);
    let end = m[2] ? parseInt(m[2], 10) : start;
    if (Number.isNaN(start) || Number.isNaN(end)) fail('Invalid numbers in spec');
    if (start < 1 || start > 65535 || end < 1 || end > 65535) fail('Port must be 1-65535');
    const port = await findFreePort(opts.db, start, end, { includeRegistered: !!cmdOpts.includeRegistered, includeReserved: !!cmdOpts.includeReserved });
    printResult(mode, { port, start: Math.min(start, end), end: Math.max(start, end), db: opts.db ?? resolveDefaultDBPath(), includeRegistered: !!cmdOpts.includeRegistered, includeReserved: !!cmdOpts.includeReserved });
  });

program.parseAsync().catch((err) => {
  process.stderr.write((err?.message || String(err)) + '\n');
  process.exit(1);
});
program
  .command('mcp')
  .description('Start MCP server over stdio exposing vibe-ports tools')
  .action(async () => {
    const opts = program.opts<CommonOpts>();
    await startMCP(opts.db);
  });
