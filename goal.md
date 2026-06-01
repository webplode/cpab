Implement CPAB admin auth-file health features: a non-refreshing liveness check and an explicit manual
  token refresh action, with backend APIs and admin UI support.

  Context to read first:
  - The proposed plan from this conversation.
  - AGENTS.md project rules, especially no file deletion, no destructive git commands, no DB migration unless
  explicitly approved, npm only for web, and required quality gates.
  - Backend auth-file and quota handlers:
    - internal/http/api/admin/handlers/auth_files.go
    - internal/http/api/admin/handlers/quotas.go
    - internal/http/api/admin/admin.go
    - internal/http/api/admin/permissions/permissions.go
  - Auth/runtime/token paths:
    - internal/store/store.go
    - internal/quota/poller.go
    - CLIProxyAPI/sdk/cliproxy/auth/*
    - CLIProxyAPI/internal/runtime/executor/*
  - Frontend admin auth files page:
    - web/src/pages/admin/AuthFiles.tsx

  Constraints:
  - Add no DB migration and no new DB columns.
  - Keep `is_available` separate from auth health.
  - Liveness check must not refresh, rotate, or mutate stored credential tokens.
  - Manual refresh may mutate `auths.content` only when provider refresh succeeds.
  - Manual refresh must not automatically mark unavailable auth files available.
  - Do not expose access tokens, refresh tokens, id tokens, or secret-bearing provider responses in API/UI output.
  - Preserve existing quota payload and existing `_cpab_auth_status` while adding health metadata.

  Operating rules:
  - Keep a concise progress log in `notepad.md` if the task becomes long-running.
  - Prefer small verified backend and frontend iterations over large unverified edits.
  - Do not expand scope into unrelated auth routing, billing, model mapping, or provider behavior without pausing.
  - Work with existing SDK refresh/executor logic; do not duplicate provider refresh implementations in CPAB
  handlers.

  Validation loop:
  - During work:
    - Run focused Go tests for changed backend packages after each backend milestone.
    - Run focused frontend type/build checks after UI changes where practical.
    - Verify liveness does not alter `auths.content`.
    - Verify refresh preserves `is_available`.
  - Final proof:
    - `go build ./...`
    - `go vet ./...`
    - `go test ./...`
    - `cd web && npm run build`
    - `cd web && npm run lint`
    - `make build`
    - Summarize changed endpoints, UI behavior, and test results.

  Done when:
  - `GET /v0/admin/auth-files` and `GET /v0/admin/auth-files/:id` include derived `auth_health`.
  - `POST /v0/admin/auth-files/:id/liveness-check` works for available and unavailable auth files without
  refreshing tokens.
  - `POST /v0/admin/auth-files/:id/refresh` explicitly refreshes supported auth files, persists successful token
  updates, records health, and preserves availability.
  - Admin Auth Files UI shows health status and provides “Check liveness” and “Refresh token” actions with safe
  loading/error/confirmation behavior.
  - Existing unavailable-auth behavior remains intact and unavailable rows are not loaded as active runtime auths
  on startup.

  Pause if:
  - A provider cannot support non-refreshing liveness without making an authenticated upstream call whose side
  effects are unclear.
  - Manual refresh requires importing SDK internal packages directly into CPAB instead of adding a clean exported
  helper.
  - Any change appears to require a DB migration or new persistent table/column.
  - Tests reveal existing behavior contradicts the planned separation between availability and health.
  - Frontend work requires modifying the `web/` submodule in a way that conflicts with the repo’s submodule
  workflow.