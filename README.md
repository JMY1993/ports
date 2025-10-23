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

- Claim (safe by default; with --savage will reclaim if already registered and currently occupied)
  - `ports claim --project myproj --branch feat-x --purpose backend --name api`
    - If not registered: safely allocates a free, non-occupied port and registers it (never kills anything)
    - If registered: just returns the recorded port
  - `ports claim --project myproj --branch feat-x --purpose backend --name api --savage`
    - If registered and the port is occupied by another process, will attempt to kill the listeners (TERM → short wait → KILL) and then return the port
    - If not registered: behaves like safe claim (does not kill anything)

- Get
  - `ports get --project myproj --branch feat-x --purpose frontend [--name default]`

- **⭐ Auto (recommended; derive project/branch from Git)**
  - **Use `ports auto claim` instead of `ports claim` for most development workflows.**
  - Print derived keys: `ports auto keys` → `{ project, branch, slug, slug_pg }`

- Allocate (⚠️ **Deprecated; use `claim` or `auto claim` instead**)
  - `ports allocate --project myproj --branch feat-x --purpose frontend [--name default]`
  - Prints the allocated port; if the tuple already exists, returns the existing port.
  - Use `--fail-if-exists` to error on existing tuple instead of returning the existing port.
  - **Note**: `allocate` does not check OS port availability; use `claim` for safer allocation.

#### Auto commands continued

  - Claim using Git-derived project/branch: `ports auto claim -u backend [-n name] [--savage]`
  - Get using Git-derived project/branch: `ports auto get -u backend [-n name]`
  - Delete using Git-derived project/branch:
    - Single key: `ports auto delete -u backend [-n name] [--kill]`
    - Batch: `ports auto delete --all [-u backend] [--kill] [--yes] [--dry-run] [--force]`
  - List for current repo/branch: `ports auto list [-u backend] [-n name] [--json]`

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

Git 绑定（Auto）细则

- project 取值优先级：`git remote get-url origin` 仓库名 → `git rev-parse --show-toplevel` 的目录名 → 当前工作目录名。
- branch 取值优先级：`git symbolic-ref --short -q HEAD` → `git rev-parse --short HEAD`（Detached HEAD 用短 SHA）→ `nogit`。
- slug：`project-branch` 小写清洗（非字母数字转 `_`，折叠 `_`，去首尾 `_`）。
- slug_pg：`slug` 截断至 56 + `_` + sha1 前 6（方便符合 63 长度限制）。

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

Template strings (flexible resource bindings)

For storing dynamic connection strings, file paths, or configuration values tied to your project/branch, use template strings. This is useful for database URIs, Redis configurations, file paths, etc.

**Concepts:**
- **Template**: A string with placeholders like `redis://{project}-{branch}-cache:6379`
- **Variables**: Key-value pairs that fill placeholders (e.g., `{project: "myapp", branch: "main"}`)
- **Value**: The rendered result after substituting variables into the template
- **Idempotent claim**: Create-or-return semantics; calling with the same (template, vars) twice returns the same value

**Basic commands:**

- Claim a template instance (idempotent: create-or-return):
  ```bash
  ports tmpl claim --template "redis://{project}-{branch}-cache:6379" --project myapp --branch main
  # Output: redis://myapp-main-cache:6379
  ```
  - Second call with same template and vars returns the same value immediately.

- List all template instances:
  ```bash
  ports tmpl list
  # Or filter by template:
  ports tmpl list --template "redis://{project}-{branch}-cache:6379"
  ```

- Delete a template instance:
  ```bash
  ports tmpl delete --template "redis://{project}-{branch}-cache:6379" --project myapp --branch main
  ```

- JSON output:
  ```bash
  ports tmpl list --json
  ```

**Auto mode (Git-derived variables):**

Use `ports auto tmpl` to automatically derive `project` and `branch` from your Git repository:

- Claim with auto-derived project/branch (user vars override git vars):
  ```bash
  ports auto tmpl claim --template "sqlite://{project}/{branch}/{db}.db"
  # Uses project and branch from git; if you need custom vars:
  ports auto tmpl claim --template "redis://{project}-{branch}-{cache_type}:6379" --cache_type session
  ```

- List template instances for current project/branch:
  ```bash
  ports auto tmpl list
  ```

- Delete a template instance using auto-derived project/branch:
  ```bash
  ports auto tmpl delete --template "redis://{project}-{branch}-cache:6379"
  ```

**Examples:**

```bash
# 1. Store PostgreSQL connection string
ports auto tmpl claim --template "postgresql://localhost:5432/{project}_{branch}" --db_user admin --db_pass secret
# Returns: postgresql://localhost:5432/myapp_main

# 2. Store file path with multiple variables
ports auto tmpl claim --template "/var/data/{project}/{branch}/{env}/config.json" --env production
# Returns: /var/data/myapp/main/production/config.json

# 3. Store multiple cache configurations
ports auto tmpl claim --template "redis://{project}-{branch}-session:6379"
ports auto tmpl claim --template "redis://{project}-{branch}-cache:6380"
ports auto tmpl claim --template "redis://{project}-{branch}-queue:6381"

# 4. List all templates for current branch
ports auto tmpl list

# 5. Query JSON for integration with other tools
ports auto tmpl list --json | jq '.items[] | {template, value}'
```

**Rules and design:**
- Placeholders use `{name}` syntax; all placeholders in the template must have corresponding variables.
- Variables are arbitrary key-value pairs (strings only; no nesting).
- The (template, vars) pair must be unique; calling claim with the same pair twice is idempotent.
- No `update` operation; to change a value, delete and re-claim with different variables.
- No separate `get` operation; `claim` serves both create and read roles.

**Language integration (template strings):**

```typescript
// TypeScript / Node.js
import { execSync } from 'child_process';

const result = JSON.parse(
  execSync(`ports auto tmpl claim --template "redis://{project}-{branch}:6379" --json`, {
    cwd: '/path/to/git/repo',
    encoding: 'utf-8'
  })
);
console.log(result.value); // redis://myapp-main:6379
```

```python
# Python
import subprocess
import json

result = json.loads(subprocess.check_output([
    'ports', 'auto', 'tmpl', 'claim',
    '--template', 'redis://{project}-{branch}:6379',
    '--json'
], cwd='/path/to/git/repo', text=True))
print(result['value'])  # redis://myapp-main:6379
```

```go
// Go
import (
  "encoding/json"
  "os/exec"
)

cmd := exec.Command("ports", "auto", "tmpl", "claim",
  "--template", "redis://{project}-{branch}:6379",
  "--json")
cmd.Dir = "/path/to/git/repo"
output, _ := cmd.Output()

var result map[string]interface{}
json.Unmarshal(output, &result)
// result["value"] = "redis://myapp-main:6379"
```

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
  - behavior: safe claim; with `savage=true` and already registered, will reclaim occupied port; first-time claim never kills.
- `ports.allocate`
  - input: `{ project: string, branch: string, purpose: string, name?: string = 'default', failIfExists?: boolean = false }`
  - behavior: idempotent DB allocation (no OS check, no kill), skipping reserved ports.
- `ports.find`
  - input: `{ start: number, end: number, includeRegistered?: boolean, includeReserved?: boolean }`
  - behavior: returns a currently OS-free port in range; by default excludes DB-registered and reserved ports.
- `ports.list`
  - input: `{ project?: string, branch?: string, purpose?: string, name?: string }`
  - behavior: returns bindings with fields: project, branch, purpose, name, port, created_at, updated_at.

DB selection for MCP

- Default DB path: `~/.vibeports/vibeports.sqlite3`.
- Override by env var in the MCP server config: `VIBEPORTS_DB=/path/to/db.sqlite3`.

Safety notes for MCP consumers

- `ports.claim` with `savage=true` may terminate processes that occupy the registered port. Use only in the designated owner flow; non-owners should call `ports.claim` without flags.
- Purpose ranges must be defined (builtin: frontend/backend; custom via `ports.purpose.set`).
- Reserved ports are skipped by allocate/claim and by default in `ports.find`.

Language integration: calling vibe-ports from any language

Since vibe-ports is a CLI tool, you can call it directly from any programming language using that language's shell execution API. No language-specific SDK package is needed.

**Installation**

```bash
npm install -g vibe-ports
# or locally in your project:
npm install -D vibe-ports
```

**TypeScript / Node.js**

```typescript
import { execSync } from 'child_process';

function claimPort(project: string, branch: string, purpose: string, name: string = 'default'): number {
  const output = execSync(
    `ports auto claim -u ${purpose} -n ${name} --json`,
    {
      cwd: '/path/to/your/git/repo',  // so git auto-derivation works
      encoding: 'utf-8',
      env: { ...process.env, VIBEPORTS_DB: process.env.VIBEPORTS_DB }
    }
  );
  return JSON.parse(output).port;
}

const port = claimPort('myapp', 'main', 'backend', 'api');
console.log(`Server listening on port ${port}`);
```

Or more simply (if project/branch are already known):

```typescript
import { execSync } from 'child_process';

const port = parseInt(
  execSync('ports claim -p myapp -b main -u backend -n api').toString().trim(),
  10
);
```

**Python**

```python
import subprocess
import json
import os

def claim_port(project: str, branch: str, purpose: str, name: str = 'default') -> int:
    output = subprocess.check_output([
        'ports', 'auto', 'claim', '-u', purpose, '-n', name, '--json'
    ], cwd='/path/to/your/git/repo', text=True)
    return json.loads(output)['port']

port = claim_port('myapp', 'main', 'backend', 'api')
print(f'Server listening on port {port}')
```

Or with explicit project/branch:

```python
import subprocess

port = int(subprocess.check_output([
    'ports', 'claim',
    '-p', 'myapp', '-b', 'main',
    '-u', 'backend', '-n', 'api'
]).decode().strip())
```

**Go**

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

func claimPort(project, branch, purpose, name string) (int, error) {
	cmd := exec.Command("ports", "auto", "claim",
		"-u", purpose,
		"-n", name,
		"--json")
	cmd.Dir = "/path/to/your/git/repo"

	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return 0, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		return 0, err
	}
	return int(result["port"].(float64)), nil
}

func main() {
	port, _ := claimPort("myapp", "main", "backend", "api")
	fmt.Printf("Server listening on port %d\n", port)
}
```

Or more simply:

```go
package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func main() {
	output, _ := exec.Command("ports", "claim",
		"-p", "myapp", "-b", "main",
		"-u", "backend", "-n", "api").Output()
	port, _ := strconv.Atoi(strings.TrimSpace(string(output)))
	fmt.Printf("Server listening on port %d\n", port)
}
```

**Go: Recommended setup**

For production-like Go projects, here's the recommended pattern:

```go
package ports

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// PortManager handles port allocation via vibe-ports CLI
type PortManager struct {
	// GitRepo is the path to the git repo for auto-derivation
	// If empty, will use current directory
	GitRepo string
}

// PortInfo contains the response from vibe-ports claim
type PortInfo struct {
	Project   string `json:"project"`
	Branch    string `json:"branch"`
	Purpose   string `json:"purpose"`
	Name      string `json:"name"`
	Port      int    `json:"port"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// NewPortManager creates a new port manager
func NewPortManager(gitRepo string) *PortManager {
	if gitRepo == "" {
		gitRepo = "."
	}
	return &PortManager{GitRepo: gitRepo}
}

// ClaimAuto claims a port using auto-derived project/branch from Git
// purpose should be "frontend", "backend", or custom (must be configured first)
// name defaults to "default"
func (pm *PortManager) ClaimAuto(purpose, name string) (int, error) {
	if name == "" {
		name = "default"
	}

	cmd := exec.Command("ports", "auto", "claim", "-u", purpose, "-n", name, "--json")
	cmd.Dir = pm.GitRepo

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("failed to claim port: %w", err)
	}

	var info PortInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return 0, fmt.Errorf("failed to parse port info: %w", err)
	}

	return info.Port, nil
}

// ClaimAutoReclaim claims a port and kills occupants if needed
// Only effective if the port is already registered; first claim never kills
func (pm *PortManager) ClaimAutoReclaim(purpose, name string) (int, error) {
	if name == "" {
		name = "default"
	}

	cmd := exec.Command("ports", "auto", "claim", "-u", purpose, "-n", name, "--savage", "--json")
	cmd.Dir = pm.GitRepo

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("failed to claim port: %w", err)
	}

	var info PortInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return 0, fmt.Errorf("failed to parse port info: %w", err)
	}

	return info.Port, nil
}

// GetAuto gets an already-claimed port using auto-derived project/branch
func (pm *PortManager) GetAuto(purpose, name string) (int, error) {
	if name == "" {
		name = "default"
	}

	cmd := exec.Command("ports", "auto", "get", "-u", purpose, "-n", name)
	cmd.Dir = pm.GitRepo

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("port not found: %w", err)
	}

	port, err := strconv.Atoi(strings.TrimSpace(string(output)))
	if err != nil {
		return 0, fmt.Errorf("invalid port: %w", err)
	}

	return port, nil
}

// Claim claims a port with explicit project/branch
func (pm *PortManager) Claim(project, branch, purpose, name string) (int, error) {
	if name == "" {
		name = "default"
	}

	cmd := exec.Command("ports", "claim",
		"-p", project, "-b", branch,
		"-u", purpose, "-n", name, "--json")

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("failed to claim port: %w", err)
	}

	var info PortInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return 0, fmt.Errorf("failed to parse port info: %w", err)
	}

	return info.Port, nil
}

// Release releases a port using auto-derived project/branch
func (pm *PortManager) ReleaseAuto(purpose, name string) error {
	if name == "" {
		name = "default"
	}

	cmd := exec.Command("ports", "auto", "delete", "-u", purpose, "-n", name)
	cmd.Dir = pm.GitRepo

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to release port: %w", err)
	}

	return nil
}
```

**Usage example:**

```go
package main

import (
	"fmt"
	"log"
	"net/http"

	"myapp/ports"
)

func main() {
	// Create port manager (uses current git repo for auto-derivation)
	pm := ports.NewPortManager(".")

	// Claim port for backend service (safe claim)
	port, err := pm.ClaimAuto("backend", "api")
	if err != nil {
		log.Fatalf("Failed to claim port: %v", err)
	}

	fmt.Printf("Backend API listening on port %d\n", port)

	// Start your server
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Hello from port %d\n", port)
	})

	addr := fmt.Sprintf(":%d", port)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
```

**For service/daemon with reclaim (e.g., in a dev server restart script):**

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net"

	"myapp/ports"
)

func main() {
	pm := ports.NewPortManager(".")

	// Reclaim mode: kill any existing process on the registered port
	// (only if the port was previously registered; first claim never kills)
	port, err := pm.ClaimAutoReclaim("backend", "api")
	if err != nil {
		log.Fatalf("Failed to claim port: %v", err)
	}

	fmt.Printf("Claimed port %d (killed any occupants)\n", port)

	// Verify port is actually free
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		log.Fatalf("Port %d is still occupied: %v", port, err)
	}
	defer listener.Close()

	fmt.Printf("Port %d is confirmed free\n", port)
}
```

**Go project structure recommendation:**

```
myapp/
├── cmd/
│   ├── api/
│   │   └── main.go          ← starts backend server
│   ├── worker/
│   │   └── main.go          ← starts worker service
│   └── web/
│       └── main.go          ← starts dev proxy
├── internal/
│   ├── ports/
│   │   └── manager.go       ← PortManager (shown above)
│   ├── api/
│   ├── worker/
│   └── ...
├── go.mod
├── go.sum
└── Makefile                 ← can use ports CLI
```

**Makefile example:**

```makefile
.PHONY: start-api start-worker start-all stop-all

# Claim ports using auto-derivation, then start services
start-api:
	@go run ./cmd/api

start-worker:
	@go run ./cmd/worker

start-all: start-api start-worker

# Cleanup: release ports when done
stop-all:
	@ports auto delete -u backend -n api --kill
	@ports auto delete -u backend -n worker --kill

# Dev server restart: auto-reclaims port if occupied
restart-api:
	@killall -SIGINT api 2>/dev/null || true
	@sleep 1
	@go run ./cmd/api  # ClaimAutoReclaim ensures port is free
```

**Common patterns in Go:**

1. **Graceful shutdown with port release:**
   ```go
   pm := ports.NewPortManager(".")
   port, _ := pm.ClaimAuto("backend", "api")

   sigChan := make(chan os.Signal, 1)
   signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

   go func() {
   	<-sigChan
   	log.Println("Shutting down...")
   	pm.ReleaseAuto("backend", "api")  // Release port on exit
   	os.Exit(0)
   }()
   ```

2. **Multiple services in one binary:**
   ```go
   apiPort, _ := pm.ClaimAuto("backend", "api")
   workerPort, _ := pm.ClaimAuto("backend", "worker")
   metricsPort, _ := pm.ClaimAuto("backend", "metrics")
   ```

3. **Conditional logic based on purpose:**
   ```go
   purposes := []string{"frontend", "backend", "worker"}
   ports := make(map[string]int)

   for _, purpose := range purposes {
   	port, err := pm.ClaimAuto(purpose, "default")
   	if err != nil {
   		// Purpose not configured, skip
   		continue
   	}
   	ports[purpose] = port
   }
   ```

**Bash/Shell**

```bash
# Auto-derive from git (recommended)
PORT=$(ports auto claim -u backend -n api)
echo "Server listening on port $PORT"

# Or explicit project/branch
PORT=$(ports claim -p myapp -b main -u backend -n api)
echo "Server listening on port $PORT"

# Get an existing port
PORT=$(ports auto get -u backend -n api)

# Delete when done
ports auto delete -u backend -n api
```

**Ruby**

```ruby
def claim_port(purpose, name = 'default')
  output = `ports auto claim -u #{purpose} -n #{name}`
  output.strip.to_i
rescue => e
  puts "Error claiming port: #{e.message}"
  nil
end

port = claim_port('backend', 'api')
puts "Server listening on port #{port}"
```

**Java / Kotlin**

```java
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class PortManager {
  public static int claimPort(String purpose, String name) throws Exception {
    ProcessBuilder pb = new ProcessBuilder(
        "ports", "auto", "claim", "-u", purpose, "-n", name);
    Process process = pb.start();

    BufferedReader reader = new BufferedReader(
        new InputStreamReader(process.getInputStream()));
    String port = reader.readLine().strip();
    return Integer.parseInt(port);
  }

  public static void main(String[] args) throws Exception {
    int port = claimPort("backend", "api");
    System.out.println("Server listening on port " + port);
  }
}
```

**General pattern (any language)**

1. Install vibe-ports globally: `npm install -g vibe-ports`
2. Call the CLI using your language's shell execution API
3. Parse the JSON output (when using `--json`) or plain text output
4. Use the returned port number

**Tips**

- Use `ports auto claim` when developing in a git repository (auto-derives project/branch)
- Use `--json` flag for reliable parsing in code
- For non-git environments, use explicit `--project` and `--branch` flags
- Wrap calls in try/catch or error handling in case `ports` command is not installed
- Set `VIBEPORTS_DB` environment variable if using non-default database location
