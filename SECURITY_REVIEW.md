# Security Review Report — CLIProxyAPIBusiness

**Date:** 2026-03-15
**Scope:** Full backend (`internal/`) and frontend (`web/`) codebase
**Overall Risk Level:** HIGH

---

## Summary

| Severity | Backend | Frontend | Total |
|----------|---------|----------|-------|
| Critical | 2 | 1 | **3** |
| High | 5 | 4 | **9** |
| Medium | 6 | 4 | **10** |
| Low | 4 | 3 | **7** |
| **Total** | **17** | **12** | **29** |

---

## Immediate Action Items

| Priority | Finding | Area |
|----------|---------|------|
| Now | Unauthenticated password reset → account takeover | Backend |
| Now | TOTP/Passkey login bypasses password verification | Backend |
| Now | Expired API keys still accepted | Backend |
| Now | Weak/default JWT secret — no startup validation | Backend |
| This week | Wildcard CORS allows any origin | Backend |
| This week | No rate limiting on login endpoints | Backend |
| This week | JWT tokens stored in localStorage (XSS risk) | Frontend |
| This week | No server-side route guards | Frontend |
| This week | Admin permissions sourced from localStorage | Frontend |

---

## Backend Findings (`internal/`)

---

### B-01 — Unauthenticated Password Reset (Account Takeover)

**Severity:** CRITICAL
**Category:** OWASP A07 — Identification and Authentication Failures
**Location:** `internal/http/api/front/handlers/auth.go:150-189`
**Exploitability:** Remote, unauthenticated

**Description:**
`POST /v0/front/reset-password` allows any unauthenticated caller to set a new password for any user account by supplying only the username and email. There is no email verification token, no time-limited link, no CAPTCHA, and no rate limiting. An attacker who knows (or scrapes) a username and email can immediately and silently take over any account.

**Attack Scenario:**
1. Attacker enumerates valid usernames via the login endpoint response differences.
2. Attacker obtains email via public records, OSINT, or a prior data breach.
3. Attacker calls `POST /v0/front/reset-password` with `{ username, email, new_password }`.
4. User's password is changed. Attacker logs in with the new credentials.

**Recommended Fix:**
Implement a two-step verified reset flow:
1. `POST /reset-password/request` — validate username + email, generate a signed short-lived token (e.g. 15-minute JWT or HMAC), send it to the user's email.
2. `POST /reset-password/confirm` — validate the token, then allow setting the new password.

---

### B-02 — TOTP / Passkey Login Bypasses Password Verification

**Severity:** CRITICAL
**Category:** OWASP A07 — Identification and Authentication Failures
**Locations:**
- `internal/http/api/admin/handlers/mfa.go:544-578` (admin LoginTOTP)
- `internal/http/api/front/handlers/mfa.go:542-576` (user LoginTOTP)
- `internal/http/api/admin/handlers/mfa.go:632-712` (admin LoginPasskeyVerify)
- `internal/http/api/front/handlers/mfa.go:630-710` (user LoginPasskeyVerify)

**Description:**
The `LoginTOTP` endpoint accepts only a username and a 6-digit TOTP code to issue a full JWT — no password is ever validated. MFA replaces password authentication rather than supplementing it. TOTP has only 1,000,000 possible values; without rate limiting this is brute-forceable. Similarly, `LoginPasskeyVerify` issues a JWT based solely on the passkey assertion without requiring the password.

**Attack Scenario:**
1. Attacker knows a valid admin username (e.g. `admin`).
2. Attacker calls `POST /v0/admin/login/totp` with the username and brute-forces all 1,000,000 TOTP codes (no rate limiting exists on this endpoint).
3. On success, a full admin JWT is issued without ever knowing the password.

**Recommended Fix:**
Implement a two-step login flow:
1. `POST /login` — validate username + password; if MFA is enabled, return a short-lived (e.g. 5-minute) "pending MFA" token instead of a full JWT.
2. `POST /login/totp` or `/login/passkey/verify` — validate the pending MFA token, then validate the TOTP/passkey, then issue the full JWT.

---

### B-03 — Wildcard CORS Policy

**Severity:** HIGH
**Category:** OWASP A05 — Security Misconfiguration
**Location:** `internal/app/cors.go:12`
**Exploitability:** Remote, unauthenticated (victim must visit attacker-controlled page)

**Description:**
The CORS middleware unconditionally sets `Access-Control-Allow-Origin: *` with `Authorization` in `Access-Control-Allow-Headers`. This permits any origin to make cross-origin requests carrying JWT tokens to all admin and user management endpoints.

**Recommended Fix:**
```go
allowedOrigins := []string{"https://your-admin-domain.com"}
origin := c.GetHeader("Origin")
if slices.Contains(allowedOrigins, origin) {
    c.Header("Access-Control-Allow-Origin", origin)
    c.Header("Vary", "Origin")
}
```

---

### B-04 — Expired API Keys Still Accepted

**Severity:** HIGH
**Category:** OWASP A01 — Broken Access Control
**Location:** `internal/access/db_api_key_provider.go:82-85`
**Exploitability:** Remote, authenticated with an expired key

**Description:**
The `DBAPIKeyProvider.Authenticate` method queries for API keys using `WHERE api_key = ? AND active = ? AND revoked_at IS NULL` but does not filter on `expires_at`. Expired API keys remain fully functional for LLM proxy access indefinitely.

**Recommended Fix:**
```go
// Add expires_at check to the DB query
Where("api_key = ? AND active = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    token, true, time.Now().UTC())
```

---

### B-05 — No Rate Limiting on Login / Authentication Endpoints

**Severity:** HIGH
**Category:** OWASP A07 — Identification and Authentication Failures
**Locations:**
- `internal/http/api/admin/admin.go:39-43` (admin login routes)
- `internal/http/api/front/front.go:25-31` (front login / register / reset routes)
**Exploitability:** Remote, unauthenticated

**Description:**
All authentication endpoints (`/login`, `/login/totp`, `/login/passkey/*`, `/register`, `/reset-password`) are registered outside any rate-limiting middleware. The existing `Selector` rate limiter only applies to LLM proxy paths (`/v1`, `/v1beta`, `/api`). This enables unbounded brute-force attacks against passwords, TOTP codes, and the password reset endpoint.

**Recommended Fix:**
Apply a per-IP sliding-window rate limiter to all unauthenticated endpoints: e.g. max 5 attempts per minute per IP with exponential backoff after 10 failures. Consider also per-username lockout after repeated failures.

---

### B-06 — Insecure Default JWT Secret and Database Credentials

**Severity:** HIGH
**Category:** OWASP A02 — Cryptographic Failures
**Locations:**
- `docker-compose.yml:8,28-29`
- `internal/app/init.go:192`
**Exploitability:** Remote (if deployed with defaults)

**Description:**
The docker-compose file ships with weak default credentials used when environment variables are not overridden:
- `POSTGRES_PASSWORD: insecure-change-me`
- `JWT_SECRET: insecure-jwt-secret-change-me`

`init.go` also has a hardcoded fallback JWT secret: `"change-me-to-a-secure-random-string"`. The JWT secret allows an attacker to forge arbitrary admin and user tokens, granting full control of the system.

**Recommended Fix:**
- Remove all default values for secrets from docker-compose.
- Add a startup validation that refuses to boot if `JWT_SECRET` is empty or matches any known-weak value:

```go
knownWeakSecrets := []string{"change-me-to-a-secure-random-string", "insecure-jwt-secret-change-me", ""}
if slices.Contains(knownWeakSecrets, cfg.JWT.Secret) {
    log.Fatal("JWT_SECRET must be set to a strong random value (min 32 chars)")
}
```

---

### B-07 — JWT Tokens Not Namespaced (Admin vs User Confusion)

**Severity:** HIGH
**Category:** OWASP A01 — Broken Access Control
**Location:** `internal/security/jwt.go:35-48,73-85`
**Exploitability:** Remote, authenticated

**Description:**
Both `GenerateToken` (user) and `GenerateAdminToken` (admin) use the same `JWT_SECRET` and `jwt.SigningMethodHS256` with no `Issuer`, `Audience`, or `Subject` claim to differentiate them. While middleware parses into separate claims structs, there is no cryptographic or claim-level enforcement preventing a user token from being accepted in an admin context if parsing logic is ever loosened.

**Recommended Fix:**
Add issuer claims to differentiate token namespaces and validate them in each parser:

```go
RegisteredClaims: jwt.RegisteredClaims{
    Issuer:    "cpab:admin", // or "cpab:user"
    IssuedAt:  jwt.NewNumericDate(now),
    ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
}
```

---

### B-08 — GORM Debug Mode Leaks SQL with API Key Values to Logs

**Severity:** MEDIUM
**Category:** OWASP A09 — Security Logging and Monitoring Failures
**Location:** `internal/http/api/front/handlers/api_keys.go:322`

**Description:**
`h.db.Debug()` is used in the production `Revoke` handler, causing GORM to log complete SQL queries — including the raw API key values — to stdout/log files. Any log aggregation system or person with log access obtains user API keys in plaintext.

**Recommended Fix:**
Remove the `.Debug()` call:
```go
// Remove Debug() in production handlers
res := h.db.WithContext(c.Request.Context()).Model(&models.APIKey{})
```

---

### B-09 — PostgreSQL SSL Disabled by Default

**Severity:** MEDIUM
**Category:** OWASP A02 — Cryptographic Failures
**Location:** `internal/app/init.go:62`, `docker-compose.yml`

**Description:**
`BuildDSN` defaults `sslmode` to `"disable"` when not explicitly set, and the docker-compose connection string also uses `sslmode=disable`. Database credentials and all query data are transmitted in plaintext over the network, vulnerable to interception.

**Recommended Fix:**
Change the default to `"require"` and only allow `"disable"` when explicitly set by an operator:
```go
if sslMode == "" {
    sslMode = "require"
}
```

---

### B-10 — No Password Complexity Enforcement

**Severity:** MEDIUM
**Category:** OWASP A07 — Identification and Authentication Failures
**Locations:**
- `internal/app/init.go:355` (only 6-char minimum for initial admin)
- `internal/http/api/front/handlers/auth.go:35-92` (no minimum for user registration)
- `internal/http/api/admin/handlers/users.go:36-80` (no minimum for admin-created users)

**Description:**
User registration and admin-created users accept any non-empty password. The initial setup wizard only enforces a 6-character minimum, which is too weak for a business-grade LLM gateway.

**Recommended Fix:**
Enforce minimum 8-character passwords with at least one letter and one digit across all password-setting endpoints. Add a shared `ValidatePassword(p string) error` utility.

---

### B-11 — Full API Key Returned in List Response

**Severity:** MEDIUM
**Category:** OWASP A01 — Broken Access Control
**Location:** `internal/http/api/front/handlers/api_keys.go:107`

**Description:**
The `serializeAPIKey` function returns the full `key` field (the complete API key) alongside `key_prefix` in list responses. API keys should only be revealed once at creation time. Returning them repeatedly in list responses exposes them to XSS attacks, browser extensions, and log leakage.

**Recommended Fix:**
Return only `key_prefix` in list responses. Return the full key only at creation time with an explicit warning that it won't be shown again.

---

### B-12 — Unbounded `io.ReadAll` on Request Bodies (DoS Risk)

**Severity:** MEDIUM
**Category:** OWASP A05 — Security Misconfiguration
**Locations:**
- `internal/http/api/admin/handlers/mfa.go:667`
- `internal/http/api/front/handlers/mfa.go:665`
- `internal/http/api/admin/handlers/auth_files.go:206`

**Description:**
`io.ReadAll(c.Request.Body)` is called without a size limit. An attacker can send a very large request body to exhaust server memory and cause a denial of service.

**Recommended Fix:**
```go
const maxBodySize = 1 << 20 // 1 MB
rawBody, err := io.ReadAll(io.LimitReader(c.Request.Body, maxBodySize))
```

---

### B-13 — Unbounded In-Memory MFA Session Stores (DoS Risk)

**Severity:** MEDIUM
**Category:** OWASP A04 — Insecure Design
**Locations:**
- `internal/http/api/admin/handlers/mfa.go:142-149`
- `internal/http/api/front/handlers/mfa.go:140-148`

**Description:**
`passkeyLoginSessions`, `passkeyRegistrationSessions`, and `totpPendingSecrets` are unbounded in-memory maps. Expired entries are only cleaned up lazily on access. An attacker can trigger thousands of passkey login sessions with different usernames, consuming memory without bound.

**Recommended Fix:**
Cap the stores with a maximum size and LRU eviction, or run a periodic cleanup goroutine that evicts entries older than the session TTL.

---

### B-14 — JWT Default Expiry of 30 Days is Excessive

**Severity:** LOW
**Category:** OWASP A07 — Identification and Authentication Failures
**Location:** `internal/config/config.go:86`

**Description:**
`defaultJWTExpiry = 30 * 24 * time.Hour` (720 hours). A stolen JWT remains valid for a full month. No token revocation mechanism exists beyond disabling the admin/user record in the database.

**Recommended Fix:**
Reduce the default expiry to 24 hours. Implement refresh tokens for long-lived sessions.

---

### B-15 — No HTTP Security Headers on Responses

**Severity:** LOW
**Category:** OWASP A05 — Security Misconfiguration
**Location:** `internal/app/cors.go`

**Description:**
No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `Referrer-Policy` headers are set. The embedded web UI is served without these browser-level protections.

**Recommended Fix:**
Add a middleware that sets security headers on all responses:
```go
c.Header("X-Content-Type-Options", "nosniff")
c.Header("X-Frame-Options", "DENY")
c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
c.Header("Content-Security-Policy", "default-src 'self'")
c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
```

---

### B-16 — Admin Can Set Another Admin's Password Without Knowing Current Password

**Severity:** LOW
**Category:** OWASP A01 — Broken Access Control
**Location:** `internal/http/api/admin/handlers/admins.go:287-342`

**Description:**
`PUT /v0/admin/admins/:id/password` accepts a `password` field that directly sets a new password without requiring the current password. Any admin with permission to this endpoint can take over other admin accounts.

**Recommended Fix:**
Require `old_password` verification unless the caller is a super-admin, and audit-log all admin password change events.

---

### B-17 — Version Endpoint Exposed Without Authentication

**Severity:** LOW
**Category:** OWASP A05 — Security Misconfiguration
**Location:** `internal/http/api/admin/admin.go:29`

**Description:**
`GET /v0/version` is registered without any authentication middleware, exposing the application version, commit hash, and build date to unauthenticated callers. This aids attackers in identifying the exact version to look up known vulnerabilities.

**Recommended Fix:**
Move the version endpoint behind the admin JWT middleware, or return only a minimal response (e.g. `{"status":"ok"}`) to unauthenticated callers.

---

## Frontend Findings (`web/`)

---

### F-01 — JWT Tokens Stored in localStorage (XSS Account Takeover)

**Severity:** CRITICAL
**Category:** OWASP A02 — Cryptographic Failures / A03 — Injection
**Locations:** `web/src/api/config.ts:8-11`, `web/src/pages/Login.tsx:189`
**Exploitability:** Any XSS vulnerability → full account takeover

**Description:**
Both admin and user JWT tokens are stored in `localStorage`. Any JavaScript executing in the page context (XSS, malicious browser extension, compromised dependency) can read `localStorage` and steal the tokens, immediately gaining full authenticated access as the victim.

**Recommended Fix:**
Store JWT tokens exclusively in `httpOnly; Secure; SameSite=Strict` cookies. The backend must set the cookie on login and clear it on logout. The frontend never touches the token directly.

---

### F-02 — No Server-Side Route Guards (Frontend-Only Auth)

**Severity:** HIGH
**Category:** OWASP A01 — Broken Access Control
**Location:** `web/src/App.tsx:37-73`

**Description:**
All protected routes (admin dashboard, user management, billing, etc.) rely solely on client-side checks. If a user navigates directly to `/admin/dashboard` with a valid token, the page renders with full data — but the route guard itself can be bypassed by manipulating client state. There is no backend enforcement that prevents the API calls from being made with a tampered context.

**Recommended Fix:**
Implement a `ProtectedRoute` component that validates the token with the backend on every navigation. Combine with backend JWT middleware enforcement (already present, but ensure the frontend never renders sensitive data before auth is confirmed).

---

### F-03 — Admin Permissions Sourced from localStorage (Client-Side Privilege Escalation)

**Severity:** HIGH
**Category:** OWASP A01 — Broken Access Control
**Location:** `web/src/utils/adminPermissions.ts:8-27`

**Description:**
Admin permission flags (including `is_super_admin`) are read directly from `localStorage`. Any authenticated admin can open DevTools, set `is_super_admin: true` in `localStorage`, and the UI will render all super-admin features and make super-admin API calls.

**Attack Scenario:**
1. Non-super-admin logs in.
2. Opens DevTools → Application → localStorage.
3. Sets `adminInfo.is_super_admin = true`.
4. Page refresh: all super-admin UI elements appear and API calls are made as super-admin.

**Recommended Fix:**
Fetch permissions from the backend on each session initialization (`GET /v0/admin/me`). Never derive authorization decisions from client-stored state.

---

### F-04 — No CSRF Protection on State-Changing Endpoints

**Severity:** HIGH
**Category:** OWASP A01 — Broken Access Control
**Location:** `web/src/api/config.ts`

**Description:**
All state-changing requests use `Authorization: Bearer <token>` from localStorage. While bearer tokens mitigate traditional cookie-based CSRF, if tokens are migrated to cookies (the recommended fix for F-01), CSRF becomes an active threat without a CSRF token or `SameSite` cookie attribute.

**Recommended Fix:**
When migrating to httpOnly cookies, set `SameSite=Strict` on the session cookie and implement a CSRF token (double-submit cookie pattern) for all state-changing requests.

---

### F-05 — Username Enumeration via Login Prepare Endpoint

**Severity:** HIGH
**Category:** OWASP A07 — Identification and Authentication Failures
**Location:** `web/src/pages/Login.tsx:116-136`

**Description:**
The `/login/prepare` endpoint returns different responses depending on whether the username exists (e.g. whether MFA is enabled, which auth method to use). This allows attackers to enumerate valid usernames by observing response differences.

**Recommended Fix:**
Return a consistent response shape regardless of whether the username exists. Introduce a small, randomized delay to prevent timing-based enumeration.

---

### F-06 — `window.open()` Without `noopener,noreferrer`

**Severity:** MEDIUM
**Category:** OWASP A05 — Security Misconfiguration
**Location:** Multiple components using `window.open(url)`

**Description:**
`window.open()` calls throughout the frontend do not use the `noopener,noreferrer` flags. The opened page can access the opener via `window.opener` and redirect it to a phishing page (reverse tabnapping).

**Recommended Fix:**
```javascript
window.open(url, '_blank', 'noopener,noreferrer')
```

---

### F-07 — 90+ `console.error` Calls in Production Build

**Severity:** MEDIUM
**Category:** OWASP A09 — Security Logging and Monitoring Failures
**Location:** Throughout `web/src/`

**Description:**
Extensive `console.error` calls log internal error details, API response structures, and stack traces to the browser console. This aids attackers who have XSS or physical access in understanding the system's internal behavior.

**Recommended Fix:**
Strip `console.*` calls from production builds using a bundler plugin (e.g. `vite-plugin-remove-console` or esbuild `drop: ['console']`).

---

### F-08 — Open Redirect via Server-Controlled `releaseUrl`

**Severity:** MEDIUM
**Category:** OWASP A01 — Broken Access Control
**Location:** Components consuming `releaseUrl` from API response

**Description:**
If the server response includes a `releaseUrl` field that is used in a redirect or `window.open()` call without validation, a compromised backend or MITM attacker can redirect users to arbitrary external URLs.

**Recommended Fix:**
Validate that `releaseUrl` matches an expected domain allowlist before using it for navigation.

---

### F-09 — Source Maps Not Explicitly Disabled in Production

**Severity:** MEDIUM
**Category:** OWASP A05 — Security Misconfiguration
**Location:** `web/vite.config.ts` (or equivalent bundler config)

**Description:**
If source maps are generated and served in production, attackers can access the full original TypeScript/JavaScript source, making reverse engineering significantly easier.

**Recommended Fix:**
Explicitly disable source map generation for production builds:
```typescript
// vite.config.ts
build: {
  sourcemap: false
}
```

---

### F-10 — Minimum Password Length of 6 Characters

**Severity:** LOW
**Category:** OWASP A07 — Identification and Authentication Failures
**Location:** `web/src/pages/Register.tsx` (or equivalent form validation)

**Description:**
Client-side validation enforces only a 6-character minimum password. This is consistent with the backend init wizard but is too weak. (Also see B-10.)

**Recommended Fix:**
Enforce a minimum of 8 characters with complexity requirements, consistently across frontend and backend.

---

### F-11 — Init Page May Send Credentials Over HTTP

**Severity:** LOW
**Category:** OWASP A02 — Cryptographic Failures
**Location:** `web/src/pages/Init.tsx`

**Description:**
During the initialization wizard, admin credentials (database DSN, admin password) are submitted to the backend. If TLS is not enforced at the deployment level, these credentials transit in plaintext.

**Recommended Fix:**
Document that TLS must be terminated before the app during initial setup. Consider displaying a warning in the UI if the page is loaded over HTTP.

---

### F-12 — Client-Only Logout (No Server-Side Token Invalidation)

**Severity:** LOW
**Category:** OWASP A07 — Identification and Authentication Failures
**Location:** `web/src/utils/auth.ts` (logout handler)

**Description:**
Logout only clears `localStorage` on the client. The JWT remains valid on the backend until it expires (up to 30 days — see B-14). A stolen token remains usable after the legitimate user logs out.

**Recommended Fix:**
Implement a server-side token denylist (e.g. in Redis) that is checked on every authenticated request. Add a `POST /logout` endpoint that adds the token's `jti` claim to the denylist.

---

## Dependency Audit

### Backend (`go`)

Run `govulncheck` to check for known Go CVEs:
```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

### Frontend (`npm`)

```
npm audit
```

Known transitive findings at time of review:
| Package | Severity | Notes |
|---------|----------|-------|
| `flatted` | HIGH | Transitive/dev dependency |
| `minimatch` | HIGH | Transitive/dev dependency |
| `ajv` | MODERATE | Transitive/dev dependency |

All three are dev/build-time dependencies and do not affect the production bundle. Monitor for updates.

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No hardcoded secrets | FAIL | docker-compose defaults; init.go fallback |
| All inputs validated | PARTIAL | Missing password complexity; unbounded io.ReadAll |
| SQL injection prevention | PASS | GORM parameterized queries throughout |
| Authentication enforced | FAIL | Password reset without verification; TOTP bypasses password |
| Authorization enforced | FAIL | Expired API keys accepted; localStorage permissions |
| CORS properly configured | FAIL | Wildcard `*` origin |
| Security headers set | FAIL | No CSP, HSTS, X-Frame-Options |
| Secrets not logged | FAIL | db.Debug() leaks API keys in SQL logs |
| Rate limiting on auth | FAIL | No rate limiting on login endpoints |
| Tokens stored securely | FAIL | JWT in localStorage |
| TLS enforced | N/A | Deployment responsibility |
| Dependencies audited | PARTIAL | npm has 3 dev-only findings; Go not yet scanned |
