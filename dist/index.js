#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/db.ts
var db_exports = {};
__export(db_exports, {
  CODE_SCHEMA_VERSION: () => CODE_SCHEMA_VERSION,
  closeDB: () => closeDB,
  ensureDir: () => ensureDir,
  getDbVersion: () => getDbVersion,
  openDB: () => openDB,
  resolveDefaultDBPath: () => resolveDefaultDBPath,
  setDbVersion: () => setDbVersion
});
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
  const baselinePath = import_path.default.join(__dirname, "..", "db", "baseline.sql");
  const hasBindings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bindings'").get();
  if (!hasBindings) {
    const sql2 = import_fs.default.readFileSync(baselinePath, "utf8");
    db.exec(sql2);
    setDbVersion(db, CODE_SCHEMA_VERSION);
    return;
  }
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);");
  let dbVersion = getDbVersion(db);
  if (dbVersion === null) {
    const cols = db.prepare("PRAGMA table_info('bindings')").all();
    const hasName = cols.some((c) => c.name === "name");
    dbVersion = hasName ? 2 : 1;
    setDbVersion(db, dbVersion);
  }
  if (dbVersion > CODE_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${dbVersion} is newer than supported ${CODE_SCHEMA_VERSION}. Please upgrade vibe-ports.`
    );
  }
  while (dbVersion < CODE_SCHEMA_VERSION) {
    if (dbVersion === 1) {
      db.exec("ALTER TABLE bindings ADD COLUMN name TEXT NOT NULL DEFAULT 'default'");
      db.exec("DROP INDEX IF EXISTS idx_bindings_unique_combo;");
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_combo ON bindings(project, branch, purpose, name);"
      );
      dbVersion = 2;
      setDbVersion(db, dbVersion);
      continue;
    }
    if (dbVersion === 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS purpose_ranges (
          purpose TEXT PRIMARY KEY,
          start INTEGER NOT NULL,
          end INTEGER NOT NULL,
          is_custom INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          CHECK (start >= 1 AND start <= 65535),
          CHECK (end >= 1 AND end <= 65535)
        );
        CREATE TABLE IF NOT EXISTS reserved_ports (
          port INTEGER PRIMARY KEY,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          CHECK (port >= 1 AND port <= 65535)
        );
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (22,'ssh');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (80,'http');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (443,'https');
      `);
      dbVersion = 3;
      setDbVersion(db, dbVersion);
      continue;
    }
    if (dbVersion === 3) {
      db.exec(`
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (3306,'mysql');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (5432,'postgres');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (6379,'redis');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (27017,'mongodb');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (9200,'elasticsearch');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (5601,'kibana');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (11211,'memcached');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (9092,'kafka');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (5672,'rabbitmq');
        INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES (15672,'rabbitmq-mgmt');
      `);
      dbVersion = 4;
      setDbVersion(db, dbVersion);
      continue;
    }
    if (dbVersion === 4) {
      const cols = db.prepare("PRAGMA table_info('bindings')").all();
      const hasClaimed = cols.some((c) => c.name === "claimed");
      if (!hasClaimed) {
        db.exec("ALTER TABLE bindings ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0");
      }
      dbVersion = 5;
      setDbVersion(db, dbVersion);
      continue;
    }
    break;
  }
  const sql = import_fs.default.readFileSync(baselinePath, "utf8");
  db.exec(sql);
}
function getDbVersion(db) {
  try {
    const r = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    if (!r) return null;
    const n = parseInt(String(r.value), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function setDbVersion(db, v) {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);");
  db.prepare("INSERT INTO meta(key,value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    String(v)
  );
}
function closeDB(ctx) {
  ctx.db.close();
}
var import_fs, import_path, import_os, import_better_sqlite3, CODE_SCHEMA_VERSION;
var init_db = __esm({
  "src/db.ts"() {
    "use strict";
    import_fs = __toESM(require("fs"));
    import_path = __toESM(require("path"));
    import_os = __toESM(require("os"));
    import_better_sqlite3 = __toESM(require("better-sqlite3"));
    CODE_SCHEMA_VERSION = 5;
  }
});

// src/ranges.ts
var ranges_exports = {};
__export(ranges_exports, {
  PURPOSE_RANGES: () => PURPOSE_RANGES,
  normalizePurpose: () => normalizePurpose
});
function normalizePurpose(purpose) {
  return purpose.trim().toLowerCase();
}
var PURPOSE_RANGES;
var init_ranges = __esm({
  "src/ranges.ts"() {
    "use strict";
    PURPOSE_RANGES = {
      frontend: { start: 3e3, end: 3999 },
      backend: { start: 8e3, end: 8999 }
    };
  }
});

// src/index.ts
var import_commander = require("commander");
init_db();
init_ranges();

// src/core.ts
init_db();
init_ranges();

// src/netutil.ts
var import_net = __toESM(require("net"));
var import_os2 = __toESM(require("os"));
var import_child_process = require("child_process");
function execCmd(cmd, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const child = (0, import_child_process.exec)(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({ code: error.code ?? 1, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
      } else {
        resolve({ code: 0, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
      }
    });
  });
}
async function isPortFree(port, host = "127.0.0.1") {
  return await new Promise((resolve) => {
    const srv = import_net.default.createServer();
    srv.once("error", () => {
      resolve(false);
    });
    srv.listen({ port, host, exclusive: true }, () => {
      srv.close(() => resolve(true));
    });
  });
}
async function findPidsByPort(port) {
  const pids = /* @__PURE__ */ new Set();
  if (import_os2.default.platform() === "win32") {
    const { code, stdout } = await execCmd(`netstat -ano | findstr :${port}`);
    if (code === 0) {
      stdout.split(/\r?\n/).forEach((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!Number.isNaN(pid)) pids.add(pid);
      });
    }
  } else {
    const lsof = await execCmd(`lsof -t -iTCP:${port} -sTCP:LISTEN`);
    if (lsof.code === 0) {
      lsof.stdout.split(/\r?\n/).forEach((s) => {
        const pid = parseInt(s.trim(), 10);
        if (!Number.isNaN(pid)) pids.add(pid);
      });
    }
    if (pids.size === 0) {
      const fuser = await execCmd(`fuser -n tcp ${port} 2>/dev/null`);
      if (fuser.code === 0) {
        fuser.stdout.replace(/\D+/g, " ").trim().split(/\s+/).forEach((s) => {
          const pid = parseInt(s, 10);
          if (!Number.isNaN(pid)) pids.add(pid);
        });
      }
    }
    if (pids.size === 0) {
      const ss = await execCmd(`ss -lntp | grep ":${port} "`);
      if (ss.code === 0) {
        const m = ss.stdout.match(/pid=(\d+)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          if (!Number.isNaN(pid)) pids.add(pid);
        }
      }
    }
  }
  return Array.from(pids);
}
async function killPortOccupants(port, opts) {
  const waitMs = opts?.waitMs ?? 2e3;
  let pids = await findPidsByPort(port);
  const killed = [];
  if (pids.length === 0) return { killed };
  if (import_os2.default.platform() === "win32") {
    for (const pid of pids) {
      await execCmd(`taskkill /PID ${pid} /T /F`, 2e3);
      killed.push(pid);
    }
  } else {
    await execCmd(`kill -TERM ${pids.join(" ")}`, 2e3);
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      if (await isPortFree(port)) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!await isPortFree(port)) {
      await execCmd(`kill -KILL ${pids.join(" ")}`, 2e3);
    }
    killed.push(...pids);
  }
  const free = await isPortFree(port);
  if (!free) {
    throw new Error(`Failed to free port ${port}`);
  }
  return { killed };
}

// src/core.ts
function getRangeForPurposeFromDB(db, purpose) {
  const row = db.prepare("SELECT start, end FROM purpose_ranges WHERE purpose = ?").get(purpose);
  if (row) return { start: row.start, end: row.end };
  if (purpose === "frontend" || purpose === "backend") {
    return PURPOSE_RANGES[purpose];
  }
  return null;
}
function allocatePort(dbPath, project, branch, purpose, opts) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const name = (opts?.name ?? "default").trim() || "default";
    const selectExisting = db.prepare(
      "SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?"
    );
    const existing = selectExisting.get(project, branch, purpose, name);
    if (existing && typeof existing.port === "number") {
      if (opts?.failIfExists) {
        throw new Error("Already exists");
      }
      return existing.port;
    }
    const insertStmt = db.prepare(
      "INSERT INTO bindings (project, branch, purpose, name, claimed, port) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const range = getRangeForPurposeFromDB(db, purpose);
    if (!range) {
      throw new Error(
        `No port range configured for purpose '${purpose}'. Use 'ports purpose set ${purpose} START-END'.`
      );
    }
    const allocateTxn = db.transaction(() => {
      const again = selectExisting.get(project, branch, purpose, name);
      if (again && typeof again.port === "number") {
        if (opts?.failIfExists) {
          throw new Error("Already exists");
        }
        return again.port;
      }
      const isReserved = db.prepare("SELECT 1 FROM reserved_ports WHERE port = ? LIMIT 1");
      for (let p = range.start; p <= range.end; p++) {
        if (isReserved.get(p)) continue;
        try {
          insertStmt.run(project, branch, purpose, name, 0, p);
          return p;
        } catch (err) {
          const msg = err?.message ?? "";
          const code = err?.code;
          if (code === "SQLITE_CONSTRAINT" || /UNIQUE constraint failed/.test(msg)) {
            const now = selectExisting.get(project, branch, purpose, name);
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
    const row = db.prepare("SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?").get(project, branch, purpose, "default");
    if (!row) throw new Error("Not found");
    return row.port;
  } finally {
    closeDB(ctx);
  }
}
function deleteBinding(dbPath, project, branch, purpose, name = "default") {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const res = db.prepare("DELETE FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?").run(project, branch, purpose, name);
    return (res.changes ?? 0) > 0;
  } finally {
    closeDB(ctx);
  }
}
function listBindings(dbPath) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const rows = db.prepare("SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings ORDER BY project, branch, purpose, name").all();
    return rows;
  } finally {
    closeDB(ctx);
  }
}
function listBindingsFiltered(dbPath, filters) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const conds = [];
    const params = [];
    if (filters?.project) {
      conds.push("project = ?");
      params.push(filters.project);
    }
    if (filters?.branch) {
      conds.push("branch = ?");
      params.push(filters.branch);
    }
    if (filters?.purpose) {
      conds.push("purpose = ?");
      params.push(filters.purpose);
    }
    if (filters?.name) {
      conds.push("name = ?");
      params.push(filters.name);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const sql = `SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings ${where} ORDER BY project, branch, purpose, name`;
    const rows = db.prepare(sql).all(...params);
    return rows;
  } finally {
    closeDB(ctx);
  }
}
async function claimPort(dbPath, project, branch, purpose, name, opts) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const select = db.prepare(
      "SELECT port FROM bindings WHERE project = ? AND branch = ? AND purpose = ? AND name = ?"
    );
    const row = select.get(project, branch, purpose, name);
    if (!row) {
      const range = getRangeForPurposeFromDB(db, purpose);
      if (!range) {
        throw new Error(
          `No port range configured for purpose '${purpose}'. Use 'ports purpose set ${purpose} START-END'.`
        );
      }
      const insert = db.prepare(
        "INSERT INTO bindings (project, branch, purpose, name, claimed, port) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const checkAgain = () => select.get(project, branch, purpose, name);
      if (checkAgain()) return checkAgain().port;
      const range2 = range;
      const insertOnce = (port) => {
        const tx = db.transaction((p) => {
          const a = checkAgain();
          if (a) return a.port;
          insert.run(project, branch, purpose, name, opts?.savage ? 1 : 0, p);
          return p;
        });
        return tx(port);
      };
      const isReserved = db.prepare("SELECT 1 FROM reserved_ports WHERE port = ? LIMIT 1");
      for (let p = range2.start; p <= range2.end; p++) {
        if (isReserved.get(p)) continue;
        const free = await isPortFree(p);
        if (!free) continue;
        try {
          const got = insertOnce(p);
          if (opts?.savage) {
            db.prepare("UPDATE bindings SET claimed = 1 WHERE port = ?").run(got);
          }
          return got;
        } catch (e) {
          continue;
        }
      }
      throw new Error(`No available port in range ${range2.start}-${range2.end} for purpose '${purpose}'.`);
    }
    const currentPort = row.port;
    if (opts?.savage) {
      const free = await isPortFree(currentPort);
      if (!free) {
        await killPortOccupants(currentPort);
      }
      db.prepare("UPDATE bindings SET claimed = 1 WHERE port = ?").run(currentPort);
      return currentPort;
    }
    return currentPort;
  } finally {
    closeDB(ctx);
  }
}
async function findFreePort(dbPath, start, end, opts) {
  if (start > end) [start, end] = [end, start];
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const isRegistered = db.prepare("SELECT 1 FROM bindings WHERE port = ? LIMIT 1");
    const isReserved = db.prepare("SELECT 1 FROM reserved_ports WHERE port = ? LIMIT 1");
    for (let p = start; p <= end; p++) {
      if (!Number.isInteger(p) || p < 1 || p > 65535) continue;
      if (!opts?.includeRegistered) {
        const used = isRegistered.get(p);
        if (used) continue;
      }
      if (!opts?.includeReserved) {
        const resv = isReserved.get(p);
        if (resv) continue;
      }
      const free = await isPortFree(p);
      if (free) return p;
    }
    throw new Error(`No free port found in range ${start}-${end}${opts?.includeRegistered ? "" : " (excluding registered ports)"}${opts?.includeReserved ? "" : " (excluding reserved ports)"}.`);
  } finally {
    closeDB(ctx);
  }
}
function deleteByPort(dbPath, port) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const res = db.prepare("DELETE FROM bindings WHERE port = ?").run(port);
    return (res.changes ?? 0) > 0;
  } finally {
    closeDB(ctx);
  }
}
function deleteByRange(dbPath, start, end) {
  if (start > end) [start, end] = [end, start];
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const tx = db.transaction((a, b) => {
      const rows = db.prepare("SELECT port FROM bindings WHERE port BETWEEN ? AND ? ORDER BY port").all(a, b);
      const ports = rows.map((r) => r.port);
      const res = db.prepare("DELETE FROM bindings WHERE port BETWEEN ? AND ?").run(a, b);
      return { count: res.changes ?? 0, ports };
    });
    return tx(start, end);
  } finally {
    closeDB(ctx);
  }
}
function getBindingByPort(dbPath, port) {
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const row = db.prepare(
      "SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings WHERE port = ? LIMIT 1"
    ).get(port);
    return row;
  } finally {
    closeDB(ctx);
  }
}
function listBindingsByPortRange(dbPath, start, end) {
  if (start > end) [start, end] = [end, start];
  const ctx = openDB(dbPath);
  const { db } = ctx;
  try {
    const rows = db.prepare(
      "SELECT project, branch, purpose, name, claimed, port, created_at, updated_at FROM bindings WHERE port BETWEEN ? AND ? ORDER BY port"
    ).all(start, end);
    return rows;
  } finally {
    closeDB(ctx);
  }
}

// src/mcp.ts
init_db();
init_ranges();
async function startMCP(dbPath) {
  const mcp = await import("@modelcontextprotocol/sdk");
  const ServerCtor = mcp.Server;
  const StdioServerTransportCtor = mcp.StdioServerTransport;
  const server = new ServerCtor({
    name: "vibe-ports",
    version: "0.1.0"
  }, {
    capabilities: { tools: {} }
  });
  const tool = (name, description, inputSchema, handler) => {
    const addTool = server.tool ?? server.addTool;
    addTool.call(server, { name, description, inputSchema }, async (args) => {
      const out = await handler(args);
      return { content: [{ type: "json", json: out }] };
    });
  };
  tool("ports.claim", "Claim (safe; with savage reclaims if occupied and registered)", {
    type: "object",
    properties: {
      project: { type: "string" },
      branch: { type: "string" },
      purpose: { type: "string" },
      name: { type: "string", default: "default" },
      savage: { type: "boolean", default: false }
    },
    required: ["project", "branch", "purpose"]
  }, async (i) => {
    const port = await claimPort(dbPath, i.project, i.branch, normalizePurpose(i.purpose), (i.name || "default").trim() || "default", { savage: !!i.savage });
    return { project: i.project, branch: i.branch, purpose: normalizePurpose(i.purpose), name: i.name || "default", port };
  });
  tool("ports.allocate", "Allocate idempotently", {
    type: "object",
    properties: {
      project: { type: "string" },
      branch: { type: "string" },
      purpose: { type: "string" },
      name: { type: "string", default: "default" },
      failIfExists: { type: "boolean", default: false }
    },
    required: ["project", "branch", "purpose"]
  }, async (i) => {
    const port = allocatePort(dbPath, i.project, i.branch, normalizePurpose(i.purpose), { name: i.name || "default", failIfExists: !!i.failIfExists });
    return { project: i.project, branch: i.branch, purpose: normalizePurpose(i.purpose), name: i.name || "default", port };
  });
  tool("ports.get", "Get port by key", {
    type: "object",
    properties: { project: { type: "string" }, branch: { type: "string" }, purpose: { type: "string" }, name: { type: "string", default: "default" } },
    required: ["project", "branch", "purpose"]
  }, async (i) => ({ port: getPort(dbPath, i.project, i.branch, normalizePurpose(i.purpose)) }));
  tool("ports.deleteByKey", "Delete a binding by key", {
    type: "object",
    properties: { project: { type: "string" }, branch: { type: "string" }, purpose: { type: "string" }, name: { type: "string", default: "default" } },
    required: ["project", "branch", "purpose"]
  }, async (i) => ({ deleted: deleteBinding(dbPath, i.project, i.branch, normalizePurpose(i.purpose), i.name || "default") }));
  tool("ports.deleteByPort", "Delete a binding by port", {
    type: "object",
    properties: { port: { type: "number" } },
    required: ["port"]
  }, async (i) => ({ deleted: deleteByPort(dbPath, Number(i.port)) }));
  tool("ports.deleteByRange", "Delete all bindings in range", {
    type: "object",
    properties: { start: { type: "number" }, end: { type: "number" } },
    required: ["start", "end"]
  }, async (i) => deleteByRange(dbPath, Number(i.start), Number(i.end)));
  tool("ports.list", "List bindings with optional filters", {
    type: "object",
    properties: { project: { type: "string" }, branch: { type: "string" }, purpose: { type: "string" }, name: { type: "string" } }
  }, async (i) => ({ items: listBindingsFiltered(dbPath, { project: i.project, branch: i.branch, purpose: i.purpose ? normalizePurpose(i.purpose) : void 0, name: i.name }) }));
  tool("ports.find", "Find a free OS port (respecting DB & reserved by default)", {
    type: "object",
    properties: { start: { type: "number" }, end: { type: "number" }, includeRegistered: { type: "boolean", default: false }, includeReserved: { type: "boolean", default: false } },
    required: ["start", "end"]
  }, async (i) => ({ port: await findFreePort(dbPath, Number(i.start), Number(i.end), { includeRegistered: !!i.includeRegistered, includeReserved: !!i.includeReserved }) }));
  tool("ports.migrate.status", "Show DB/code schema versions", { type: "object", properties: {} }, async () => {
    const ctx = openDB(dbPath);
    try {
      return { code_version: CODE_SCHEMA_VERSION, db_version: getDbVersion(ctx.db) };
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.purpose.set", "Set or override a purpose range (START-END)", {
    type: "object",
    properties: { purpose: { type: "string" }, start: { type: "number" }, end: { type: "number" } },
    required: ["purpose", "start", "end"]
  }, async (i) => {
    const p = normalizePurpose(i.purpose);
    const s = Math.min(Number(i.start), Number(i.end));
    const e = Math.max(Number(i.start), Number(i.end));
    const ctx = openDB(dbPath);
    try {
      ctx.db.prepare("INSERT INTO purpose_ranges(purpose,start,end,is_custom) VALUES(?,?,?,1) ON CONFLICT(purpose) DO UPDATE SET start=excluded.start, end=excluded.end, is_custom=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(p, s, e);
      return { purpose: p, start: s, end: e };
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.purpose.get", "Get effective purpose range (custom or builtin for frontend/backend)", {
    type: "object",
    properties: { purpose: { type: "string" } },
    required: ["purpose"]
  }, async (i) => {
    const p = normalizePurpose(i.purpose);
    const ctx = openDB(dbPath);
    try {
      const row = ctx.db.prepare("SELECT start, end FROM purpose_ranges WHERE purpose = ?").get(p);
      if (row) return { purpose: p, start: row.start, end: row.end, source: "custom" };
      if (p === "frontend" || p === "backend") {
        const def = (await Promise.resolve().then(() => (init_ranges(), ranges_exports))).PURPOSE_RANGES[p];
        return { purpose: p, start: def.start, end: def.end, source: "builtin" };
      }
      throw new Error(`No range for purpose '${p}'`);
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.purpose.list", "List all custom purpose ranges", { type: "object", properties: {} }, async () => {
    const ctx = openDB(dbPath);
    try {
      return { items: ctx.db.prepare("SELECT purpose,start,end,updated_at FROM purpose_ranges ORDER BY purpose").all() };
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.purpose.delete", "Delete a custom purpose range", { type: "object", properties: { purpose: { type: "string" } }, required: ["purpose"] }, async (i) => {
    const p = normalizePurpose(i.purpose);
    const ctx = openDB(dbPath);
    try {
      const res = ctx.db.prepare("DELETE FROM purpose_ranges WHERE purpose = ?").run(p);
      return { deleted: res.changes ?? 0 };
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.reserved.add", "Reserve a port with optional reason", { type: "object", properties: { port: { type: "number" }, reason: { type: "string" } }, required: ["port"] }, async (i) => {
    const port = Number(i.port);
    const ctx = openDB(dbPath);
    try {
      ctx.db.prepare("INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES(?, ?)").run(port, i.reason ?? null);
      return { ok: true };
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.reserved.remove", "Unreserve a port", { type: "object", properties: { port: { type: "number" } }, required: ["port"] }, async (i) => {
    const port = Number(i.port);
    const ctx = openDB(dbPath);
    try {
      const res = ctx.db.prepare("DELETE FROM reserved_ports WHERE port = ?").run(port);
      return { deleted: res.changes ?? 0 };
    } finally {
      closeDB(ctx);
    }
  });
  tool("ports.reserved.list", "List reserved ports", { type: "object", properties: {} }, async () => {
    const ctx = openDB(dbPath);
    try {
      return { items: ctx.db.prepare("SELECT port, reason, created_at FROM reserved_ports ORDER BY port").all() };
    } finally {
      closeDB(ctx);
    }
  });
  const transport = new StdioServerTransportCtor();
  await server.connect(transport);
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
program.name("ports").description("Allocate, query and delete unique ports by (project, branch, purpose).").version("0.2.1", "-v, --version", "Show version").helpOption("-h, --help", "Show help").addHelpCommand("help [command]", "Show help for command").showHelpAfterError().option("-D, --db <path>", "Path to SQLite DB (default: ~/.vibeports/vibeports.sqlite3)").option("-j, --json", "Output JSON", false).hook("preAction", () => {
});
program.command("allocate").description("Allocate a port for given project, branch and purpose (idempotent).").requiredOption("-p, --project <project>", "Project name").requiredOption("-b, --branch <branch>", "Branch name").requiredOption("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").option("-n, --name <name>", "Component/service name (default: default)").option("-F, --fail-if-exists", "Fail if the tuple already exists instead of returning existing port", false).action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const project = sanitizeText(cmdOpts.project, "project");
  const branch = sanitizeText(cmdOpts.branch, "branch");
  const purpose = ensurePurpose(cmdOpts.purpose);
  const name = (cmdOpts.name ?? "default").trim() || "default";
  const port = allocatePort(opts.db, project, branch, purpose, { failIfExists: !!cmdOpts.failIfExists, name });
  printResult(mode, { project, branch, purpose, name, port, db: opts.db ?? resolveDefaultDBPath() });
});
program.command("get").description("Get the port for given project, branch and purpose.").requiredOption("-p, --project <project>", "Project name").requiredOption("-b, --branch <branch>", "Branch name").requiredOption("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").option("-n, --name <name>", "Component/service name (default: default)").action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const project = sanitizeText(cmdOpts.project, "project");
  const branch = sanitizeText(cmdOpts.branch, "branch");
  const purpose = ensurePurpose(cmdOpts.purpose);
  const name = (cmdOpts.name ?? "default").trim() || "default";
  const rows = listBindings(opts.db).filter((r) => r.project === project && r.branch === branch && r.purpose === purpose && r.name === name);
  if (rows.length === 0) fail("Not found");
  const port = rows[0].port;
  printResult(mode, { project, branch, purpose, name, port, db: opts.db ?? resolveDefaultDBPath() });
});
program.command("delete").description("Delete a binding by key (project/branch/purpose/name) or by --port.").option("-p, --project <project>", "Project name").option("-b, --branch <branch>", "Branch name").option("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").option("-n, --name <name>", "Component/service name (default: default)").option("-P, --port <port>", "Delete by port number").option("-R, --range <start-end>", "Delete all bindings whose port in range START-END").option("-A, --all", "Delete all matches for the provided filters (requires at least --project)", false).option("-K, --kill", "Kill listeners on the matched ports before deletion", false).option("-y, --yes", "Confirm deleting multiple entries (non-interactive)", false).option("-d, --dry-run", "Preview actions without killing or deleting", false).option("-f, --force", "Delete records even if port cannot be freed", false).action(async (cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  if (cmdOpts.port && cmdOpts.range) {
    fail("Provide either --port or --range, not both.");
  }
  const advancedFlags = !!(cmdOpts.all || cmdOpts.kill || cmdOpts.dryRun || cmdOpts.force || cmdOpts.yes);
  if (cmdOpts.range && !advancedFlags) {
    const m = cmdOpts.range.match(/^(\d+)-(\d+)$/);
    if (!m) fail("Invalid --range. Use START-END");
    let start = parseInt(m[1], 10);
    let end = parseInt(m[2], 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < 1 || start > 65535 || end > 65535) {
      fail("Ports in --range must be 1-65535");
    }
    const { count, ports } = deleteByRange(opts.db, start, end);
    if (mode === "json") {
      printResult(mode, { range: { start: Math.min(start, end), end: Math.max(start, end) }, deleted: count, ports, db: opts.db ?? resolveDefaultDBPath() });
    } else {
      process.stdout.write(`Deleted ${count} bindings in range ${Math.min(start, end)}-${Math.max(start, end)}
`);
    }
    return;
  }
  if (cmdOpts.port && !advancedFlags) {
    const port = parseInt(cmdOpts.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("Invalid --port");
    const ok = deleteByPort(opts.db, port);
    if (!ok) fail("Not found");
    printResult(mode, { port, deleted: true, db: opts.db ?? resolveDefaultDBPath() });
    return;
  }
  let matches = [];
  if (cmdOpts.range) {
    const m = cmdOpts.range.match(/^(\d+)-(\d+)$/);
    if (!m) fail("Invalid --range. Use START-END");
    let start = parseInt(m[1], 10);
    let end = parseInt(m[2], 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < 1 || start > 65535 || end > 65535) {
      fail("Ports in --range must be 1-65535");
    }
    const rows = listBindingsByPortRange(opts.db, start, end);
    matches = rows.map((r) => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
  } else if (cmdOpts.port) {
    const port = parseInt(cmdOpts.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("Invalid --port");
    const row = getBindingByPort(opts.db, port);
    if (!row) fail("Not found");
    matches = [{ project: row.project, branch: row.branch, purpose: row.purpose, name: row.name, port: row.port }];
  } else if (cmdOpts.all) {
    if (!cmdOpts.project) fail("When using --all, at least --project is required");
    const project = sanitizeText(cmdOpts.project, "project");
    const branch = cmdOpts.branch ? sanitizeText(cmdOpts.branch, "branch") : void 0;
    const purpose = cmdOpts.purpose ? ensurePurpose(cmdOpts.purpose) : void 0;
    const rows = listBindingsFiltered(opts.db, { project, branch, purpose, name: void 0 });
    matches = rows.map((r) => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
  } else {
    if (!cmdOpts.project || !cmdOpts.branch || !cmdOpts.purpose) {
      fail("Provide either --port/--range, or all of --project, --branch, --purpose [--name]");
    }
    const project = sanitizeText(cmdOpts.project, "project");
    const branch = sanitizeText(cmdOpts.branch, "branch");
    const purpose = ensurePurpose(cmdOpts.purpose);
    const name = (cmdOpts.name ?? "default").trim() || "default";
    const rows = listBindingsFiltered(opts.db, { project, branch, purpose, name });
    if (rows.length === 0) fail("Not found");
    matches = rows.map((r) => ({ project: r.project, branch: r.branch, purpose: r.purpose, name: r.name, port: r.port }));
  }
  if (matches.length === 0) {
    if (mode === "json") {
      printResult(mode, { matched: 0, deleted: 0, items: [], db: opts.db ?? resolveDefaultDBPath() });
      return;
    }
    fail("No matching bindings");
  }
  if (matches.length > 1 && !cmdOpts.yes && !cmdOpts.dryRun) {
    fail(`Matched ${matches.length} items. Re-run with --yes to proceed, or use --dry-run to preview.`);
  }
  const results = [];
  for (const m of matches) {
    if (cmdOpts.dryRun) {
      const pids = await findPidsByPort(m.port);
      results.push({ ...m, killed_pids: cmdOpts.kill ? pids : [], deleted: false, reason: "dry-run" });
      continue;
    }
    try {
      if (cmdOpts.kill) {
        try {
          const { killed } = await killPortOccupants(m.port);
          results.push({ ...m, killed_pids: killed, deleted: false });
        } catch (e) {
          if (!cmdOpts.force) {
            results.push({ ...m, deleted: false, reason: `kill failed: ${e?.message || String(e)}` });
            continue;
          } else {
            results.push({ ...m, killed_pids: [], deleted: false, reason: `kill failed but forcing delete: ${e?.message || String(e)}` });
          }
        }
      } else {
        if (!cmdOpts.force) {
          const free = await isPortFree(m.port);
          if (!free) {
            results.push({ ...m, deleted: false, reason: "port occupied; use --kill or --force to delete record anyway" });
            continue;
          }
        }
      }
      const ok = deleteByPort(opts.db, m.port);
      if (!ok) {
        results.push({ ...m, deleted: false, reason: "not found (already deleted?)" });
      } else {
        const last = results[results.length - 1];
        if (last && last.port === m.port) {
          last.deleted = true;
        } else {
          results.push({ ...m, deleted: true });
        }
      }
    } catch (e) {
      results.push({ ...m, deleted: false, reason: e?.message || String(e) });
    }
  }
  const deletedCount = results.filter((r) => r.deleted).length;
  if (mode === "json") {
    printResult(mode, { matched: matches.length, deleted: deletedCount, items: results, db: opts.db ?? resolveDefaultDBPath() });
  } else {
    for (const r of results) {
      const head = `${r.project}/${r.branch}/${r.purpose}/${r.name} port=${r.port}`;
      if (r.deleted) {
        process.stdout.write(`${head} -> deleted${r.killed_pids && r.killed_pids.length ? ` (killed: ${r.killed_pids.join(",")})` : ""}
`);
      } else {
        process.stdout.write(`${head} -> skipped${r.reason ? ` (${r.reason})` : ""}
`);
      }
    }
    process.stdout.write(`
Deleted ${deletedCount} of ${matches.length} matching bindings.
`);
  }
});
program.command("list").alias("ls").alias("view").description("List all bindings in a table (or JSON with --json).").option("-p, --project <project>", "Filter by project").option("-b, --branch <branch>", "Filter by branch").option("-u, --purpose <purpose>", "Filter by purpose").option("-n, --name <name>", "Filter by name").action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const rows = listBindingsFiltered(opts.db, {
    project: cmdOpts.project,
    branch: cmdOpts.branch,
    purpose: cmdOpts.purpose ? normalizePurpose(cmdOpts.purpose) : void 0,
    name: cmdOpts.name
  });
  if (mode === "json") {
    printResult("json", { db: opts.db ?? resolveDefaultDBPath(), count: rows.length, items: rows });
    return;
  }
  if (rows.length === 0) {
    process.stdout.write("No bindings found.\n");
    return;
  }
  const headers = ["PROJECT", "BRANCH", "PURPOSE", "NAME", "CLAIMED", "PORT", "CREATED_AT", "UPDATED_AT"];
  const widths = [
    Math.max(headers[0].length, ...rows.map((r) => r.project.length)),
    Math.max(headers[1].length, ...rows.map((r) => r.branch.length)),
    Math.max(headers[2].length, ...rows.map((r) => r.purpose.length)),
    Math.max(headers[3].length, ...rows.map((r) => r.name.length)),
    Math.max(headers[4].length, ...rows.map((r) => String(r.claimed ?? 0).length)),
    Math.max(headers[5].length, ...rows.map((r) => String(r.port).length)),
    Math.max(headers[6].length, ...rows.map((r) => r.created_at.length)),
    Math.max(headers[7].length, ...rows.map((r) => r.updated_at.length))
  ];
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
  const line = (cols) => cols.map((c, i) => pad(c, widths[i])).join("  ") + "\n";
  process.stdout.write(line(headers));
  process.stdout.write(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) {
    process.stdout.write(
      line([r.project, r.branch, r.purpose, r.name, String(r.claimed ?? 0), String(r.port), r.created_at, r.updated_at])
    );
  }
  process.stdout.write(`
Total: ${rows.length}  DB: ${opts.db ?? resolveDefaultDBPath()}
`);
});
program.command("claim").description("Safely claim a port for a given key, or, with --savage, reclaim it if currently occupied.").requiredOption("-p, --project <project>", "Project name").requiredOption("-b, --branch <branch>", "Branch name").requiredOption("-u, --purpose <purpose>", "Purpose: 'frontend' | 'backend'").option("-n, --name <name>", "Component/service name (default: default)").option("-S, --savage", "Reclaim the bound port by killing current listeners if occupied (only when record exists)", false).action(async (cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const project = sanitizeText(cmdOpts.project, "project");
  const branch = sanitizeText(cmdOpts.branch, "branch");
  const purpose = ensurePurpose(cmdOpts.purpose);
  const name = (cmdOpts.name ?? "default").trim() || "default";
  const port = await claimPort(opts.db, project, branch, purpose, name, { savage: !!cmdOpts.savage });
  printResult(mode, { project, branch, purpose, name, port, db: opts.db ?? resolveDefaultDBPath(), savage: !!cmdOpts.savage });
});
program.command("purpose").description("Manage custom purpose port ranges").command("set <purpose> <range>").description("Set or override a purpose range, e.g. job 9000-9099 or override frontend/backend").action((purpose, range) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const m = range.match(/^(\d+)-(\d+)$/);
  if (!m) fail("Invalid range. Use START-END");
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > 65535 || end > 65535) {
    fail("Ports in range must be 1-65535");
  }
  const p = normalizePurpose(purpose);
  const ctx = (init_db(), __toCommonJS(db_exports));
  const { db } = ctx.openDB(opts.db);
  try {
    db.prepare("INSERT INTO purpose_ranges(purpose,start,end,is_custom) VALUES(?,?,?,1) ON CONFLICT(purpose) DO UPDATE SET start=excluded.start, end=excluded.end, is_custom=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(p, Math.min(start, end), Math.max(start, end));
    if (mode === "json") {
      printResult("json", { purpose: p, start: Math.min(start, end), end: Math.max(start, end) });
    } else {
      process.stdout.write(`Set purpose '${p}' to ${Math.min(start, end)}-${Math.max(start, end)}
`);
    }
  } finally {
    ctx.closeDB({ db, dbPath: "" });
  }
});
program.command("purpose-get <purpose>").description("Get effective purpose range (custom or built-in)").action((purpose) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const p = normalizePurpose(purpose);
  const { db } = (init_db(), __toCommonJS(db_exports)).openDB(opts.db);
  try {
    const row = db.prepare("SELECT start, end FROM purpose_ranges WHERE purpose = ?").get(p);
    let range = row ? row : void 0;
    if (!range && (p === "frontend" || p === "backend")) {
      const def = (init_ranges(), __toCommonJS(ranges_exports)).PURPOSE_RANGES[p];
      range = def;
    }
    if (!range) fail(`No range for purpose '${p}'`);
    printResult(mode, { purpose: p, start: range.start, end: range.end });
  } finally {
    (init_db(), __toCommonJS(db_exports)).closeDB({ db, dbPath: "" });
  }
});
program.command("purpose-list").description("List all custom purpose ranges").action(() => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const { db } = (init_db(), __toCommonJS(db_exports)).openDB(opts.db);
  try {
    const rows = db.prepare("SELECT purpose, start, end, is_custom, updated_at FROM purpose_ranges ORDER BY purpose").all();
    if (mode === "json") {
      printResult("json", { count: rows.length, items: rows });
    } else {
      if (rows.length === 0) {
        process.stdout.write("No custom purposes.\n");
        return;
      }
      const headers = ["PURPOSE", "START", "END", "UPDATED_AT"];
      const w = [headers[0].length, headers[1].length, headers[2].length, headers[3].length];
      for (const r of rows) {
        w[0] = Math.max(w[0], String(r.purpose).length);
        w[1] = Math.max(w[1], String(r.start).length);
        w[2] = Math.max(w[2], String(r.end).length);
        w[3] = Math.max(w[3], String(r.updated_at).length);
      }
      const pad = (s, ww) => s + " ".repeat(Math.max(0, ww - s.length));
      const line = (cols) => cols.map((c, i) => pad(c, w[i])).join("  ") + "\n";
      process.stdout.write(line(headers));
      process.stdout.write(line(w.map((n) => "-".repeat(n))));
      for (const r of rows) process.stdout.write(line([r.purpose, String(r.start), String(r.end), r.updated_at]));
    }
  } finally {
    (init_db(), __toCommonJS(db_exports)).closeDB({ db, dbPath: "" });
  }
});
program.command("purpose-delete <purpose>").description("Delete a custom purpose range (builtin purposes will fall back to defaults)").action((purpose) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const p = normalizePurpose(purpose);
  const { db } = (init_db(), __toCommonJS(db_exports)).openDB(opts.db);
  try {
    const res = db.prepare("DELETE FROM purpose_ranges WHERE purpose = ?").run(p);
    if (mode === "json") printResult("json", { purpose: p, deleted: res.changes ?? 0 });
    else process.stdout.write(`Deleted ${res.changes ?? 0} rows for purpose '${p}'
`);
  } finally {
    (init_db(), __toCommonJS(db_exports)).closeDB({ db, dbPath: "" });
  }
});
program.command("reserved").description("Manage reserved ports (allocator/claimer will skip these)").command("add <port> [reason...]").description("Reserve a port with optional reason").action((portStr, reasonParts) => {
  const port = parseInt(portStr, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("Invalid port");
  const reason = (reasonParts || []).join(" ") || null;
  const opts = program.opts();
  const { db } = (init_db(), __toCommonJS(db_exports)).openDB(opts.db);
  try {
    db.prepare("INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES(?, ?)").run(port, reason);
    process.stdout.write(`Reserved port ${port}${reason ? ` (${reason})` : ""}
`);
  } finally {
    (init_db(), __toCommonJS(db_exports)).closeDB({ db, dbPath: "" });
  }
});
program.command("reserved-remove <port>").description("Unreserve a port").action((portStr) => {
  const port = parseInt(portStr, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("Invalid port");
  const opts = program.opts();
  const { db } = (init_db(), __toCommonJS(db_exports)).openDB(opts.db);
  try {
    const res = db.prepare("DELETE FROM reserved_ports WHERE port = ?").run(port);
    process.stdout.write(`Removed ${res.changes ?? 0} reservations for port ${port}
`);
  } finally {
    (init_db(), __toCommonJS(db_exports)).closeDB({ db, dbPath: "" });
  }
});
program.command("reserved-list").description("List reserved ports").action(() => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const { db } = (init_db(), __toCommonJS(db_exports)).openDB(opts.db);
  try {
    const rows = db.prepare("SELECT port, reason, created_at FROM reserved_ports ORDER BY port").all();
    if (mode === "json") printResult("json", { count: rows.length, items: rows });
    else {
      if (rows.length === 0) {
        process.stdout.write("No reserved ports.\n");
        return;
      }
      const headers = ["PORT", "REASON", "CREATED_AT"];
      const w = [headers[0].length, headers[1].length, headers[2].length];
      for (const r of rows) {
        w[0] = Math.max(w[0], String(r.port).length);
        w[1] = Math.max(w[1], String(r.reason || "").length);
        w[2] = Math.max(w[2], String(r.created_at).length);
      }
      const pad = (s, ww) => s + " ".repeat(Math.max(0, ww - s.length));
      const line = (cols) => cols.map((c, i) => pad(c, w[i])).join("  ") + "\n";
      process.stdout.write(line(headers));
      process.stdout.write(line(w.map((n) => "-".repeat(n))));
      for (const r of rows) process.stdout.write(line([String(r.port), String(r.reason || ""), String(r.created_at)]));
    }
  } finally {
    (init_db(), __toCommonJS(db_exports)).closeDB({ db, dbPath: "" });
  }
});
program.command("migrate").description("Show DB schema version and optionally apply automatic migrations").option("-s, --status", "Show current DB and code schema versions", false).option("-a, --apply", "Apply migrations to upgrade DB to current schema", false).action((cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const ctx = openDB(opts.db);
  try {
    const dbVer = getDbVersion(ctx.db);
    if (cmdOpts.apply) {
      closeDB(ctx);
      const ctx2 = openDB(opts.db);
      const newVer = getDbVersion(ctx2.db);
      closeDB(ctx2);
      if (mode === "json") {
        printResult("json", { db: opts.db ?? resolveDefaultDBPath(), code_version: CODE_SCHEMA_VERSION, db_version: newVer, migrated: true });
      } else {
        process.stdout.write(`Migrated. DB schema=${newVer}, code schema=${CODE_SCHEMA_VERSION}
`);
      }
      return;
    }
    if (mode === "json") {
      printResult("json", { db: opts.db ?? resolveDefaultDBPath(), code_version: CODE_SCHEMA_VERSION, db_version: dbVer });
    } else {
      process.stdout.write(`DB schema=${dbVer ?? "unknown"}, code schema=${CODE_SCHEMA_VERSION}
`);
    }
  } finally {
    try {
      closeDB(ctx);
    } catch {
    }
  }
});
program.command("find").alias("free").description("Find a free OS port (and by default, not already registered) from a given port or range START-END").argument("<spec>", "Port or range, e.g. 3000 or 3000-3999").option("-I, --include-registered", "Ignore DB registrations; only check OS occupancy", false).option("-R, --include-reserved", "Ignore reserved ports; only check registration/OS", false).action(async (spec, cmdOpts) => {
  const opts = program.opts();
  const mode = toOutputMode(opts);
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) fail("Invalid spec. Use PORT or START-END");
  let start = parseInt(m[1], 10);
  let end = m[2] ? parseInt(m[2], 10) : start;
  if (Number.isNaN(start) || Number.isNaN(end)) fail("Invalid numbers in spec");
  if (start < 1 || start > 65535 || end < 1 || end > 65535) fail("Port must be 1-65535");
  const port = await findFreePort(opts.db, start, end, { includeRegistered: !!cmdOpts.includeRegistered, includeReserved: !!cmdOpts.includeReserved });
  printResult(mode, { port, start: Math.min(start, end), end: Math.max(start, end), db: opts.db ?? resolveDefaultDBPath(), includeRegistered: !!cmdOpts.includeRegistered, includeReserved: !!cmdOpts.includeReserved });
});
program.parseAsync().catch((err) => {
  process.stderr.write((err?.message || String(err)) + "\n");
  process.exit(1);
});
program.command("mcp").description("Start MCP server over stdio exposing vibe-ports tools").action(async () => {
  const opts = program.opts();
  await startMCP(opts.db);
});
