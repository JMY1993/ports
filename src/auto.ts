import { Command } from 'commander';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveDefaultDBPath } from './db';
import { normalizePurpose, Purpose } from './ranges';
import { listBindingsFiltered, getBindingByPort, listBindingsByPortRange, deleteByPort, claimPort } from './core';

function tryExec(cmd: string): string | null {
  try {
    const stdout = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], shell: '/bin/bash' }).toString();
    return stdout.trim();
  } catch {
    return null;
  }
}

function deriveFromGit(): { project: string; branch: string; slug: string; slug_pg: string } {
  let project = '';
  const remote = tryExec('git remote get-url origin 2>/dev/null');
  if (remote && remote.length > 0) {
    const m = remote.match(/([^\/]+?)(?:\.git)?$/);
    if (m) project = m[1];
  }
  if (!project) {
    const toplevel = tryExec('git rev-parse --show-toplevel 2>/dev/null');
    if (toplevel && toplevel.length > 0) project = path.basename(toplevel);
  }
  if (!project) {
    project = path.basename(process.cwd());
  }
  let branch = tryExec('git symbolic-ref --short -q HEAD') || '';
  if (!branch) branch = tryExec('git rev-parse --short HEAD') || '';
  if (!branch) branch = 'nogit';
  const slugRaw = `${project}-${branch}`;
  const slug = slugRaw.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const hash = createHash('sha1').update(slug).digest('hex').slice(0, 6);
  const base = slug.length > 56 ? slug.slice(0, 56) : slug;
  const slug_pg = `${base}_${hash}`;
  return { project, branch, slug, slug_pg };
}

function ensurePurpose(input: string): Purpose {
  const s = (input ?? '').toString().trim();
  if (!s) throw new Error('purpose is required');
  return normalizePurpose(s);
}

export function registerAuto(program: Command) {
  const auto = program
    .command('auto')
    .description('Use Git to derive project and branch, then run subcommands');
  auto
    .command('keys')
    .description('Print derived keys from Git (project, branch, slug, slug_pg)')
    .action(() => {
      const keys = deriveFromGit();
      process.stdout.write(JSON.stringify(keys) + '\n');
    });
  // auto claim
  auto
    .command('claim')
    .description('Claim a port using project/branch derived from Git')
    .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
    .option('-n, --name <name>', 'Component/service name (default: default)')
    .option('-S, --savage', 'Reclaim the bound port by killing current listeners if occupied (only when record exists)', false)
    .option('-D, --db <path>', 'Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)')
    .option('-j, --json', 'Output JSON', false)
    .action(async (cmdOpts: { purpose: string; name?: string; savage?: boolean; db?: string; json?: boolean }) => {
      const { project, branch } = deriveFromGit();
      const purpose = ensurePurpose(cmdOpts.purpose);
      const name = (cmdOpts.name ?? 'default').trim() || 'default';
      const port = await claimPort(cmdOpts.db, project, branch, purpose, name, { savage: !!cmdOpts.savage });
      const json = !!(cmdOpts.json || (program.opts() as any)?.json);
      if (json) {
        process.stdout.write(JSON.stringify({ project, branch, purpose, name, port, db: cmdOpts.db ?? resolveDefaultDBPath(), savage: !!cmdOpts.savage }) + '\n');
      } else {
        process.stdout.write(String(port) + '\n');
      }
    });
  // auto get
  auto
    .command('get')
    .description('Get the port using project/branch derived from Git')
    .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
    .option('-n, --name <name>', 'Component/service name (default: default)')
    .option('-D, --db <path>', 'Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)')
    .option('-j, --json', 'Output JSON', false)
    .action((cmdOpts: { purpose: string; name?: string; db?: string; json?: boolean }) => {
      const { project, branch } = deriveFromGit();
      const purpose = ensurePurpose(cmdOpts.purpose);
      const name = (cmdOpts.name ?? 'default').trim() || 'default';
      const rows = listBindingsFiltered(cmdOpts.db, { project, branch, purpose, name });
      if (rows.length === 0) throw new Error('Not found');
      const port = rows[0].port;
      const json = !!(cmdOpts.json || (program.opts() as any)?.json);
      if (json) {
        process.stdout.write(JSON.stringify({ project, branch, purpose, name, port, db: cmdOpts.db ?? resolveDefaultDBPath() }) + '\n');
      } else {
        process.stdout.write(String(port) + '\n');
      }
    });
  // auto delete (delegates to core with derived filters)
  auto
    .command('delete')
    .description('Delete bindings using project/branch derived from Git')
    .option('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
    .option('-n, --name <name>', 'Component/service name (default: default)')
    .option('-A, --all', 'Delete all matches for the derived project/branch (optionally filtered by purpose)', false)
    .option('-K, --kill', 'Kill listeners on the matched ports before deletion', false)
    .option('-y, --yes', 'Confirm deleting multiple entries (non-interactive)', false)
    .option('-d, --dry-run', 'Preview actions without killing or deleting', false)
    .option('-f, --force', 'Delete records even if port cannot be freed', false)
    .option('-P, --port <port>', 'Delete by port number (ignores git-derived keys)')
    .option('-R, --range <start-end>', 'Delete all bindings whose port in range START-END (ignores git-derived keys)')
    .option('-D, --db <path>', 'Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)')
    .option('-j, --json', 'Output JSON', false)
    .action(async (cmdOpts: { purpose?: string; name?: string; all?: boolean; kill?: boolean; yes?: boolean; dryRun?: boolean; force?: boolean; port?: string; range?: string; db?: string; json?: boolean }) => {
      const { project, branch } = deriveFromGit();
      const json = !!(cmdOpts.json || (program.opts() as any)?.json);
      type Item = { project: string; branch: string; purpose: string; name: string; port: number };
      let matches: Item[] = [];
      if (cmdOpts.port && cmdOpts.range) throw new Error('Provide either --port or --range, not both.');
      if (cmdOpts.range) {
        const m = cmdOpts.range.match(/^(\d+)-(\d+)$/);
        if (!m) throw new Error('Invalid --range. Use START-END');
        let start = parseInt(m[1], 10);
        let end = parseInt(m[2], 10);
        if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < 1 || start > 65535 || end > 65535) throw new Error('Ports in --range must be 1-65535');
        const rows = listBindingsByPortRange(cmdOpts.db, start, end);
        matches = rows.map(r => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
      } else if (cmdOpts.port) {
        const port = parseInt(cmdOpts.port, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
        const row = getBindingByPort(cmdOpts.db, port);
        if (!row) throw new Error('Not found');
        matches = [{ project: row.project, branch: row.branch, purpose: row.purpose, name: row.name, port: row.port }];
      } else {
        if (cmdOpts.all) {
          const rows = listBindingsFiltered(cmdOpts.db, { project, branch, purpose: cmdOpts.purpose ? ensurePurpose(cmdOpts.purpose) : undefined, name: undefined });
          matches = rows.map(r => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
        } else {
          if (!cmdOpts.purpose) throw new Error('Provide --purpose or use --all for batch delete');
          const purpose = ensurePurpose(cmdOpts.purpose);
          const name = (cmdOpts.name ?? 'default').trim() || 'default';
          const rows = listBindingsFiltered(cmdOpts.db, { project, branch, purpose, name });
          if (rows.length === 0) throw new Error('Not found');
          matches = rows.map(r => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
        }
      }
      if (matches.length === 0) {
        if (json) process.stdout.write(JSON.stringify({ matched: 0, deleted: 0, items: [], db: cmdOpts.db ?? resolveDefaultDBPath() }) + '\n');
        else process.stderr.write('No matching bindings\n');
        process.exit(matches.length === 0 ? 1 : 0);
      }
      if (matches.length > 1 && !cmdOpts.yes && !cmdOpts.dryRun) {
        process.stderr.write(`Matched ${matches.length} items. Re-run with --yes to proceed, or use --dry-run to preview.\n`);
        process.exit(1);
      }
      const results: Array<{ project: string; branch: string; purpose: string; name: string; port: number; killed_pids?: number[]; deleted: boolean; reason?: string }> = [];
      for (const m of matches) {
        if (cmdOpts.dryRun) {
          const { findPidsByPort } = await import('./netutil');
          const pids = await findPidsByPort(m.port);
          results.push({ ...m, killed_pids: cmdOpts.kill ? pids : [], deleted: false, reason: 'dry-run' });
          continue;
        }
        try {
          if (cmdOpts.kill) {
            try {
              const { killPortOccupants } = await import('./netutil');
              const { killed } = await killPortOccupants(m.port);
              results.push({ ...m, killed_pids: killed, deleted: false });
            } catch (e: any) {
              if (!cmdOpts.force) { results.push({ ...m, deleted: false, reason: `kill failed: ${e?.message || String(e)}` }); continue; }
              else { results.push({ ...m, killed_pids: [], deleted: false, reason: `kill failed but forcing delete: ${e?.message || String(e)}` }); }
            }
          } else {
            if (!cmdOpts.force) {
              const { isPortFree } = await import('./netutil');
              const free = await isPortFree(m.port);
              if (!free) { results.push({ ...m, deleted: false, reason: 'port occupied; use --kill or --force to delete record anyway' }); continue; }
            }
          }
          const ok = deleteByPort(cmdOpts.db, m.port);
          if (!ok) results.push({ ...m, deleted: false, reason: 'not found (already deleted?)' });
          else {
            const last = results[results.length - 1];
            if (last && last.port === m.port) last.deleted = true; else results.push({ ...m, deleted: true });
          }
        } catch (e: any) {
          results.push({ ...m, deleted: false, reason: e?.message || String(e) });
        }
      }
      const deletedCount = results.filter(r => r.deleted).length;
      if (json) process.stdout.write(JSON.stringify({ matched: matches.length, deleted: deletedCount, items: results, db: cmdOpts.db ?? resolveDefaultDBPath() }) + '\n');
      else {
        for (const r of results) {
          const head = `${r.project}/${r.branch}/${r.purpose}/${r.name} port=${r.port}`;
          if (r.deleted) process.stdout.write(`${head} -> deleted${r.killed_pids && r.killed_pids.length ? ` (killed: ${r.killed_pids.join(',')})` : ''}\n`);
          else process.stdout.write(`${head} -> skipped${r.reason ? ` (${r.reason})` : ''}\n`);
        }
        process.stdout.write(`\nDeleted ${deletedCount} of ${matches.length} matching bindings.\n`);
      }
    });
  // auto list
  auto
    .command('list')
    .description('List bindings for derived project/branch (optional filters)')
    .option('-u, --purpose <purpose>', 'Filter by purpose')
    .option('-n, --name <name>', 'Filter by name')
    .option('-D, --db <path>', 'Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)')
    .option('-j, --json', 'Output JSON', false)
    .action((cmdOpts: { purpose?: string; name?: string; db?: string; json?: boolean }) => {
      const { project, branch } = deriveFromGit();
      const purpose = cmdOpts.purpose ? normalizePurpose(cmdOpts.purpose) : undefined;
      const name = cmdOpts.name;
      const rows = listBindingsFiltered(cmdOpts.db, { project, branch, purpose, name });
      const json = !!(cmdOpts.json || (program.opts() as any)?.json);
      if (json) {
        process.stdout.write(JSON.stringify({ db: cmdOpts.db ?? resolveDefaultDBPath(), count: rows.length, items: rows, project, branch }) + '\n');
        return;
      }
      if (rows.length === 0) { process.stdout.write('No bindings found.\n'); return; }
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
        process.stdout.write(line([r.project, r.branch, r.purpose, r.name, String(r.claimed ?? 0), String(r.port), r.created_at, r.updated_at]));
      }
      process.stdout.write(`\nTotal: ${rows.length}  DB: ${cmdOpts.db ?? resolveDefaultDBPath()} (project=${project}, branch=${branch})\n`);
    });
}
