Implement admin bulk operations for auth files and proxies with safe backend support,
  import-compatible auth export, and verified UI behavior.

  Objective:
  Add bulk actions to the admin UI/API so admins can:
  1. Select multiple auth files and delete them in one confirmed action.
  2. Select multiple proxy records and delete them in one confirmed action.
  3. Export auth files as JSON where selected rows are exported if any are selected, otherwise
  all auth files are exported.

  Context to read first:
  - `internal/http/api/admin/handlers/auth_files.go`
  - `internal/http/api/admin/handlers/auth_files_test.go`
  - `internal/http/api/admin/admin.go`
  - Existing proxy handler/routes backing `/v0/admin/proxies`
  - `web/src/pages/admin/AuthFiles.tsx`
  - Existing admin proxies page/component files
  - Existing admin permission, toast, modal, table selection, API fetch, and locale patterns

  Backend requirements:
  - Preserve `GET /v0/admin/auth-files/export` as export-all for backward compatibility.
  - Add `POST /v0/admin/auth-files/export` accepting `{ "ids": [number, ...] }` to export only
  selected auth rows.
  - Add true backend batch delete endpoints for auth files and proxies, preferably using
  existing route style, for example:
    - `POST /v0/admin/auth-files/batch-delete`
    - `POST /v0/admin/proxies/batch-delete`
  - Batch delete should be tolerant and transactional where practical:
    - Delete all existing selected IDs.
    - Return `deleted` count and `missing_ids`.
    - Missing IDs must not prevent deletion of existing IDs.
  - Deleting means DB record deletion only. Do not delete filesystem files.

  Export requirements:
  - Export provider/auth payload JSON only.
  - Include stored auth secrets such as access tokens, refresh tokens, OAuth fields, cookies,
  and provider auth data exactly as needed for re-import.
  - Do not include or synthesize CPAB row metadata in exported payloads:
    - no `proxy_url`
    - no `auth_group_id` / auth groups
    - no `rate_limit`
    - no row-derived `priority`
    - no row-derived `is_available` / `isActive`
    - no row-derived `created_at`, `updated_at`, `createdAt`, `updatedAt`
  - If a field already exists inside the stored auth content itself, preserve it as auth payload
  data; the export code must not add model-row fields.
  - Exported JSON must remain accepted by the existing auth import flow.

  Frontend requirements:
  - Auth Files page:
    - Existing export button exports selected rows when selection count > 0, otherwise exports
    all.
    - Add bulk delete button using selected auth IDs, disabled when none are selected.
    - Use one confirmation dialog showing selected count.
    - Show clear success/warning feedback, including missing IDs/count if returned.
    - Clear deleted selections and refresh data after success.
  - Proxies page:
    - Add multi-select if missing.
    - Add bulk delete with one confirmation, selected-count messaging, disabled/loading states,
    and refresh after success.
  - Keep UI consistent with current admin table/actions/modal/toast patterns.
  - Add/update locale strings for new labels and messages.

  Constraints:
  - Do not change auth list/get redaction behavior.
  - Do not redesign import, quota polling, token refresh, model routing, billing, or permission
  architecture.
  - Do not edit the frontend submodule from the parent repo if that is unsafe; pause and report
  if the work must happen inside the `cpab-web` repo directly.
  - Follow repo rules: no script-based code rewrites, no filesystem deletion, no destructive git
  commands.

  Validation:
  - Add or update backend tests for:
    - selected auth export exports only requested IDs
    - export-all still works
    - export payload does not include synthesized CPAB row metadata
    - batch auth delete deletes existing IDs and reports missing IDs
    - batch proxy delete deletes existing IDs and reports missing IDs
  - Run focused tests first:
    - `go test ./internal/http/api/admin/handlers`
  - Then run broader checks if practical:
    - `go test ./...`
    - `cd web && npm run build`
    - `cd web && npm run lint` if configured and not blocked by unrelated existing issues
  - If a dev server is needed to verify UI behavior, run it and use browser verification for:
    - selecting auth rows
    - selected export vs export-all
    - bulk auth delete confirmation
    - selecting proxy rows
    - bulk proxy delete confirmation

  Done when:
  - Auth files support selected bulk delete from UI and API.
  - Proxies support selected bulk delete from UI and API.
  - Auth export exports selected rows when selected, otherwise all rows.
  - Exported auth JSON contains auth/provider payload data only and can be re-imported.
  - Missing IDs in batch delete are reported without failing existing deletions.
  - Permissions, loading states, disabled states, confirmations, toasts, and translations match
  existing admin UI patterns.
  - Relevant tests/builds pass, or any blocked checks are reported with exact reasons.

  Pause if:
  - Existing proxy deletion has dependency/cascade behavior that could break routing or orphan
  related data.
  - Exporting raw auth secrets conflicts with an existing permission/security policy.
  - The frontend cannot be safely edited from this checkout because `web/` is a submodule.
  - Completing the request would require deleting files from disk or running destructive git/
  filesystem commands.

  What Changed

  - Tightened the export contract so the agent does not accidentally preserve today’s row-
    derived metadata injection.
  - Made backend endpoint shape, missing-ID behavior, and tests explicit.
  - Added proxy bulk delete as a first-class requirement instead of leaving it implied.
  - Added pause rules around the risky parts: raw secrets, proxy dependencies, and submodule
    editing.