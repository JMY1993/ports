#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_commander = require("commander");

// src/db.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
function resolveDefaultDBPath() {
  const env = process.env.VIBEPORTS_DB || process.env.KVPORT_DB;
  if (env && env.trim().length > 0) return import_path.default.resolve(env);
  return import_path.default.join(import_os.default.homedir(), ".vibeports", "vibeports.sqlite3");
}
function ensureDir(filePath) {
  const dir = import_path.default.dirname(filePath);
  if (!import_fs.default.existsSync(dir)) import_fs.default.mkdirSync(dir, { recursive: true });
}
function openDB(customPath) {
  const dbPath = customPath ? import_path.default.resolve(customPath) : resolveDefaultDBPath();
  ensureDir(dbPath);
  const db = new import_better_sqlite3.default(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 2000");
  db.pragma("foreign_keys = ON");
  maybeMigrate(db);
  return { db, dbPath };
}
function maybeMigrate(db) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bindings'").get();
  if (!row) {
    const baselinePath = import_path.default.join(__dirname, "..", "db", "baseline.sql");
    const sql = import_fs.default.readFileSync(baselinePath, "utf8");
    db.exec(sql);
  } else {
    const baselinePath = import_path.default.join(__dirname, "..", "db", "baseline.sql");
    const sql = import_fs.default.readFileSync(baselinePath, "utf8");
    db.exec(sql);
  }
}
function closeDB(ctx) {
  ctx.db.close();
}

// src/ranges.ts
var PURPOSE_RANGES = {
  frontend: { start: 3e3, end: 3999 },
  backend: { start: 8e3, end: 8999 }
};
function normalizePurpose(purpose) {
  const p = purpose.trim().toLowerCase();
  if (p !== "frontend" && p !== "backend") {
    throw new Error(`Invalid purpose: ${purpose}. Expected one of: frontend, backend`);
  }
  return p;
}

// src/core.ts
function allocatePort(dbPath, project, branch, purpose) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const selectExisting = db.prepare(
      "SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ?"
    );
    const existing = selectExisting.get(project, branch, purpose);
    if (existing && typeof existing.port === "number") {
      return existing.port;
    }
    const insertStmt = db.prepare(
      "INSERT INTO bindings (project, branch, purpose, port) VALUES (?, ?, ?, ?)"
    );
    const range = PURPOSE_RANGES[purpose];
    const allocateTxn = db.transaction(() => {
      const again = selectExisting.get(project, branch, purpose);
      if (again && typeof again.port === "number") return again.port;
      for (let p = range.start; p <= range.end; p++) {
        try {
          insertStmt.run(project, branch, purpose, p);
          return p;
        } catch (err) {
          const msg = err?.message ?? "";
          const code = err?.code;
          if (code === "SQLITE_CONSTRAINT" || /UNIQUE constraint failed/.test(msg)) {
            const now = selectExisting.get(project, branch, purpose);
            if (now && typeof now.port === "number") return now.port;
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
function getPort(dbPath, project, branch, purpose) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const row = db.prepare("SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ?").get(project, branch, purpose);
    if (!row) throw new Error("Not found");
    return row.port;
  } finally {
    closeDB(ctx);
  }
}
function deleteBinding(dbPath, project, branch, purpose) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const res = db.prepare("DELETE FROM bindings WHERE project = ? AND branch = ? AND purpose = ?").run(project, branch, purpose);
    return (res.changes ?? 0) > 0;
  } finally {
    closeDB(ctx);
  }
}
function listBindings(dbPath) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const rows = db.prepare("SELECT project, branch, purpose, port, created_at, updated_at FROM bindings ORDER BY project, branch, purpose").all();
    return rows;
  } finally {
    closeDB(ctx);
  }
}

// src/index.ts
function toOutputMode(opts) {
  return opts.json ? "json" : "text";
}
function printResult(mode, payload) {
  if (mode === "json") {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } else {
    if (typeof payload === "number" || typeof payload === "string") {
      process.stdout.write(String(payload) + "\n");
    } else if (payload && typeof payload.port !== "undefined") {
      process.stdout.write(String(payload.port) + "\n");
    } else {
      process.stdout.write(JSON.stringify(payload) + "\n");
    }
  }
}
function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}
function sanitizeText(input, name) {
  const v = (input ?? "").toString().trim();
  if (!v) fail(`${name} is required`);
  return v;
}
function ensurePurpose(input) {
  try {
    return normalizePurpose(input);
  } catch (e) {
    fail(e.message);
  }
}
var program = new import_commander.Command();
program.name("ports").description("Allocate, query and delete unique ports by (project, branch, purpose).").version("0.1.0", "-v, --version", "Show version").helpOption("-h, --help", "Show help").addHelpCommand("help [command]", "Show help for command").showHelpAfterError().option("-D, --db <path>", "Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)").option("-j, --json", "Output JSON", false).hook("preAction", () => {
});
program.command("allocate").description("Allocate a port for given project, branch and purpose (idempotent).").requiredOption("-p, --project <project>", "Project name").requiredOption("-b, --branch <branch>", "Branch name").requiredOption("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const project = sanitizeText(cmdOpts.project, "project");
  const branch = sanitizeText(cmdOpts.branch, "branch");
  const purpose = ensurePurpose(cmdOpts.purpose);
  const port = allocatePort(opts.db, project, branch, purpose);
  printResult(mode, { project, branch, purpose, port, db: opts.db ?? resolveDefaultDBPath() });
});
program.command("get").description("Get the port for given project, branch and purpose.").requiredOption("-p, --project <project>", "Project name").requiredOption("-b, --branch <branch>", "Branch name").requiredOption("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const project = sanitizeText(cmdOpts.project, "project");
  const branch = sanitizeText(cmdOpts.branch, "branch");
  const purpose = ensurePurpose(cmdOpts.purpose);
  const port = getPort(opts.db, project, branch, purpose);
  printResult(mode, { project, branch, purpose, port, db: opts.db ?? resolveDefaultDBPath() });
});
program.command("delete").description("Delete the binding for given project, branch and purpose.").requiredOption("-p, --project <project>", "Project name").requiredOption("-b, --branch <branch>", "Branch name").requiredOption("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const project = sanitizeText(cmdOpts.project, "project");
  const branch = sanitizeText(cmdOpts.branch, "branch");
  const purpose = ensurePurpose(cmdOpts.purpose);
  const ok = deleteBinding(opts.db, project, branch, purpose);
  if (!ok) fail("Not found");
  printResult(mode, { project, branch, purpose, deleted: true, db: opts.db ?? resolveDefaultDBPath() });
});
program.command("list").alias("ls").alias("view").description("List all bindings in a table (or JSON with --json).").action(() => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const rows = listBindings(opts.db);
  if (mode === "json") {
    printResult("json", { db: opts.db ?? resolveDefaultDBPath(), count: rows.length, items: rows });
    return;
  }
  if (rows.length === 0) {
    process.stdout.write("No bindings found.\n");
    return;
  }
  const headers = ["PROJECT", "BRANCH", "PURPOSE", "PORT", "CREATED_AT", "UPDATED_AT"];
  const widths = [
    Math.max(headers[0].length, ...rows.map((r) => r.project.length)),
    Math.max(headers[1].length, ...rows.map((r) => r.branch.length)),
    Math.max(headers[2].length, ...rows.map((r) => r.purpose.length)),
    Math.max(headers[3].length, ...rows.map((r) => String(r.port).length)),
    Math.max(headers[4].length, ...rows.map((r) => r.created_at.length)),
    Math.max(headers[5].length, ...rows.map((r) => r.updated_at.length))
  ];
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
  const line = (cols) => cols.map((c, i) => pad(c, widths[i])).join("  ") + "\n";
  process.stdout.write(line(headers));
  process.stdout.write(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) {
    process.stdout.write(
      line([r.project, r.branch, r.purpose, String(r.port), r.created_at, r.updated_at])
    );
  }
  process.stdout.write(`
Total: ${rows.length}  DB: ${opts.db ?? resolveDefaultDBPath()}
`);
});
program.parseAsync().catch((err) => {
  process.stderr.write((err?.message || String(err)) + "\n");
  process.exit(1);
});
