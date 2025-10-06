vibe-ports

A minimal CLI to allocate, query and delete unique ports by the tuple (project, branch, purpose). Designed to be used via `npx` (TypeScript, Node 18+), storing data in a user-local SQLite DB at `~/.vibeports/vibeports.sqlite3` by default.

- Uniqueness:
  - (project, branch, purpose) is unique
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
  - `ports allocate --project myproj --branch feat-x --purpose frontend`
  - Prints the allocated port; if the tuple already exists, returns the existing port.

- Get
  - `ports get --project myproj --branch feat-x --purpose frontend`

- Delete
  - `ports delete --project myproj --branch feat-x --purpose frontend`

Common options:
- `--db <path>`: override DB path (default `~/.vibeports/vibeports.sqlite3`; env `VIBEPORTS_DB` or legacy `KVPORT_DB`)
- `--json`: JSON output

Help

- `ports --help` or `ports -h`
- `ports help <command>` (e.g., `ports help allocate`)

Database baseline

Schema is defined in `db/baseline.sql` (single baseline file, no versioned SQL). On first run, the CLI ensures the schema exists and re-applies guarded statements on each open to keep indexes/triggers present.

Notes

- Concurrency: uses SQLite WAL and unique indexes to guarantee correctness; allocation is transactional.
- Only accounts ports; it does not check if a port is free on the OS.
- Node 18+ is required.

List all bindings

- `ports list` (or `ports view`): prints a table with all entries.
- `ports list --json`: prints JSON array with all entries.
