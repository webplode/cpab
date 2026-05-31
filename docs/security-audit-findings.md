# Security Audit Findings

Audit date: 2026-05-31

Scope: `internal/`, `web/src/`, `web/package.json`, Go and npm dependency scans.

Mode: audit only. No source changes were made as part of this report.

## Summary

The current repository has several high-impact web security issues, mostly around delegated admin privileges, secret handling, proxy-aware rate limiting, inconsistent model-list authentication, and MFA flow mismatches between the frontend and backend.

Production npm dependencies reported no vulnerabilities with `npm audit --omit=dev --json`. The full frontend dependency tree reported dev-tooling vulnerabilities. `govulncheck` reported reachable Go/runtime vulnerabilities.

## Critical

### C-01 - Delegated admin permissions can become full platform takeover

Impact: A non-super admin who has administrator-management permissions can create super-admin accounts, grant arbitrary permissions, set `is_super_admin`, or reset another admin password without proving the old password. This makes the administrator module effectively equivalent to root unless it is restricted to existing super admins.

Evidence:

- `internal/http/api/admin/handlers/admins.go:30` accepts `is_super_admin` in admin creation.
- `internal/http/api/admin/handlers/admins.go:81` persists the caller-provided super-admin flag.
- `internal/http/api/admin/handlers/admins.go:193` accepts arbitrary permissions during update.
- `internal/http/api/admin/handlers/admins.go:206` updates `is_super_admin`.
- `internal/http/api/admin/handlers/admins.go:338` updates any admin password by ID.
- `internal/http/api/admin/permissions_middleware.go:47` only enforces route-level permission or super-admin bypass.

Recommendation: Require super-admin status for creating/updating super-admins, changing admin permissions, and resetting other admin passwords. Require old password or a separate super-admin-only reset path for password changes.

## High

### H-01 - Customer/API keys are stored as plaintext bearer secrets

Impact: Database access, backups, migration exports, or logs containing model rows can leak active user/admin API keys. Because authentication compares the supplied token directly against `api_key`, leaked keys are immediately usable.

Evidence:

- `internal/models/api_key.go:10` stores full API key values in `APIKey`.
- `internal/http/api/admin/handlers/api_keys.go:47` stores generated admin API keys directly.
- `internal/http/api/front/handlers/api_keys.go:232` stores generated user API keys directly.
- `internal/http/api/front/handlers/api_keys.go:443` replaces keys with another plaintext token.
- `internal/access/db_api_key_provider.go:84` authenticates with `WHERE api_key = ?`.

Recommendation: Store only a keyed hash of API keys. Show full keys once at creation, store a prefix/fingerprint for display, and compare using constant-time hash verification.

### H-02 - Admin APIs return or export full upstream/provider secrets

Impact: Any admin with read/export access to provider keys, auth files, prepaid cards, or migration data can exfiltrate full upstream provider credentials, API keys, and redemption passwords. This is especially risky if RBAC delegates read access to support or operations roles.

Evidence:

- `internal/http/api/admin/handlers/provider_api_keys.go:754` returns `api_key` and `api_key_entries`.
- `internal/http/api/admin/handlers/auth_files.go:454` returns auth `content`.
- `internal/http/api/admin/handlers/auth_files.go:964` only applies Kiro-specific redaction.
- `internal/http/api/admin/handlers/auth_files.go:886` builds export payloads from stored auth content.
- `internal/http/api/admin/handlers/migration.go:145` exports full database state, including admins, auths, provider API keys, API keys, settings, and usage.
- `internal/http/api/admin/handlers/prepaid_cards.go:388` returns prepaid card passwords.

Recommendation: Redact secret fields in list/get responses by default. Add explicit reveal/export workflows gated by super-admin status, audit logging, and short-lived confirmation.

### H-03 - Auth rate limiting can be bypassed with spoofed client IP headers

Impact: Login/register/MFA-preparation endpoints are rate-limited by `c.ClientIP()`. This repository does not configure Gin trusted proxies, and Gin v1.10.1 defaults to trusting all proxies. An internet client can rotate `X-Forwarded-For` to evade per-IP authentication throttling.

Evidence:

- `internal/http/auth_rate_limit.go:25` keys rate limits on `c.ClientIP()`.
- No `SetTrustedProxies` usage was found in `internal/`.
- `github.com/gin-gonic/gin@v1.10.1/gin.go:203` enables forwarded client IP handling.
- `github.com/gin-gonic/gin@v1.10.1/gin.go:213` defaults trusted proxies to `0.0.0.0/0` and `::/0`.
- `github.com/gin-gonic/gin@v1.10.1/context.go:828` trusts configured proxy headers before returning client IP.

Recommendation: Call `engine.SetTrustedProxies()` with the exact proxy CIDRs used in deployment, or disable trusted proxies when directly exposed. Consider rate limits keyed by username plus IP for auth endpoints.

### H-04 - Reachable Go/runtime vulnerabilities are present

Impact: `govulncheck` reported reachable vulnerabilities in Go `1.26.0` and `golang.org/x/net v0.47.0`, including HTTP/2 DoS, ReverseProxy query forwarding behavior, TLS DoS, x509 authentication/DoS issues, and html/template XSS-related runtime vulnerabilities.

Evidence:

- `go version`: `go1.26.0 darwin/arm64`.
- `go list -m`: `golang.org/x/net v0.47.0`.
- `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` reported 13 reachable vulnerabilities:
  - `GO-2026-5026` in `golang.org/x/net/idna`, fixed in `x/net v0.55.0`.
  - `GO-2026-4976` in `net/http/httputil`, fixed in Go `1.26.3`.
  - `GO-2026-4971` in `net`, fixed in Go `1.26.3`.
  - `GO-2026-4947`, `GO-2026-4946`, `GO-2026-4866`, `GO-2026-4600`, `GO-2026-4599` in `crypto/x509`, fixed in Go `1.26.1` to `1.26.2`.
  - `GO-2026-4918` in HTTP/2, fixed in Go `1.26.3` and `x/net v0.53.0`.
  - `GO-2026-4870` in `crypto/tls`, fixed in Go `1.26.2`.
  - `GO-2026-4865` in `html/template`, fixed in Go `1.26.2`.
  - `GO-2026-4602` in `os`, fixed in Go `1.26.1`.
  - `GO-2026-4601` in `net/url`, fixed in Go `1.26.1`.

Recommendation: Upgrade the Go toolchain to at least `1.26.3`, update `golang.org/x/net` to at least `v0.55.0`, then rerun `govulncheck ./...`.

## Medium

### M-01 - Model-list endpoints use weaker API-key auth than proxy requests

Impact: Expired API keys can still list models through `/v1/models` and `/v1beta/models`. The model-list middleware authenticates separately because it runs before route-group auth, but it omits expiration and balance checks used by the main DB API-key provider.

Evidence:

- `internal/http/models_middleware.go:528` queries `api_key = ? AND active = ? AND revoked_at IS NULL`.
- `internal/access/db_api_key_provider.go:84` also checks `(expires_at IS NULL OR expires_at > ?)`.
- `internal/access/db_api_key_provider.go:94` checks user disabled status and balance eligibility.

Recommendation: Reuse the same DB API-key provider logic for model listing or exactly mirror expiration, revoked, active, disabled-user, and billing/balance checks.

### M-02 - Frontend MFA login flow is incompatible with backend MFA contract

Impact: MFA-enabled user/admin accounts cannot complete normal UI login. The backend requires an `mfa_token` issued after password validation, but the frontend moves from username preparation directly to TOTP/passkey calls with only the username. This is primarily an availability/auth-flow bug, but it weakens operational confidence in MFA.

Evidence:

- `internal/http/api/front/handlers/auth.go:144` returns `mfa_token` after password validation.
- `internal/http/api/admin/handlers/auth.go:70` returns `mfa_token` after password validation.
- `internal/http/api/front/handlers/mfa.go:573` expects `mfa_token` in TOTP login.
- `internal/http/api/admin/handlers/mfa.go:575` expects `mfa_token` in TOTP login.
- `web/src/pages/Login.tsx:161` posts `{ username, code }` to `/v0/front/login/totp`.
- `web/src/pages/admin/Login.tsx:165` posts `{ username, code }` to `/v0/admin/login/totp`.
- `web/src/pages/Login.tsx:211` posts `{ username }` to passkey options.
- `web/src/pages/admin/Login.tsx:228` posts `{ username }` to passkey options.

Recommendation: After username preparation, still collect password and call `/login`; if `mfa_required` is returned, retain `mfa_token` and send it to TOTP/passkey option and verify endpoints.

### M-03 - MFA enrollment and disable actions require only a bearer token

Impact: If a bearer token is stolen, an attacker can prepare/confirm TOTP, register passkeys, or disable existing MFA without reauthenticating with a password or existing MFA. This is especially sensitive for admin accounts.

Evidence:

- `internal/http/api/admin/admin.go:49` puts MFA management routes behind only `adminAuthMiddleware`.
- `internal/http/api/front/front.go:47` puts user MFA management routes behind only `userAuthMiddleware`.
- `internal/http/api/admin/handlers/mfa.go:262` prepares admin TOTP.
- `internal/http/api/admin/handlers/mfa.go:350` disables admin TOTP.
- `internal/http/api/front/handlers/mfa.go:260` prepares user TOTP.
- `internal/http/api/front/handlers/mfa.go:348` disables user TOTP.

Recommendation: Require recent password or existing MFA verification for MFA enrollment, passkey changes, and MFA disable operations. Consider short-lived reauth sessions for sensitive account changes.

### M-04 - JWTs are stored in `localStorage`

Impact: Any future XSS bug can immediately steal admin and user bearer tokens. I did not find current `dangerouslySetInnerHTML`, `innerHTML`, or `eval` usage in `web/src`, but the storage choice increases the blast radius of any future DOM/script injection.

Evidence:

- `web/src/api/config.ts:25` reads the front JWT from localStorage for Authorization headers.
- `web/src/api/config.ts:66` reads the admin JWT from localStorage for Authorization headers.
- `web/src/pages/Login.tsx:188` stores the front token.
- `web/src/pages/admin/Login.tsx:192` stores the admin token.

Recommendation: Prefer secure, HttpOnly, SameSite cookies for browser sessions, or keep access tokens in memory with short lifetimes and refresh-token rotation in HttpOnly cookies.

### M-05 - Auth-file multipart import reads uploaded files fully into memory

Impact: An authenticated admin with auth-file import permission can upload large or many files and cause memory pressure. Gin may spool multipart data to disk, but the handler then calls `io.ReadAll` on each file without explicit size/count limits.

Evidence:

- `internal/http/api/admin/handlers/auth_files.go:169` parses multipart form uploads.
- `internal/http/api/admin/handlers/auth_files.go:176` accepts all entries in `files`.
- `internal/http/api/admin/handlers/auth_files.go:229` reads each file fully into memory.

Recommendation: Enforce max file count, max per-file size, and max aggregate import size. Use `io.LimitReader` and fail closed when the limit is exceeded.

### M-06 - Full frontend dependency tree has dev-tooling vulnerabilities

Impact: Production dependencies are clean, but local/CI/dev server workflows remain exposed to known vulnerable dev tooling. Vite findings are particularly relevant if dev or preview servers are exposed beyond localhost.

Evidence:

- `npm audit --omit=dev --json`: 0 vulnerabilities.
- `npm audit --json`: 6 total vulnerabilities, 4 high and 2 moderate.
- Direct vulnerable dev dependency: `vite` range `7.0.0 - 7.3.1`.
- Reported advisories include Vite arbitrary file read / fs deny bypass / path traversal, lodash code injection/prototype pollution, flatted prototype pollution, picomatch ReDoS/method injection, postcss XSS, and brace-expansion DoS.

Recommendation: Upgrade Vite and affected transitive dev tooling, then rerun both production-only and full npm audits.

## Low

### L-01 - Gemini-compatible `?key=` API-key auth is accepted

Impact: Query-string API keys are easier to leak via browser history, reverse proxies, analytics, and intermediary logs. The application masks sensitive query values in its own Gin request logger, but external infrastructure may not.

Evidence:

- `internal/access/db_api_key_provider.go:155` accepts `?key=` for `/v1beta`.
- `internal/http/models_middleware.go:584` accepts `?key=` for model listing.
- `internal/util/util.go:37` masks sensitive query parameters in application request logs.

Recommendation: Prefer header-based auth. If `?key=` must remain for Gemini compatibility, document the risk and ensure reverse proxies and access logs redact it.

### L-02 - First-run init endpoint is publicly callable until initialization completes

Impact: If the service is exposed during first boot before configuration/admin setup, anyone who can reach it may initialize the system. This appears intentional, but it is unsafe for internet-exposed first-run deployments.

Evidence:

- `internal/app/init.go:414` exposes `/v0/init/setup` while config is missing.
- `internal/app/init.go:447` writes the config and creates the first admin.

Recommendation: Bind first-run setup to localhost by default, require a one-time setup token, or document that the init server must not be exposed publicly.

## Positive Findings

- Password hashing uses bcrypt with cost 12 in `internal/security/password.go`.
- JWT parsing rejects non-HMAC signing methods in `internal/security/jwt.go`.
- The application validates weak/unset JWT secrets in `internal/config/config.go`.
- CORS and security headers are centrally set in `internal/app/cors.go`.
- No `dangerouslySetInnerHTML`, `innerHTML`, or `eval` usage was found in `web/src` during this audit.
- API query logging masks keys/tokens/secrets in `internal/util/util.go`.

## Verification Commands

Commands used during this audit:

```bash
git status --short --branch
npm audit --json
npm audit --omit=dev --json
go version
go list -m golang.org/x/net golang.org/x/crypto golang.org/x/text github.com/gin-gonic/gin github.com/golang-jwt/jwt/v5
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Results:

- Working tree was clean before the report was written.
- `npm audit --omit=dev --json` returned 0 production vulnerabilities.
- `npm audit --json` returned 6 dev-tree vulnerabilities.
- `govulncheck` returned 13 reachable Go/runtime vulnerabilities.
