vibe-ports

A minimal CLI to allocate, query and delete unique ports by the tuple (project, branch, purpose, name). Designed to be used via `npx` (TypeScript, Node 18+), storing data in a user-local SQLite DB at `~/.vibeports/vibeports.sqlite3` by default.

- Uniqueness:
  - (project, branch, purpose, name) is unique (name defaults to `default`)
  - port is globally unique
- Purpose ranges (accounting only; no OS port probing):
  - frontend: 3000–3999
  - backend: 8000–8999

Install / Build

- Local dev
  - `npm i`
  - `npm run build`
  - Run: `node dist/index.js --help`

- As a package (npx)
  - After publishing, users can run: `npx vibe-ports ...`

CLI

- Allocate (idempotent)
  - `ports allocate --project myproj --branch feat-x --purpose frontend [--name default]`
  - Prints the allocated port; if the tuple already exists, returns the existing port.
  - Use `--fail-if-exists` to error on existing tuple instead of returning the existing port.

- Claim (safe by default; with --savage will reclaim if already registered and currently occupied)
  - `ports claim --project myproj --branch feat-x --purpose backend --name api`
    - If not registered: safely allocates a free, non-occupied port and registers it (never kills anything)
    - If registered: just returns the recorded port
  - `ports claim --project myproj --branch feat-x --purpose backend --name api --savage`
    - If registered and the port is occupied by another process, will attempt to kill the listeners (TERM → short wait → KILL) and then return the port
    - If not registered: behaves like safe claim (does not kill anything)

- Get
  - `ports get --project myproj --branch feat-x --purpose frontend [--name default]`

- Delete
  - By key: `ports delete --project myproj --branch feat-x --purpose frontend [--name default]`
  - By port: `ports delete --port 8000`
  - By range: `ports delete --range 8000-8099` (deletes all records whose port falls in the range)
  - Batch by partial key + `--all`:
    - Project-wide: `ports delete --project myproj --all`
    - Project+branch: `ports delete --project myproj --branch feat-x --all`
    - Project+branch+purpose: `ports delete --project myproj --branch feat-x --purpose backend --all`
  - Force-clear ports before deletion: add `--kill` (TERM → short wait → KILL). Works with key/port/range/--all.
  - Batch safety/preview flags:
    - `--dry-run`: preview matched items and PIDs, do nothing
    - `--yes`: proceed when multiple items matched (non-interactive)
    - `--force`: delete records even if port cannot be freed

Common options:
- `--db <path>`: override DB path (default `~/.vibeports/vibeports.sqlite3`; env `VIBEPORTS_DB` or legacy `KVPORT_DB`)
- `--json`: JSON output

Help

- `ports --help` or `ports -h`
- `ports help <command>` (e.g., `ports help allocate`)

Database baseline

Schema is defined in `db/baseline.sql` (single baseline file, no versioned SQL).
Schema version is tracked in table `meta` as `schema_version`.

Startup behavior:
- If DB is missing or older than current code schema, automatic migration runs.
- If DB schema is newer than this CLI supports, commands will fail with an error asking you to upgrade vibe-ports.

Migrate commands:
- Show status: `ports migrate --status` (prints DB schema and code schema)
- Apply migration: `ports migrate --apply` (idempotent; upgrades DB to current schema)

Notes

- Concurrency: uses SQLite WAL and unique indexes to guarantee correctness; allocation is transactional.
- Only accounts ports; it does not check if a port is free on the OS (except `claim` safe bind test and `find`).

Default reserved ports

- 22(ssh), 80(http), 443(https), 3306(mysql), 5432(postgres), 6379(redis), 27017(mongodb), 9200(elasticsearch), 5601(kibana), 11211(memcached), 9092(kafka), 5672(rabbitmq), 15672(rabbitmq-mgmt)
- Node 18+ is required.

Permissions and OS dependencies

- Kill permissions
  - `ports delete --kill` 默认不区分用户，直接尝试终止占用匹配端口的进程（TERM → 短等待 → KILL）。
  - 若端口由其他用户或系统服务（root/systemd/docker 等）占用，可能需要管理员权限：
    - Linux/macOS：`sudo ports delete ... --kill --yes`
    - Windows：使用管理员命令行（`taskkill /F` 可能需要管理员权限）
  - 权限不足会明确报错；如需仅删除登记而不释放端口，可加 `--force`（不推荐）。

- PID 探测依赖（任一即可，自动回退）
  - Linux/macOS：优先 `lsof`，其次 `fuser`，最后 `ss -p`；若均不可用或权限受限，`killed_pids` 可能为空，但若端口确实释放仍会继续。
  - Windows：使用 `netstat -ano` 和 `taskkill`。

- 守护进程注意
  - 被守护的服务可能在 KILL 后立刻被拉起，导致端口再次被占用；此时会报错，或需使用 `--force` 仅删登记。

Recommended usage (claim vs claim --savage)

- Use `claim` (no flags) to safely acquire a port the first time. It will pick a port that is not registered, not OS-occupied (bind test), and not reserved.
- Use `claim --savage` for the main/owning service when you need to ensure the registered port is available. It will only reclaim if the key is already registered and the port is currently occupied; first-time claim never kills.
- Team convention: owner uses `claim --savage`; other collaborators (proxy, tools) use `claim` without flags. 防呆不防傻。
  - When using `--savage`, the binding is marked as `claimed=1` in DB. The list view shows this in the CLAIMED column.

Scenario and recommendations

- Goal: automate port consistency for multi-branch backend environments (and their proxies) without hardcoding.
- Recommended combo: “claim (first) + claim --savage (owner on subsequent runs)”.
  - First time on a branch (owner service, e.g. backend api): use `claim` to safely register a free port.
  - Subsequent runs of the owner: use `claim --savage` to reclaim the registered port if it’s occupied (e.g., previous dev server not closed).
  - Non-owner collaborators (frontend proxy, admin UI, tools): use `claim` (no flags) to read and reuse the same port, never `--savage`.
- Purpose and name
  - Use `purpose` to differentiate backend/frontend/admin/etc.; use `name` to distinguish multiple services of the same purpose (e.g., backend: api/worker).
  - For custom purposes, define a range first: `ports purpose set <purpose> <START-END>`.
- Dynamic keys
  - Derive `project` and `branch` from git: `basename "$(git rev-parse --show-toplevel || pwd)"` and `git symbolic-ref --short -q HEAD || git rev-parse --short HEAD`.
  - Keep (project, branch, purpose, name) stable across services to share the same port.
- Cleanup and hygiene
  - Remove a single mapping when a worktree goes away: `ports delete --project P --branch B --purpose U --name N` (or `--port`).
  - Bulk cleanup a range (e.g., a test pool): `ports delete --range 8000-8099`.
  - Aggressive cleanup (free ports then delete): e.g. `ports delete -p P -b B -u backend --all --kill --yes`.
- Avoid hardcoding ports
  - Frontend proxy targets backend via `claim` at startup.
  - Backend servers bind to the `claim`/`claim --savage` port instead of fixed numbers.

Quick CLI reference

- Derive keys from git (recommended):
  ```bash
  PROJECT=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
  BRANCH=$(git symbolic-ref --short -q HEAD || git rev-parse --short HEAD || echo 'nogit')
  ```
- Owner (backend) — reclaim if occupied:
  ```bash
  PORT=$(npx -y vibe-ports@latest claim -p "$PROJECT" -b "$BRANCH" -u backend -n api --savage)
  ```
- Collaborator (proxy) — read only:
  ```bash
  PORT=$(npx -y vibe-ports@latest claim -p "$PROJECT" -b "$BRANCH" -u backend -n api)
  ```
- Cleanup mapping when a worktree is removed:
  ```bash
  npx -y vibe-ports@latest delete -p "$PROJECT" -b "$BRANCH" -u backend -n api
  ```

Find a free port

- `ports find 3000-3999` → returns a free OS port not registered in DB and not reserved
- Flags:
  - `--include-registered` → ignore DB registrations; only check OS occupancy
  - `--include-reserved` → ignore reserved list; include reserved ports in search

Purpose ranges (customize/override)

- Set or override a purpose range:
  - `ports purpose set <purpose> <START-END>`
  - e.g. `ports purpose set job 9000-9099`
- Get effective range (custom if present, otherwise builtin for frontend/backend):
  - `ports purpose-get <purpose>`
- List all custom purposes:
  - `ports purpose-list`
- Delete a custom purpose range (frontend/backend then fall back to builtin):
  - `ports purpose-delete <purpose>`

Notes:
- allocate/claim require a known purpose range. For custom purposes, call `ports purpose set ...` first.
- Builtins: `frontend` → 3000–3999, `backend` → 8000–8999 (can be overridden via `purpose set`).

List all bindings

- `ports list` (or `ports view`): prints a table with all entries. Columns: PROJECT, BRANCH, PURPOSE, NAME, CLAIMED, PORT.
- `ports list --json`: prints JSON array with all entries.
- Filters:
  - `--project <P>` `--branch <B>` `--purpose <U>` `--name <N>`
  - e.g. `ports list --project saas --branch feat/cart --json`

Multiple backends in the same branch

- Use `--purpose backend` with different `--name` values, e.g. `--name api`, `--name worker`.
- Both entries will allocate within 8000–8999 and remain unique by name.

Examples

- Claim two backends in the same branch (admin/public):
  - `ports claim --project saas --branch feat/cart --purpose backend --name admin`
  - `ports claim --project saas --branch feat/cart --purpose backend --name public`

- Query specific backend ports:
  - `ports get --project saas --branch feat/cart --purpose backend --name admin`
  - `ports get --project saas --branch feat/cart --purpose backend --name public`

- Claim semantics (safe vs savage):
  - Safe claim (never kills):
    - `ports claim --project saas --branch feat/cart --purpose backend --name api`
  - Savage claim (only reclaims when already registered):
    - `ports claim --project saas --branch feat/cart --purpose backend --name api --savage`
      - If the port is occupied, will attempt to stop the occupying process(es) and return the port.

- List all:
  - `ports list`

Command substitution (npx)

- Claim (safe; returns existing or safely registers new):
  - `PORT=$(npx -y vibe-ports@latest claim -p saas -b feat/cart -u backend -n admin)`
  - `echo "$PORT"`  # prints e.g. 8000

- Claim with savage (only reclaims when already registered and currently occupied):
  - `PORT=$(npx -y vibe-ports@latest claim -p saas -b feat/cart -u backend -n admin --savage)`

- Get existing port (read-only):
  - `PORT=$(npx -y vibe-ports@latest get -p saas -b feat/cart -u backend -n public)`

- JSON mode (pipe to jq):
  - `PORT=$(npx -y vibe-ports@latest claim -p saas -b feat/cart -u backend -n public --json | jq -r .port)`

Delete by port with substitution:
- `PORT=$(npx -y vibe-ports@latest get -p saas -b feat/cart -u backend -n admin); npx -y vibe-ports@latest delete --port "$PORT" --json`
 - With kill: `npx -y vibe-ports@latest delete --port "$PORT" --kill --json`

Delete by range:
- `npx -y vibe-ports@latest delete --range 8000-8099 --json`
 - With kill (requires --yes when multiple): `npx -y vibe-ports@latest delete --range 8000-8099 --kill --yes`

Delete by partial key (all names for that scope):
- Project: `npx -y vibe-ports@latest delete -p saas --all --kill --yes`
- Project + branch: `npx -y vibe-ports@latest delete -p saas -b feat/cart --all --kill --yes`
- Project + branch + purpose: `npx -y vibe-ports@latest delete -p saas -b feat/cart -u backend --all --kill --yes`

Note: You can also `npm i -D vibe-ports@latest` in your project and call `npx vibe-ports ...` without the on-the-fly install delay, or `npm i -g vibe-ports@latest` to use the global `ports` command.

Shell examples (dynamic project/branch)

- Auto-claim backend port (safe; no hardcoding):
  ```bash
  PORT=$(
    npx -y vibe-ports@latest claim \
      -p "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" \
      -b "$(git symbolic-ref --short -q HEAD || git rev-parse --short HEAD || echo 'nogit')" \
      -u backend \
      -n admin
  )
  echo "Backend listening on: $PORT"
  # e.g. run your server on $PORT
  ```

- Main service (reclaim if already registered and occupied):
  ```bash
  PORT=$(
    npx -y vibe-ports@latest claim \
      -p "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" \
      -b "$(git symbolic-ref --short -q HEAD || git rev-parse --short HEAD || echo 'nogit')" \
      -u backend \
      -n admin \
      --savage
  )
  echo "Backend (owner) reclaimed/listening on: $PORT"
  ```

- Cleanup on worktree removal (release registration):
  ```bash
  PORT=$(
    npx -y vibe-ports@latest get \
      -p "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" \
      -b "$(git symbolic-ref --short -q HEAD || git rev-parse --short HEAD || echo 'nogit')" \
      -u backend \
      -n admin
  )
  echo "Releasing port: $PORT"

  npx -y vibe-ports@latest delete \
    -p "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" \
    -b "$(git symbolic-ref --short -q HEAD || git rev-parse --short HEAD || echo 'nogit')" \
    -u backend \
    -n admin
  ```

Permission tips

- 清理开发者自己启动的 dev server 通常不需要 sudo。
- 若端口被系统/他人用户占用，可以直接加 sudo：
  - `sudo ports delete -p "$PROJECT" -b "$BRANCH" -u backend --all --kill --yes`
  - 或先预览：`ports delete -p "$PROJECT" --all --dry-run`

Vite: programmatically get backend port and set proxy

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function getBackendPort() {
  const project = execSync('basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"', { shell: '/bin/bash' }).toString().trim()
  const branch  = execSync('git symbolic-ref --short -q HEAD || git rev-parse --short HEAD || echo nogit', { shell: '/bin/bash' }).toString().trim()
  const cmd = `npx -y vibe-ports@latest claim -p ${project} -b ${branch} -u backend -n admin`
  return Number(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim())
}

const backendPort = getBackendPort()

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
    },
  },
})
```

MCP mode

- Start an MCP server over stdio exposing vibe-ports tools (claim/allocate/get/delete/list/find/migrate):
  - `npx -y vibe-ports@latest mcp`
- Tools include (names as seen by MCP clients):
  - `ports.claim` (project, branch, purpose, name, savage?)
  - `ports.allocate` (project, branch, purpose, name?, failIfExists?)
  - `ports.get`, `ports.deleteByKey`, `ports.deleteByPort`, `ports.deleteByRange`
  - `ports.list` (optional filters: project/branch/purpose/name), `ports.find`
  - `ports.migrate.status`
  - Purpose tools: `ports.purpose.set/get/list/delete`
  - Reserved tools: `ports.reserved.add/remove/list`

What is MCP and how this server works

- Model Context Protocol (MCP) lets agents/clients call tool servers over a simple transport (here: stdio).
- This CLI starts an MCP server that exposes port-bookkeeping as typed tools (JSON schema), making it easy for AI agents to safely coordinate ports.
- Transport: stdio (the server reads/writes JSON-RPC messages on stdin/stdout).

Configure an MCP client (example: Claude Desktop)

- Add a server entry to your MCP config (example JSON):
  ```json
  {
    "mcpServers": {
      "vibe-ports": {
        "command": "npx",
        "args": ["-y", "vibe-ports@latest", "mcp"],
        "env": {
          "VIBEPORTS_DB": "~/.vibeports/vibeports.sqlite3"
        }
      }
    }
  }
  ```
- After reload, the client should list tools like `ports.claim`, `ports.list`, etc.

Tool schemas (selected)

- `ports.claim`
  - input: `{ project: string, branch: string, purpose: string, name?: string = 'default', savage?: boolean = false }`
  - behavior: safe claim; with `savage=true` and already registered, will reclaim occupied port; first-time claim never kills; marks `claimed=1` when savage is used.
- `ports.allocate`
  - input: `{ project: string, branch: string, purpose: string, name?: string = 'default', failIfExists?: boolean = false }`
  - behavior: idempotent DB allocation (no OS check, no kill), skipping reserved ports.
- `ports.find`
  - input: `{ start: number, end: number, includeRegistered?: boolean, includeReserved?: boolean }`
  - behavior: returns a currently OS-free port in range; by default excludes DB-registered and reserved ports.
- `ports.list`
  - input: `{ project?: string, branch?: string, purpose?: string, name?: string }`
  - behavior: returns bindings with fields: project, branch, purpose, name, claimed, port, created_at, updated_at.

DB selection for MCP

- Default DB path: `~/.vibeports/vibeports.sqlite3`.
- Override by env var in the MCP server config: `VIBEPORTS_DB=/path/to/db.sqlite3`.

Safety notes for MCP consumers

- `ports.claim` with `savage=true` may terminate processes that occupy the registered port. Use only in the designated owner flow; non-owners should call `ports.claim` without flags.
- Purpose ranges must be defined (builtin: frontend/backend; custom via `ports.purpose.set`).
- Reserved ports are skipped by allocate/claim and by default in `ports.find`.
