# AGENTS.md - CLIProxyAPIBusiness

> Guidelines for AI coding agents working in this codebase.
> Go 1.26 backend (Gin + GORM) with embedded React/TypeScript frontend.

---

## RULE 0 - THE FUNDAMENTAL OVERRIDE PREROGATIVE

If I tell you to do something, even if it goes against what follows below, YOU MUST LISTEN TO ME. I AM IN CHARGE, NOT YOU.

---

## RULE NUMBER 1: NO FILE DELETION

**YOU ARE NEVER ALLOWED TO DELETE A FILE WITHOUT EXPRESS PERMISSION.** Even a new file that you yourself created, such as a test code file. You have a horrible track record of deleting critically important files or otherwise throwing away tons of expensive work. As a result, you have permanently lost any and all rights to determine that a file or folder should be deleted.

**YOU MUST ALWAYS ASK AND RECEIVE CLEAR, WRITTEN PERMISSION BEFORE EVER DELETING A FILE OR FOLDER OF ANY KIND.**

---

## Irreversible Git & Filesystem Actions — DO NOT EVER BREAK GLASS

1. **Absolutely forbidden commands:** `git reset --hard`, `git clean -fd`, `rm -rf`, or any command that can delete or overwrite code/data must never be run unless the user explicitly provides the exact command and states, in the same message, that they understand and want the irreversible consequences.
2. **No guessing:** If there is any uncertainty about what a command might delete or overwrite, stop immediately and ask the user for specific approval. "I think it's safe" is never acceptable.
3. **Safer alternatives first:** When cleanup or rollbacks are needed, request permission to use non-destructive options (`git status`, `git diff`, `git stash`, copying to backups) before ever considering a destructive command.
4. **Mandatory explicit plan:** Even after explicit user authorization, restate the command verbatim, list exactly what will be affected, and wait for a confirmation that your understanding is correct. Only then may you execute it—if anything remains ambiguous, refuse and escalate.
5. **Document the confirmation:** When running any approved destructive command, record (in the session notes / final response) the exact user text that authorized it, the command actually run, and the execution time. If that record is absent, the operation did not happen.

---

## Git Branch: ONLY Use `main`, NEVER `master`

**The default branch is `main`. The `master` branch exists only for legacy URL compatibility.**

- **All work happens on `main`** — commits, PRs, feature branches all merge to `main`
- **Never reference `master` in code or docs** — if you see `master` anywhere, it's a bug that needs fixing
- **The `master` branch must stay synchronized with `main`** — after pushing to `main`, also push to `master`:
  ```bash
  git push origin main:master
  ```

**If you see `master` referenced anywhere:**
1. Update it to `main`
2. Ensure `master` is synchronized: `git push origin main:master`

---

## Toolchain: Go + npm

We use **`go mod`** for backend dependencies and **`npm`** for the frontend (in `web/`). Never use yarn or pnpm.

### Backend / Server

- **Runtime:** Go 1.26
- **Framework:** Gin (gin-gonic/gin v1.10)
- **Database / ORM:** GORM v1.31 with PostgreSQL (pgx v5) and SQLite (glebarez/sqlite) dual support
- **Cache:** Redis (go-redis/v9) — used for rate limiting and session state
- **Auth:** JWT (golang-jwt/v5) for admin and user sessions, WebAuthn (go-webauthn v0.15) for passkey/MFA, TOTP (pquerna/otp)
- **Config:** YAML (gopkg.in/yaml.v3) config files with env var overrides
- **Logging:** Logrus (sirupsen/logrus) with lumberjack file rotation
- **SDK:** CLIProxyAPI/v6 (v6.8.47) — core proxy engine, provider executors, multi-LLM routing

### Key Backend Dependencies

| Package | Purpose |
|---------|---------|
| `router-for-me/CLIProxyAPI/v6` | Core SDK — proxy engine, provider auth, model routing, config |
| `gin-gonic/gin` | HTTP framework for admin and front-end API routes |
| `gorm.io/gorm` | ORM for all database models and migrations |
| `jackc/pgx/v5` | PostgreSQL driver with timezone-aware type mapping |
| `golang-jwt/jwt/v5` | JWT token generation and validation for admin/user auth |
| `go-webauthn/webauthn` | WebAuthn/passkey registration and verification |
| `pquerna/otp` | TOTP-based MFA setup and validation |
| `redis/go-redis/v9` | Redis client for rate limiting |
| `fsnotify/fsnotify` | File watcher for config hot-reload |
| `tiktoken-go/tokenizer` | Token counting for usage billing |

### Frontend / Client (git submodule: `web/`)

- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **Styling:** Tailwind CSS
- **State:** Zustand + TanStack Query
- **UI Components:** Radix UI + shadcn/ui
- **Charts:** Recharts

The frontend is a **git submodule** at `web/` pointing to `github.com:webplode/cpab-web.git`. It is embedded into the Go binary at build time via `internal/webui/dist`.

---

## Code Editing Discipline

### No Script-Based Changes

**NEVER** run a script that processes/changes code files in this repo. Brittle regex-based transformations create far more problems than they solve.

- **Always make code changes manually**, even when there are many instances
- For many simple changes: use parallel subagents
- For subtle/complex changes: do them methodically yourself

### No File Proliferation

If you want to change something or add a feature, **revise existing code files in place**.

**NEVER** create variations like:
- `service.v2.ts`
- `service.improved.py`
- `handler.enhanced.go`

New files are reserved for **genuinely new functionality** that makes zero sense to include in any existing file. The bar for creating new files is **incredibly high**.

---

## Compiler Checks (CRITICAL)

**After any substantive code changes, you MUST verify no errors were introduced:**

```bash
# Backend — run from project root
go build ./...         # Compile all packages
go vet ./...           # Static analysis
go test ./...          # Run all tests

# Frontend — run from web/
cd web && npm run build   # Vite production build
cd web && npm run lint    # ESLint

# Full build (backend + embedded frontend)
make build             # Runs: web-build → web-embed → backend-build
```

If you see errors, **carefully understand and resolve each issue**. Read sufficient context to fix them the RIGHT way.

---

## CLIProxyAPIBusiness — This Project

**This is the project you're working on.** CLIProxyAPIBusiness is the enterprise/commercial edition of the CLIProxyAPI platform — an API gateway that proxies requests to multiple LLM providers (OpenAI, Anthropic, Google, etc.) with user management, billing, rate limiting, and usage tracking.

### What It Does

CLIProxyAPIBusiness acts as a unified API gateway for AI services. It accepts requests in OpenAI-compatible (`/v1/...`), Anthropic (`/v1/messages`), and Google Gemini (`/v1beta/...`) formats, then routes them to upstream LLM providers using managed credentials. The platform adds a business layer on top: user registration, API key issuance, per-model billing rules, prepaid cards, subscription plans, quotas, rate limiting, model mappings (aliasing/remapping models), and comprehensive usage logging. An embedded React web UI provides admin and user-facing dashboards.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│              Embedded React Web UI (web/)                 │
│     Zustand + TanStack Query + Vite + shadcn/ui          │
│     Built → internal/webui/dist → go:embed               │
└──────────────────────────────────────────────────────────┘
                            │  REST JSON (/v0/admin/*, /v0/front/*)
                            ▼
┌──────────────────────────────────────────────────────────┐
│              Gin HTTP Server (:8318)                      │
│                                                          │
│  /v0/admin/*  → Admin API (JWT + permissions)            │
│  /v0/front/*  → User API (JWT auth)                      │
│  /v1/*        → OpenAI-compat proxy (API key auth)       │
│  /v1beta/*    → Gemini proxy (API key auth)              │
│  /healthz     → Health check                             │
└──────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐    ┌──────────────────┐    ┌──────────────┐
│ CLIProxyAPI │    │  GORM + Postgres │    │    Redis     │
│ SDK v6      │    │  (or SQLite)     │    │  (rate       │
│ (proxy      │    │  20 models,      │    │   limiting)  │
│  engine,    │    │  57K+ line       │    │              │
│  executors) │    │  migrations      │    │              │
└──────┬──────┘    └──────────────────┘    └──────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│            Upstream LLM Providers                        │
│  OpenAI / Anthropic / Google / Azure / Mistral / etc.    │
└──────────────────────────────────────────────────────────┘
```

### Workspace Structure

```
CLIProxyAPIBusiness/
├── cmd/business/                     # Entry point (main.go)
├── internal/
│   ├── app/                          # Application bootstrap, init server, config generation
│   ├── access/                       # DB-backed API key authentication provider
│   ├── auth/                         # Credential selector (round-robin, fill-first, sticky)
│   ├── billing/                      # Billing rule engine
│   ├── config/                       # Config loading (YAML + env vars)
│   ├── db/                           # Database open, dialect detection, migrations (57K lines)
│   ├── http/
│   │   ├── api/admin/                # Admin API routes + handlers (100+ endpoints)
│   │   │   ├── handlers/             # Admin handler implementations
│   │   │   └── permissions/          # RBAC permission middleware
│   │   └── api/front/               # User-facing API routes + handlers
│   │       └── handlers/             # Front handler implementations
│   │   └── models_middleware.go      # Model listing middleware (multi-format API support)
│   ├── logging/                      # Logrus setup, Gin middleware
│   ├── models/                       # GORM model definitions (20 entities)
│   ├── modelmapping/                 # Model alias/remapping logic
│   ├── modelreference/               # Upstream model pricing reference data
│   ├── modelregistry/                # Runtime model registry with hooks
│   ├── providerkeys/                 # Provider API key management
│   ├── quota/                        # Quota polling and enforcement
│   ├── ratelimit/                    # Rate limit manager
│   ├── security/                     # Password hashing, JWT, WebAuthn, random strings
│   ├── settings/                     # Application settings (site name, etc.)
│   ├── store/                        # GORM auth store (persists provider credentials)
│   ├── usage/                        # Usage tracking GORM plugin
│   ├── watcher/                      # Config file watcher, DB-backed auth syncing
│   └── webui/                        # Embedded frontend bundle (go:embed)
├── web/                              # React frontend (git submodule → cpab-web)
├── Makefile                          # Build targets: web-build, web-embed, backend-build
├── Dockerfile                        # Multi-stage: node builder → go builder → alpine
├── .goreleaser.yml                   # Cross-platform release builds
├── docker-compose.yml                # Dev environment with Postgres
├── go.mod / go.sum                   # Go module definition
└── .github/workflows/                # CI: docker-image.yml, release.yml
```

### Key Files

| Area | File | Purpose |
|------|------|---------|
| Entry point | `cmd/business/main.go` | CLI flags, config loading, two-phase boot (init server or main server) |
| App bootstrap | `internal/app/app.go` | `RunServer()` — wires DB, auth, SDK builder, middleware, all route groups |
| Init wizard | `internal/app/init.go` | First-run setup server — DB config, admin creation, config file generation |
| Admin API | `internal/http/api/admin/admin.go` | Registers 100+ admin endpoints under `/v0/admin/*` with JWT + RBAC |
| User API | `internal/http/api/front/front.go` | Registers user-facing endpoints under `/v0/front/*` with JWT auth |
| API key auth | `internal/access/db_api_key_provider.go` | DB-backed API key validation for proxy endpoints (`/v1/*`, `/v1beta/*`) |
| Credential selector | `internal/auth/selector.go` | Chooses upstream provider credentials (round-robin, fill-first, sticky) |
| Auth store | `internal/store/store.go` | GORM-backed persistence for provider auth credentials (upsert/list/delete) |
| DB layer | `internal/db/db.go` | Dual-dialect DB open (Postgres + SQLite), connection pooling, timezone handling |
| Migrations | `internal/db/migrate.go` | Schema migrations (57K lines) — dialect-specific, handles renames and backfills |
| Models | `internal/models/` | 20 GORM entities: User, Admin, APIKey, Bill, PrepaidCard, Usage, Auth, etc. |
| Config | `internal/config/config.go` | Loads DSN, JWT config from YAML files with env var overrides |
| Model middleware | `internal/http/models_middleware.go` | Filters model lists by user group, supports OpenAI/Anthropic/Gemini formats |
| Config watcher | `internal/watcher/watcher.go` | Hot-reloads config, syncs provider credentials from DB to SDK |
| Web UI embed | `internal/webui/bundle.go` | `go:embed` of `dist/` directory, serves React SPA assets |

### Key Design Decisions

- **Two-phase boot:** If no `config.yaml` exists and no `DB_CONNECTION` env var is set, the server starts an init wizard (lightweight Gin server) that guides database setup and admin creation. Once complete, it restarts into the full server. Never remove the init flow without providing an alternative.
- **Dual database dialect:** The same codebase supports both PostgreSQL and SQLite. Dialect is auto-detected from the DSN string. Migrations are dialect-specific (`migratePostgres` vs `migrateSQLite`). Always ensure schema changes work on both dialects.
- **Embedded frontend:** The React SPA from `web/dist` is copied to `internal/webui/dist` at build time and served via `go:embed`. The `web/` directory is a **git submodule** — never commit changes directly there; work in the cpab-web repo instead.
- **SDK delegation:** The CLIProxyAPI SDK (`v6`) handles all actual LLM proxying, model routing, streaming, and provider-specific protocol translation. This project layers business logic (auth, billing, quotas) on top. Never reimplement proxy logic that the SDK already handles.
- **Three credential selection strategies:** The auth selector supports round-robin (0), fill-first (1), and sticky (2) modes for distributing requests across provider API keys. The strategy is configured per model mapping.
- **Billing validation at auth time:** The `DBAPIKeyProvider.Authenticate()` checks billing balance (bills + prepaid cards) before allowing requests through. If a user has no valid bill or prepaid balance, the request is rejected. This happens in the access layer, not in handlers.
- **Admin permissions are RBAC-based:** Admin accounts have a permissions bitmask. The `adminPermissionMiddleware` enforces route-level permissions. Super-admins bypass all permission checks.
- **All timestamps are UTC:** `time.Now().UTC()` is used consistently. PostgreSQL connections set timezone at the driver level. SQLite uses WAL mode with foreign keys enabled.

---

## MCP Agent Mail — Multi-Agent Coordination

A mail-like layer that lets coding agents coordinate asynchronously via MCP tools and resources. Provides identities, inbox/outbox, searchable threads, and advisory file reservations with human-auditable artifacts in Git.

### Why It's Useful

- **Prevents conflicts:** Explicit file reservations (leases) for files/globs
- **Token-efficient:** Messages stored in per-project archive, not in context
- **Quick reads:** `resource://inbox/...`, `resource://thread/...`

### Same Repository Workflow

1. **Register identity:**
   ```
   ensure_project(project_key=<abs-path>)
   register_agent(project_key, program, model)
   ```

2. **Reserve files before editing:**
   ```
   file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true)
   ```

3. **Communicate with threads:**
   ```
   send_message(..., thread_id="FEAT-123")
   fetch_inbox(project_key, agent_name)
   acknowledge_message(project_key, agent_name, message_id)
   ```

4. **Quick reads:**
   ```
   resource://inbox/{Agent}?project=<abs-path>&limit=20
   resource://thread/{id}?project=<abs-path>&include_bodies=true
   ```

### Macros vs Granular Tools

- **Prefer macros for speed:** `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`
- **Use granular tools for control:** `register_agent`, `file_reservation_paths`, `send_message`, `fetch_inbox`, `acknowledge_message`

### Common Pitfalls

- `"from_agent not registered"`: Always `register_agent` in the correct `project_key` first
- `"FILE_RESERVATION_CONFLICT"`: Adjust patterns, wait for expiry, or use non-exclusive reservation
- **Auth errors:** If JWT+JWKS enabled, include bearer token with matching `kid`

---

## Beads (br) — Dependency-Aware Issue Tracking

Beads provides a lightweight, dependency-aware issue database and CLI (`br` - beads_rust) for selecting "ready work," setting priorities, and tracking status. It complements MCP Agent Mail's messaging and file reservations.

**Important:** `br` is non-invasive—it NEVER runs git commands automatically. You must manually commit changes after `br sync --flush-only`.

### Conventions

- **Single source of truth:** Beads for task status/priority/dependencies; Agent Mail for conversation and audit
- **Shared identifiers:** Use Beads issue ID (e.g., `br-123`) as Mail `thread_id` and prefix subjects with `[br-123]`
- **Reservations:** When starting a task, call `file_reservation_paths()` with the issue ID in `reason`

### Typical Agent Flow

1. **Pick ready work (Beads):**
   ```bash
   br ready --json  # Choose highest priority, no blockers
   ```

2. **Reserve edit surface (Mail):**
   ```
   file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true, reason="br-123")
   ```

3. **Announce start (Mail):**
   ```
   send_message(..., thread_id="br-123", subject="[br-123] Start: <title>", ack_required=true)
   ```

4. **Work and update:** Reply in-thread with progress

5. **Complete and release:**
   ```bash
   br close 123 --reason "Completed"
   br sync --flush-only  # Export to JSONL (no git operations)
   ```
   ```
   release_file_reservations(project_key, agent_name, paths=["src/**"])
   ```
   Final Mail reply: `[br-123] Completed` with summary

### Mapping Cheat Sheet

| Concept | Value |
|---------|-------|
| Mail `thread_id` | `br-###` |
| Mail subject | `[br-###] ...` |
| File reservation `reason` | `br-###` |
| Commit messages | Include `br-###` for traceability |

---

## bv — Graph-Aware Triage Engine

bv is a graph-aware triage engine for Beads projects (`.beads/beads.jsonl`). It computes PageRank, betweenness, critical path, cycles, HITS, eigenvector, and k-core metrics deterministically.

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use MCP Agent Mail.

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

### Command Reference

**Planning:**
| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

**Graph Analysis:**
| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core, articulation points, slack |
| `--robot-label-health` | Per-label health: `health_level`, `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |
| `--robot-label-attention [--attention-limit=N]` | Attention-ranked labels |

**History & Change Tracking:**
| Command | Returns |
|---------|---------|
| `--robot-history` | Bead-to-commit correlations |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues, cycles |

**Other:**
| Command | Returns |
|---------|---------|
| `--robot-burndown <sprint>` | Sprint burndown, scope changes, at-risk items |
| `--robot-forecast <id\|all>` | ETA predictions with dependency-aware scheduling |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |
| `--export-graph <file.html>` | Interactive HTML visualization |

### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank
bv --robot-triage --robot-triage-by-track    # Group by parallel work streams
bv --robot-triage --robot-triage-by-label    # Group by domain
```

### Understanding Robot Output

**All robot JSON includes:**
- `data_hash` — Fingerprint of source beads.jsonl
- `status` — Per-metric state: `computed|approx|timeout|skipped` + elapsed ms
- `as_of` / `as_of_commit` — Present when using `--as-of`

**Two-phase analysis:**
- **Phase 1 (instant):** degree, topo sort, density
- **Phase 2 (async, 500ms timeout):** PageRank, betweenness, HITS, eigenvector, cycles

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                        # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'               # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'        # Best unblock target
bv --robot-insights | jq '.status'                         # Check metric readiness
bv --robot-insights | jq '.Cycles'                         # Circular deps (must fix!)
```

---

## UBS — Ultimate Bug Scanner

**Golden Rule:** `ubs <changed-files>` before every commit. Exit 0 = safe. Exit >0 = fix & re-run.

### Commands

```bash
ubs file.rs file2.rs                    # Specific files (< 1s) — USE THIS
ubs $(git diff --name-only --cached)    # Staged files — before commit
ubs --only=rust,toml src/               # Language filter (3-5x faster)
ubs --ci --fail-on-warning .            # CI mode — before PR
ubs .                                   # Whole project (ignores target/, Cargo.lock)
```

### Output Format

```
⚠️  Category (N errors)
    file.rs:42:5 – Issue description
    💡 Suggested fix
Exit code: 1
```

Parse: `file:line:col` → location | 💡 → how to fix | Exit 0/1 → pass/fail

### Fix Workflow

1. Read finding → category + fix suggestion
2. Navigate `file:line:col` → view context
3. Verify real issue (not false positive)
4. Fix root cause (not symptom)
5. Re-run `ubs <file>` → exit 0
6. Commit

### Bug Severity

- **Critical (always fix):** Memory safety, use-after-free, data races, SQL injection
- **Important (production):** Unwrap panics, resource leaks, overflow checks
- **Contextual (judgment):** TODO/FIXME, println! debugging

---
<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

**Important:** `br` is non-invasive—it NEVER executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason "Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export to JSONL (NO git operations)
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Run `br sync --flush-only` then manually commit

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads to JSONL
git add .beads/         # Stage beads changes
git commit -m "..."     # Commit everything together
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `br sync --flush-only && git add .beads/` before ending session

<!-- end-bv-agent-instructions -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Sync beads** - `br sync --flush-only` to export to JSONL
5. **Hand off** - Provide context for next session

---

## Note on Built-in TODO Functionality

Also, if I ask you to explicitly use your built-in TODO functionality, don't complain about this and say you need to use beads. You can use built-in TODOs if I tell you specifically to do so. Always comply with such orders.
