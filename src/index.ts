#!/usr/bin/env node
import { Command } from 'commander';
import { resolveDefaultDBPath } from './db';
import { normalizePurpose, Purpose } from './ranges';
import { allocatePort, getPort, deleteBinding, listBindings } from './core';

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
  .version('0.1.0', '-v, --version', 'Show version')
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
  .action((cmdOpts: { project: string; branch: string; purpose: string }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const project = sanitizeText(cmdOpts.project, 'project');
    const branch = sanitizeText(cmdOpts.branch, 'branch');
    const purpose = ensurePurpose(cmdOpts.purpose);
    const port = allocatePort(opts.db, project, branch, purpose);
    printResult(mode, { project, branch, purpose, port, db: opts.db ?? resolveDefaultDBPath() });
  });

program
  .command('get')
  .description('Get the port for given project, branch and purpose.')
  .requiredOption('-p, --project <project>', 'Project name')
  .requiredOption('-b, --branch <branch>', 'Branch name')
  .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
  .action((cmdOpts: { project: string; branch: string; purpose: string }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const project = sanitizeText(cmdOpts.project, 'project');
    const branch = sanitizeText(cmdOpts.branch, 'branch');
    const purpose = ensurePurpose(cmdOpts.purpose);
    const port = getPort(opts.db, project, branch, purpose);
    printResult(mode, { project, branch, purpose, port, db: opts.db ?? resolveDefaultDBPath() });
  });

program
  .command('delete')
  .description('Delete the binding for given project, branch and purpose.')
  .requiredOption('-p, --project <project>', 'Project name')
  .requiredOption('-b, --branch <branch>', 'Branch name')
  .requiredOption('-u, --purpose <purpose>', "Purpose: 'frontend' | 'backend'")
  .action((cmdOpts: { project: string; branch: string; purpose: string }) => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const project = sanitizeText(cmdOpts.project, 'project');
    const branch = sanitizeText(cmdOpts.branch, 'branch');
    const purpose = ensurePurpose(cmdOpts.purpose);
    const ok = deleteBinding(opts.db, project, branch, purpose);
    if (!ok) fail('Not found');
    printResult(mode, { project, branch, purpose, deleted: true, db: opts.db ?? resolveDefaultDBPath() });
  });

program
  .command('list')
  .alias('ls')
  .alias('view')
  .description('List all bindings in a table (or JSON with --json).')
  .action(() => {
    const opts = program.opts<CommonOpts>();
    const mode = toOutputMode(opts);
    const rows = listBindings(opts.db);
    if (mode === 'json') {
      printResult('json', { db: opts.db ?? resolveDefaultDBPath(), count: rows.length, items: rows });
      return;
    }
    if (rows.length === 0) {
      process.stdout.write('No bindings found.\n');
      return;
    }
    const headers = ['PROJECT', 'BRANCH', 'PURPOSE', 'PORT', 'CREATED_AT', 'UPDATED_AT'];
    const widths = [
      Math.max(headers[0].length, ...rows.map(r => r.project.length)),
      Math.max(headers[1].length, ...rows.map(r => r.branch.length)),
      Math.max(headers[2].length, ...rows.map(r => r.purpose.length)),
      Math.max(headers[3].length, ...rows.map(r => String(r.port).length)),
      Math.max(headers[4].length, ...rows.map(r => r.created_at.length)),
      Math.max(headers[5].length, ...rows.map(r => r.updated_at.length)),
    ];
    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
    const line = (cols: string[]) => cols.map((c, i) => pad(c, widths[i])).join('  ') + '\n';
    process.stdout.write(line(headers));
    process.stdout.write(line(widths.map(w => '-'.repeat(w))));
    for (const r of rows) {
      process.stdout.write(
        line([r.project, r.branch, r.purpose, String(r.port), r.created_at, r.updated_at])
      );
    }
    process.stdout.write(`\nTotal: ${rows.length}  DB: ${opts.db ?? resolveDefaultDBPath()}\n`);
  });

program.parseAsync().catch((err) => {
  process.stderr.write((err?.message || String(err)) + '\n');
  process.exit(1);
});
