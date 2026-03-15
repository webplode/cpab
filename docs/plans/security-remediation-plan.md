# Security Remediation Plan — CLIProxyAPIBusiness

## Context

`SECURITY_REVIEW.md` identified **29 vulnerabilities** (3 Critical, 9 High, 10 Medium, 7 Low) across the backend and frontend. This plan remediates all findings in 4 phases ordered by risk. The system is a **production multi-tenant LLM API gateway** — changes must not break existing API consumers unless the current behavior is itself a vulnerability.

**Date:** 2026-03-16
**Source:** `SECURITY_REVIEW.md` (2026-03-15)

---

## Phase 1 — CRITICAL (Immediate)

These issues allow account takeover or authentication bypass. They must be resolved before any other work.

### 1.1 B-04: Expired API Keys Still Accepted

| | |
|---|---|
| **Scope** | S (~2 hours) |
| **Breaking** | No |
| **Risk** | Keys with `expires_at` set are never checked — expired keys remain functional indefinitely |

**Files to modify:**
- `internal/access/db_api_key_provider.go:82-85` — add `AND (expires_at IS NULL OR expires_at > ?)` with `time.Now().UTC()` to the WHERE clause
- `internal/access/db_api_key_provider_test.go` — add test cases: (1) NULL expires_at still works, (2) future expires_at works, (3) past expires_at rejected

**Current code:**
```go
Where("api_key = ? AND active = ? AND revoked_at IS NULL", token, true)
```

**Fixed code:**
```go
Where("api_key = ? AND active = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    token, true, time.Now().UTC())
```

**Reuse:** `models.APIKey` already has `ExpiresAt *time.Time` field. The model's `Status()` method already checks expiration for display purposes but enforcement in the provider query is missing.

---

### 1.2 B-01: Unauthenticated Password Reset (Account Takeover)

| | |
|---|---|
| **Scope** | M (~8 hours) |
| **Breaking** | Yes (intentional — current behavior is a vulnerability) |
| **Risk** | `POST /v0/front/reset-password` accepts `username + email + new_password` with zero authentication. Any attacker who knows a username and email can take over any account. |

**Files to modify:**
- `internal/http/api/front/front.go` — move `/reset-password` route from public group (line 31) into the `authed` group (after line 35)
- `internal/http/api/front/handlers/auth.go:150-189` — rewrite `ResetPassword`:
  - Remove `username`/`email` from request body
  - Get user identity from JWT context (`c.Get("userID")`)
  - Require `current_password` field, validate against stored hash using `security.CheckPassword`
- Frontend: Update any reset-password UI flow to require login first

**Design decision:** Since `authed.PUT("/profile/password", profileHandler.ChangePassword)` already exists at line 39, the cleanest approach is to **deprecate `/reset-password`** and redirect clients to `/profile/password`. To avoid breaking consumers immediately:
- Keep the route registered but behind auth middleware
- Have it call the same logic as `profileHandler.ChangePassword`
- Log a deprecation warning when used
- Remove in the next major version

**Tests:** Verify unauthenticated call returns 401, wrong current_password returns 403, correct flow succeeds.

---

### 1.3 B-02: TOTP/Passkey Login Bypasses Password

| | |
|---|---|
| **Scope** | L (~16 hours) |
| **Breaking** | Yes (intentional — MFA should supplement password, not replace it) |
| **Risk** | `LoginTOTP` accepts only `username + TOTP code` and issues a full JWT without password. TOTP has only 1,000,000 values — brute-forceable without rate limiting. Same issue for passkey login. |

**Design: Two-step MFA login flow**

**Step 1 — New types in `internal/security/jwt.go`:**
```go
type PendingMFAClaims struct {
    UserID   uint64 `json:"user_id"`
    Username string `json:"username"`
    Purpose  string `json:"purpose"` // "pending_mfa"
    jwt.RegisteredClaims                // 5-minute TTL
}
```
Add `GeneratePendingMFAToken()` and `ParsePendingMFAToken()` that validates `Purpose == "pending_mfa"`.

**Step 2 — Modify login flow in `internal/http/api/front/handlers/auth.go`:**
- In `Login`, after successful password verification:
  - If MFA enabled → return `{"mfa_required": true, "mfa_token": "<pending>", "mfa_methods": ["totp", "passkey"]}`
  - If no MFA → return full JWT as today (no change for non-MFA users)

**Step 3 — Modify MFA handlers in `internal/http/api/front/handlers/mfa.go`:**
- `LoginTOTP` (lines 542-576): Accept `mfa_token + code` instead of `username + code`. Validate pending token first.
- `LoginPasskeyOptions`: Accept `mfa_token` instead of `username`.
- `LoginPasskeyVerify` (lines 630-710): Accept `mfa_token` instead of `username`.

**Step 4 — Mirror for admin** in `internal/http/api/admin/handlers/auth.go` and `mfa.go`.

**Step 5 — Frontend** `web/src/pages/Login.tsx` — handle `mfa_required` response, pass `mfa_token` to MFA endpoints.

**Files to modify (6):**
- `internal/security/jwt.go`
- `internal/http/api/front/handlers/auth.go`
- `internal/http/api/front/handlers/mfa.go`
- `internal/http/api/admin/handlers/auth.go`
- `internal/http/api/admin/handlers/mfa.go`
- `web/src/pages/Login.tsx`

**Reuse:** The `sessionStore` pattern with TTL at `mfa.go:42-91` serves as reference, but pending MFA uses signed JWT for horizontal scaling.

**Tests:** LoginTOTP without pending token → 401; expired pending token → 401; valid flow → full JWT.

---

## Phase 2 — HIGH (This week)

### 2.1 B-05: No Rate Limiting on Auth Endpoints

| | |
|---|---|
| **Scope** | M (~4 hours) |
| **Breaking** | No |
| **Risk** | All auth endpoints lack brute-force protection |

**Reuse:** `internal/ratelimit/manager.go` — fully functional `Manager` with memory + Redis backends already exists. Just needs wiring.

**Files to modify:**
- `internal/http/api/front/front.go` — create `authRateLimitMiddleware(rlManager)`, apply to login/register/reset/MFA routes. Key: `"auth:" + c.ClientIP()`, limit: 5/min
- `internal/http/api/admin/admin.go` — same for admin auth routes
- `internal/app/app.go` (or route wiring) — pass `ratelimit.Manager` instance

**Response on rejection:** HTTP 429 with `Retry-After` header.

---

### 2.2 B-03: Wildcard CORS

| | |
|---|---|
| **Scope** | M (~4 hours) |
| **Breaking** | Potentially (deployments with frontend on different origin) |
| **Risk** | `Access-Control-Allow-Origin: *` allows any origin to make authenticated requests |

**Files to modify:**
- `internal/app/cors.go` — parameterize `corsMiddleware(allowedOrigins []string)`:
  - Check request `Origin` against list, reflect matching origin
  - Special case: `"*"` allows all (dev mode)
- `internal/config/config.go` — add `CORSOrigins []string` config field, env var `CORS_ORIGINS`
- `docker-compose.yml` — document `CORS_ORIGINS`

**Note:** LLM proxy endpoints (`/v1/*`, `/v1beta/*`) are called by CLI tools, not browsers — CORS doesn't affect them.

---

### 2.3 B-06: Insecure Default JWT Secret

| | |
|---|---|
| **Scope** | S (~3 hours) |
| **Breaking** | Yes (intentional for insecure deployments) |
| **Risk** | Hardcoded fallback `"change-me-to-a-secure-random-string"` in init.go; docker-compose defaults to `"insecure-jwt-secret-change-me"` |

**Files to modify:**
- `internal/app/init.go:189-194` — `generateJWTSecret()`: return error instead of fallback
- `internal/config/config.go` — add startup validation: refuse to boot if secret matches known-weak list
- `docker-compose.yml` — remove defaults, add: `# REQUIRED: openssl rand -hex 32`

---

### 2.4 B-07: JWT Token Namespace Confusion

| | |
|---|---|
| **Scope** | M (~8 hours) |
| **Breaking** | Yes (all existing tokens invalidated — forces re-login) |
| **Risk** | User JWT can be parsed as admin JWT since no `Issuer` claim distinguishes them |

**File:** `internal/security/jwt.go`
- `GenerateToken`: add `Issuer: "cpab:user"`, `ID: uuid.New().String()`
- `GenerateAdminToken`: add `Issuer: "cpab:admin"`, `ID: uuid.New().String()`
- `ParseToken`: validate `claims.Issuer == "cpab:user"`, reject otherwise
- `ParseAdminToken`: validate `claims.Issuer == "cpab:admin"`, reject otherwise

**JTI for future revocation:** Store the JTI claim now; revocation checking comes in Phase 4 (F-12).

**Tests:** Create `internal/security/jwt_test.go` — user token rejected by `ParseAdminToken` and vice versa.

**Deploy note:** All existing tokens invalidated. Deploy during low-traffic window.

---

### 2.5 F-01: JWT in localStorage → httpOnly Cookies

| | |
|---|---|
| **Scope** | L |
| **Breaking** | No (if backward compatible with Authorization header) |
| **Depends on** | B-03 (CORS credentials), B-07 (token namespacing) |

**Backend changes:**
- Add cookie-setting logic on login responses: `Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/`
- Modify auth middleware to read token from cookie OR `Authorization` header (backward compat)

**Frontend changes:**
- `web/src/api/config.ts` — remove localStorage token reads
- `web/src/pages/Login.tsx` — remove `localStorage.setItem(TOKEN_KEY_FRONT, ...)`

---

### 2.6 F-02: No Server-Side Route Guards

| | |
|---|---|
| **Scope** | M |

- Create `web/src/components/ProtectedRoute.tsx` — validates token with backend `GET /v0/front/profile` before rendering
- `web/src/App.tsx` — wrap admin/user routes with `ProtectedRoute`

---

### 2.7 F-03: Admin Permissions from localStorage

| | |
|---|---|
| **Scope** | S |

- `web/src/utils/adminPermissions.ts` — fetch from `GET /v0/admin/me` on session init instead of reading localStorage

---

### 2.8 F-05: Username Enumeration via Login Prepare

| | |
|---|---|
| **Scope** | S |

- Backend auth handler — return consistent response shape from `/login/prepare` regardless of username existence
- Add small random delay (50-200ms) to prevent timing-based enumeration

---

## Phase 3 — MEDIUM (Next sprint)

### 3.1 Quick Fixes (< 1 hour each)

| ID | File | Change |
|----|------|--------|
| B-08 | `internal/http/api/front/handlers/api_keys.go:322` | Remove `.Debug()` call |
| B-09 | `internal/app/init.go:61` | Change default `sslMode` from `"disable"` to `"require"` |
| F-06 | `web/src/pages/admin/AuthFiles.tsx:1445` | Add `'noopener,noreferrer'` to `window.open` |
| F-09 | `web/vite.config.ts` | Add `build: { sourcemap: false }` |

### 3.2 B-10: Password Complexity

| | |
|---|---|
| **Scope** | S (~4 hours) |

- **Create** `internal/security/password_validator.go`:
  ```go
  func ValidatePassword(password string) error // min 8 chars, 1 letter, 1 digit
  ```
- **Call from:** `internal/app/init.go:355`, `internal/http/api/front/handlers/auth.go` (Register), `internal/http/api/admin/handlers/users.go` (CreateUser)
- **Create** `internal/security/password_validator_test.go` with table-driven tests
- **Frontend:** Update `web/src/pages/Register.tsx` validation to match (F-10)

### 3.3 B-11: Full API Key in List Response

| | |
|---|---|
| **Scope** | S (~2 hours) |

- `internal/http/api/front/handlers/api_keys.go:99-117` — remove `"key": row.APIKey` from `serializeAPIKey`. Keep `key_prefix`. Return full key only in Create/Regenerate responses.

### 3.4 B-12: Unbounded io.ReadAll

| | |
|---|---|
| **Scope** | S (~2 hours) |

Wrap with `io.LimitReader(c.Request.Body, 1<<20)` at:
- `internal/http/api/admin/handlers/mfa.go:667`
- `internal/http/api/front/handlers/mfa.go:665`
- `internal/http/api/admin/handlers/auth_files.go:206`

### 3.5 B-13: Unbounded MFA Session Stores

| | |
|---|---|
| **Scope** | M (~4 hours) |

- Add `maxSize` to `sessionStore` and `secretStore` in both `mfa.go` files (admin + front)
- Add periodic cleanup goroutine (every 5 min) to purge expired entries
- Cap at ~10,000 entries with LRU eviction

### 3.6 B-15: Security Headers

| | |
|---|---|
| **Scope** | S (~2 hours) |

Add to `internal/app/cors.go` middleware:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

### 3.7 F-07: Console Statements in Production

| | |
|---|---|
| **Scope** | S |

- `web/vite.config.ts` — add `esbuild: { drop: ['console'] }` for production builds
- Strips all 123 `console.*` calls across 32 files — zero manual edits needed

### 3.8 F-08: Open Redirect via releaseUrl

| | |
|---|---|
| **Scope** | S |

- `web/src/components/admin/VersionUpdateButton.tsx` — validate `releaseUrl` against allowed domain list (e.g., `github.com`) before `window.open`

---

## Phase 4 — LOW (Backlog)

| ID | File | Change | Depends On |
|----|------|--------|------------|
| B-14 | `internal/config/config.go:86` | Reduce `defaultJWTExpiry` from 30d to 24h | — |
| B-16 | `internal/http/api/admin/handlers/admins.go:287-342` | Require `old_password` unless super-admin | — |
| B-17 | `internal/http/api/admin/admin.go:29` | Move `/v0/version` behind admin auth middleware | — |
| F-04 | Frontend CSRF protection | Add SameSite cookie + CSRF token (double-submit pattern) | F-01 |
| F-10 | `web/src/pages/Register.tsx` | Align frontend password validation with B-10 | B-10 |
| F-11 | `web/src/pages/Init.tsx` | Show warning if loaded over HTTP | — |
| F-12 | Backend + frontend logout | Server-side token denylist using JTI claim (Redis) | B-07 |

---

## Dependency Graph

```
Phase 1 (do first, in order):
  B-04 ──────── independent, safest first
  B-01 ──────── independent
  B-02 ──────── touches jwt.go (PendingMFAClaims)

Phase 2 (after Phase 1):
  B-07 ──────── touches jwt.go (Issuer/JTI), do after B-02
    ├── F-01 (cookies) depends on B-07 + B-03
    ├── F-04 (CSRF) depends on F-01
    └── F-12 (server logout) depends on B-07 JTI
  B-05 ──────── independent
  B-03 ──────── independent, but F-01 depends on it
  B-06 ──────── independent

Phase 3-4: all independent except noted dependencies
  B-10 ──────── F-10 (frontend validation) should align
```

---

## Verification Strategy

| Phase | How to Verify |
|-------|---------------|
| **Phase 1** | Unit tests for each fix. Manual test: attempt B-01 attack (reset password without auth → must get 401), B-02 attack (TOTP without password → must get 401), B-04 (use expired key → must get 401). |
| **Phase 2** | Unit tests. Manual: CORS with disallowed origin → blocked. Rate limiting → 429 on 6th attempt. Old tokens rejected after B-07. |
| **Phase 3** | Unit tests for B-10 (password validation). Verify `.Debug()` removed. `curl -I` to check security headers present. Production build: no source maps, no console output. |
| **Phase 4** | Unit tests. Verify logout invalidates token server-side. |
| **All phases** | `go test ./...` after each phase. `npm audit` and `govulncheck ./...` at end. |

---

## Breaking Changes Requiring Communication

| Change | Impact | Mitigation |
|--------|--------|------------|
| B-01: `/reset-password` requires auth | Unauthenticated callers can no longer reset passwords | Document in changelog; deprecate in favor of `/profile/password` |
| B-02: MFA login flow changes | Clients calling `/login/totp` directly must use two-step flow | Document new flow; old endpoint returns 401 with descriptive error |
| B-07: All existing JWTs invalidated | Users and admins must re-login | Deploy during low-traffic window; communicate ahead of time |
| B-06: Default JWT secret rejected | Deployments using defaults will fail to start | Startup error message explains how to generate a secret |
| B-09: PostgreSQL SSL default changes | Local unencrypted connections need explicit `sslmode=disable` | Document in changelog |

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1 — Critical | 3-5 days | Week 1 |
| Phase 2 — High | 5-7 days | Week 2 |
| Phase 3 — Medium | 3-4 days | Week 3 |
| Phase 4 — Low | 2-3 days | Week 3-4 |
