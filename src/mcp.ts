import { allocatePort, claimPort, getPort, deleteBinding, listBindingsFiltered, findFreePort, deleteByPort, deleteByRange } from './core';
import { openDB, closeDB, CODE_SCHEMA_VERSION, getDbVersion } from './db';
import { normalizePurpose } from './ranges';

export async function startMCP(dbPath?: string) {
  const mcp = await import('@modelcontextprotocol/sdk');
  const ServerCtor = (mcp as any).Server;
  const StdioServerTransportCtor = (mcp as any).StdioServerTransport;
  const server = new ServerCtor({
    name: 'vibe-ports',
    version: '0.1.0'
  }, {
    capabilities: { tools: {} }
  });

  const tool = (name: string, description: string, inputSchema: any, handler: (input: any) => Promise<any>) => {
    const addTool = (server as any).tool ?? (server as any).addTool;
    addTool.call(server, { name, description, inputSchema }, async (args: any) => {
      const out = await handler(args);
      return { content: [{ type: 'json', json: out }] } as any;
    });
  };

  tool('ports.claim', 'Claim (safe; with savage reclaims if occupied and registered)', {
    type: 'object',
    properties: {
      project: { type: 'string' },
      branch: { type: 'string' },
      purpose: { type: 'string' },
      name: { type: 'string', default: 'default' },
      savage: { type: 'boolean', default: false }
    },
    required: ['project', 'branch', 'purpose']
  }, async (i) => {
    const port = await claimPort(dbPath, i.project, i.branch, normalizePurpose(i.purpose), (i.name || 'default').trim() || 'default', { savage: !!i.savage });
    return { project: i.project, branch: i.branch, purpose: normalizePurpose(i.purpose), name: i.name || 'default', port };
  });

  tool('ports.allocate', 'Allocate idempotently', {
    type: 'object', properties: {
      project: { type: 'string' }, branch: { type: 'string' }, purpose: { type: 'string' }, name: { type: 'string', default: 'default' }, failIfExists: { type: 'boolean', default: false }
    }, required: ['project','branch','purpose']
  }, async (i) => {
    const port = allocatePort(dbPath, i.project, i.branch, normalizePurpose(i.purpose), { name: i.name || 'default', failIfExists: !!i.failIfExists });
    return { project: i.project, branch: i.branch, purpose: normalizePurpose(i.purpose), name: i.name || 'default', port };
  });

  tool('ports.get', 'Get port by key', {
    type: 'object', properties: { project: { type: 'string' }, branch: { type: 'string' }, purpose: { type: 'string' }, name: { type: 'string', default: 'default' } }, required: ['project','branch','purpose']
  }, async (i) => ({ port: getPort(dbPath, i.project, i.branch, normalizePurpose(i.purpose)) }));

  tool('ports.deleteByKey', 'Delete a binding by key', {
    type: 'object', properties: { project: { type: 'string' }, branch: { type: 'string' }, purpose: { type: 'string' }, name: { type: 'string', default: 'default' } }, required: ['project','branch','purpose']
  }, async (i) => ({ deleted: deleteBinding(dbPath, i.project, i.branch, normalizePurpose(i.purpose), i.name || 'default') }));

  tool('ports.deleteByPort', 'Delete a binding by port', {
    type: 'object', properties: { port: { type: 'number' } }, required: ['port']
  }, async (i) => ({ deleted: deleteByPort(dbPath, Number(i.port)) }));

  tool('ports.deleteByRange', 'Delete all bindings in range', {
    type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' } }, required: ['start','end']
  }, async (i) => deleteByRange(dbPath, Number(i.start), Number(i.end)));

  tool('ports.list', 'List bindings with optional filters', {
    type: 'object', properties: { project: { type: 'string' }, branch: { type: 'string' }, purpose: { type: 'string' }, name: { type: 'string' } }
  }, async (i) => ({ items: listBindingsFiltered(dbPath, { project: i.project, branch: i.branch, purpose: i.purpose ? normalizePurpose(i.purpose) : undefined, name: i.name }) }));

  tool('ports.find', 'Find a free OS port (respecting DB & reserved by default)', {
    type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' }, includeRegistered: { type: 'boolean', default: false }, includeReserved: { type: 'boolean', default: false } }, required: ['start','end']
  }, async (i) => ({ port: await findFreePort(dbPath, Number(i.start), Number(i.end), { includeRegistered: !!i.includeRegistered, includeReserved: !!i.includeReserved }) }));

  tool('ports.migrate.status', 'Show DB/code schema versions', { type: 'object', properties: {} }, async () => {
    const ctx = openDB(dbPath); try { return { code_version: CODE_SCHEMA_VERSION, db_version: getDbVersion(ctx.db) }; } finally { closeDB(ctx); }
  });

  // Purpose management
  tool('ports.purpose.set', 'Set or override a purpose range (START-END)', {
    type: 'object', properties: { purpose: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } }, required: ['purpose','start','end']
  }, async (i) => {
    const p = normalizePurpose(i.purpose);
    const s = Math.min(Number(i.start), Number(i.end));
    const e = Math.max(Number(i.start), Number(i.end));
    const ctx = openDB(dbPath); try {
      ctx.db.prepare("INSERT INTO purpose_ranges(purpose,start,end,is_custom) VALUES(?,?,?,1) ON CONFLICT(purpose) DO UPDATE SET start=excluded.start, end=excluded.end, is_custom=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(p, s, e);
      return { purpose: p, start: s, end: e };
    } finally { closeDB(ctx); }
  });

  tool('ports.purpose.get', 'Get effective purpose range (custom or builtin for frontend/backend)', {
    type: 'object', properties: { purpose: { type: 'string' } }, required: ['purpose']
  }, async (i) => {
    const p = normalizePurpose(i.purpose);
    const ctx = openDB(dbPath); try {
      const row = ctx.db.prepare('SELECT start, end FROM purpose_ranges WHERE purpose = ?').get(p) as { start: number; end: number } | undefined;
      if (row) return { purpose: p, start: row.start, end: row.end, source: 'custom' };
      if (p === 'frontend' || p === 'backend') {
        const def = (await import('./ranges')).PURPOSE_RANGES[p as 'frontend' | 'backend'];
        return { purpose: p, start: def.start, end: def.end, source: 'builtin' };
      }
      throw new Error(`No range for purpose '${p}'`);
    } finally { closeDB(ctx); }
  });

  tool('ports.purpose.list', 'List all custom purpose ranges', { type: 'object', properties: {} }, async () => {
    const ctx = openDB(dbPath); try { return { items: ctx.db.prepare('SELECT purpose,start,end,updated_at FROM purpose_ranges ORDER BY purpose').all() }; } finally { closeDB(ctx); }
  });

  tool('ports.purpose.delete', 'Delete a custom purpose range', { type: 'object', properties: { purpose: { type: 'string' } }, required: ['purpose'] }, async (i) => {
    const p = normalizePurpose(i.purpose); const ctx = openDB(dbPath); try { const res = ctx.db.prepare('DELETE FROM purpose_ranges WHERE purpose = ?').run(p); return { deleted: res.changes ?? 0 }; } finally { closeDB(ctx); }
  });

  // Reserved management
  tool('ports.reserved.add', 'Reserve a port with optional reason', { type: 'object', properties: { port: { type: 'number' }, reason: { type: 'string' } }, required: ['port'] }, async (i) => {
    const port = Number(i.port); const ctx = openDB(dbPath); try { ctx.db.prepare('INSERT OR IGNORE INTO reserved_ports(port, reason) VALUES(?, ?)').run(port, i.reason ?? null); return { ok: true }; } finally { closeDB(ctx); }
  });
  tool('ports.reserved.remove', 'Unreserve a port', { type: 'object', properties: { port: { type: 'number' } }, required: ['port'] }, async (i) => {
    const port = Number(i.port); const ctx = openDB(dbPath); try { const res = ctx.db.prepare('DELETE FROM reserved_ports WHERE port = ?').run(port); return { deleted: res.changes ?? 0 }; } finally { closeDB(ctx); }
  });
  tool('ports.reserved.list', 'List reserved ports', { type: 'object', properties: {} }, async () => {
    const ctx = openDB(dbPath); try { return { items: ctx.db.prepare('SELECT port, reason, created_at FROM reserved_ports ORDER BY port').all() }; } finally { closeDB(ctx); }
  });

  const transport = new StdioServerTransportCtor();
  await server.connect(transport);
}
