# Kiro Provider Port Plan

## Context

This plan captures the read-only research on 9router's Kiro provider implementation and turns it into an implementation path for CLIProxyAPIBusiness (CPAB). It is intentionally scoped as a porting plan, not a patch. The goal is to add Kiro support to CPAB without copying 9router's Next.js/Undici/Web Streams behavior or treating Kiro as a generic OpenAI-compatible provider.

**Date:** 2026-05-18
**Source repo reviewed:** `/Users/iznogoud/Desktop/Projects-AI/Webplode/cpab-project/9router`
**Target repo:** `/Users/iznogoud/Desktop/Projects-AI/Webplode/cpab-project/cpab`

## Bottom Line

CPAB is not currently exposed to the exact 9router failure shown in the logs:

```text
[STREAM] KIRO | claude-opus-4.6-thinking-agentic | 22613ms | error: terminated
```

CPAB currently has no Kiro executor, no AWS CodeWhisperer/EventStream parser, and no Next.js/Undici/Web Streams pipe path. The same exact `terminated` failure is specific to 9router's Node streaming pipeline.

CPAB can still experience the same class of problem after Kiro is ported: a proxy, relay, or upstream service can close a long stream after the first response bytes are sent. Once CPAB commits SSE data to the client, it cannot transparently retry on another Kiro account without corrupting the response. The port must make retries happen before stream commit and make post-commit failures observable.

## 9router Kiro Logic Summary

9router's logs show this provider flow:

1. The client calls `/v1/responses`, `/v1/chat/completions`, or `/v1/messages`.
2. A combo alias such as `claude-opus-4-6` expands to three Kiro-routed models.
3. A route like `kr/claude-opus-4.6-thinking-agentic` maps to provider `kiro` and model `claude-opus-4.6-thinking-agentic`.
4. 9router selects one active Kiro account from the pool, using round-robin/sticky behavior.
5. 9router resolves a per-account proxy pool URL.
6. The request is translated from OpenAI Responses, OpenAI Chat, or Claude format into Kiro's `conversationState`.
7. The Kiro executor sends a request to Amazon CodeWhisperer `GenerateAssistantResponse`.
8. The upstream response is AWS binary EventStream, not text SSE.
9. 9router transforms AWS EventStream messages into OpenAI-style SSE chunks.
10. `Model ... succeeded` is logged when the streaming HTTP response is accepted, not when the body stream finishes.
11. `error: terminated` appears later when the Node/Undici body stream errors while Next.js is piping it to the client.

Important 9router implementation points:

- Kiro synthetic model suffixes are local behavior:
  - `-thinking`
  - `-agentic`
  - `-thinking-agentic`
- The upstream model is the base model after suffix stripping.
- `-thinking` injects Kiro thinking-mode instructions.
- `-agentic` injects an agentic system prompt intended to reduce Kiro timeout risk on large coding operations.
- Kiro auth is refresh-token driven. Once the refresh token is stored, 9router refreshes short-lived access tokens.
- Kiro model listing must refresh tokens on both `401` and `403`. The logs show `403 invalid bearer token` followed by successful refreshes, so CPAB should not copy a 401-only refresh path.

## Target Architecture

Kiro should be implemented in the local `CLIProxyAPI` SDK and surfaced through CPAB's existing admin, model mapping, billing, quota, and credential systems.

Do not port 9router's Next API routes or SQLite schema directly. CPAB is Go/Gin/GORM with the proxy engine delegated to `CLIProxyAPI`.

### Components To Add Or Extend

| Area | Target location | Notes |
|---|---|---|
| Provider executor | `CLIProxyAPI/internal/runtime/executor/` | Add a real Kiro executor, not OpenAI-compatible config. |
| Provider registration | `CLIProxyAPI/sdk/cliproxy/service.go` and related provider registry code | Register `kiro` as a first-class provider. |
| Auth metadata | `CLIProxyAPI/sdk/cliproxy/auth` and CPAB `internal/store/store.go` | Store refresh token, access token, expiry, region, profile ARN, client registration data. |
| Token refresh | `CLIProxyAPI/sdk/cliproxy/auth` | Refresh on expiry, `401`, and `403`; de-dupe in-flight refreshes. |
| EventStream parser | New package under `CLIProxyAPI/internal/runtime/executor/` or `CLIProxyAPI/internal/runtime/aws/eventstream` | Decode AWS binary EventStream safely. |
| Kiro translator | New package near existing request conversion/executor code | Convert OpenAI/Claude request shapes to Kiro conversation state. |
| Model catalog | `CLIProxyAPI` model registry plus CPAB `internal/modelregistry` integration | List Kiro models and expand synthetic variants. |
| Admin credential UI/API | CPAB admin handlers and `cpab-web` submodule | Backend first; frontend changes belong in the web repo/submodule workflow. |
| Model testing | CPAB admin endpoint | Self-call CPAB `/v1` proxy path using an internal token. |
| Billing and usage | CPAB `internal/billing`, `internal/usage`, model reference data | Ensure synthetic variants bill against the intended base model or explicit synthetic model pricing. |

## Data Model

Start with CPAB's existing auth-file style JSON metadata instead of adding a new table. This keeps the first port smaller and lets the SDK auth store persist provider-specific data through `internal/store/store.go`.

Recommended Kiro auth metadata shape:

```json
{
  "type": "kiro",
  "label": "Account 1",
  "email": "optional@example.com",
  "refresh_token": "...",
  "access_token": "...",
  "expires_at": "2026-05-18T12:00:00Z",
  "expires_in": 3600,
  "region": "us-east-1",
  "profile_arn": "...",
  "client_id": "...",
  "client_secret": "...",
  "auth_method": "builder_id",
  "start_url": "",
  "model_catalog_cached_at": "2026-05-18T12:00:00Z"
}
```

Notes:

- Accept refresh token as the minimum viable credential.
- Access token is derived state and may be absent at creation time.
- Persist rotated refresh tokens if AWS returns one.
- Use UTC timestamps.
- Keep proxy URL on the existing auth row `proxy_url`, not inside the Kiro JSON blob.

## Phase 0 - Reconfirm Boundaries

| | |
|---|---|
| Scope | S |
| Risk | Prevents building the wrong provider shape |

Tasks:

- Confirm no current CPAB `kiro` or `CodeWhisperer` implementation exists.
- Confirm the local `CLIProxyAPI` replacement remains the right place for provider executor work.
- Confirm whether any upstream Go implementation already exists in a sibling/private repo before hand-porting from 9router JS.
- Decide whether MVP supports only refresh-token import or also AWS Builder ID / IAM Identity Center device-code flow.
- Decide whether Kiro is enabled by default or hidden behind an admin feature flag.

Exit criteria:

- A short decision note exists in the implementation PR or issue.
- MVP credential path is chosen.

## Phase 1 - Kiro Auth And Token Refresh

| | |
|---|---|
| Scope | M |
| Risk | Token refresh races can invalidate accounts or create intermittent auth failures |

Tasks:

- Add typed helpers for reading Kiro auth metadata from `coreauth.Auth.Metadata`.
- Implement access-token freshness checks using `expires_at` or `expires_in`.
- Implement refresh-token exchange.
- Refresh on:
  - token near expiry
  - upstream `401`
  - upstream `403` with invalid bearer/token message
- De-dupe in-flight refreshes per auth ID so concurrent requests do not reuse the same refresh token at the same time.
- Persist refreshed access token and rotated refresh token through the existing auth store.
- Add structured logs that redact token values.

Tests:

- Missing refresh token is rejected.
- Expired access token triggers refresh.
- `401` triggers refresh and retry.
- `403 invalid bearer token` triggers refresh and retry.
- Concurrent refresh calls result in one refresh request.
- Refreshed credentials are persisted.

## Phase 2 - AWS EventStream Decoder

| | |
|---|---|
| Scope | M |
| Risk | Binary stream parsing errors can break all Kiro streaming |

Tasks:

- Implement a decoder for AWS EventStream frames.
- Validate message prelude length and message CRCs if feasible.
- Parse event headers into names and typed values.
- Extract payload JSON safely.
- Return clear errors for truncated frames, invalid CRCs, oversized frames, and unknown message shapes.
- Keep the decoder independent from Kiro request logic so it can be unit tested.

Tests:

- Decode a valid fixture with one assistant event.
- Decode multiple concatenated events.
- Reject truncated frame.
- Reject invalid length.
- Reject oversized frame.
- Handle unknown event types without panicking.

## Phase 3 - Kiro Request Translator

| | |
|---|---|
| Scope | L |
| Risk | Tool calls, images, and Responses API state can be lost if translation is incomplete |

Tasks:

- Implement synthetic model parsing:
  - base model
  - thinking flag
  - agentic flag
- Convert OpenAI Chat messages to Kiro conversation state.
- Convert OpenAI Responses requests to Kiro conversation state or route through existing normalized request structures if the SDK already provides one.
- Convert Claude messages and tools where CPAB's SDK supports Claude-compatible requests.
- Preserve:
  - system messages
  - user messages
  - assistant messages
  - tool calls
  - tool results
  - image inputs if supported
  - reasoning/thinking settings
- Add Kiro thinking-mode and agentic prompt injection behind synthetic suffix parsing.
- Keep prompt mutation explicit and tested.

Tests:

- Basic user prompt translates.
- System prompt translates.
- Tool call and tool result round-trip into Kiro shape.
- `claude-opus-4.6-thinking-agentic` strips to base upstream model and enables both flags.
- Unsupported inputs fail with a clear error instead of silently dropping content.

## Phase 4 - Kiro Executor

| | |
|---|---|
| Scope | L |
| Risk | This is the core runtime path |

Tasks:

- Add a Kiro provider executor that posts to CodeWhisperer `GenerateAssistantResponse`.
- Use the selected auth's access token.
- Use per-auth proxy transport from the existing RoundTripper provider.
- Attach request context cancellation to the upstream request.
- Set Kiro/AWS headers required by the endpoint.
- Stream AWS EventStream through the decoder.
- Convert Kiro events to the SDK's streaming result type.
- Emit reasoning content, assistant text, code, tool-use events, message-stop events, and usage events where supported.
- Implement non-streaming requests by aggregating the stream only if CPAB needs non-streaming Kiro support.
- Ensure no response bytes are committed to the client until the first valid upstream event is decoded.

Retry rules:

- Retry another auth/model only before first client-visible payload.
- Do not retry after SSE data has been written.
- Mark auth/model cooldowns on auth failure, quota errors, unsupported model errors, and repeated stream bootstrap failures.

Tests:

- Successful stream emits expected chunks.
- Upstream `401` refreshes and retries once.
- Upstream `403 invalid bearer token` refreshes and retries once.
- Upstream closes before first event, so fallback can happen.
- Upstream closes after first event, so the stream returns a terminal error without hidden fallback.
- Proxy transport is used when auth row has `proxy_url`.

## Phase 5 - Model Catalog And Synthetic Variants

| | |
|---|---|
| Scope | M |
| Risk | Bad catalog behavior leads to invalid model mappings and broken billing |

Tasks:

- Implement Kiro model listing using the Kiro/Amazon Q model list endpoint.
- Refresh token on `401` and `403`.
- Cache model list per auth for a short TTL.
- Expand each supported upstream model into:
  - base model
  - `-thinking`
  - `-agentic`
  - `-thinking-agentic`
- Store upstream/base model ID on synthetic variants.
- Expose capabilities in a shape CPAB's model registry can consume.
- Add billing metadata or clear mapping rules for synthetic variants.

Tests:

- Live-list parser handles normal payload.
- Empty model list falls back to static catalog only when explicitly allowed.
- `403 invalid bearer token` refreshes and retries.
- Synthetic expansion produces stable IDs and keeps upstream base ID.

## Phase 6 - CPAB Admin Integration

| | |
|---|---|
| Scope | L |
| Risk | Admin UX can expose secrets or create invalid credentials |

Backend tasks:

- Allow auth rows with `type = "kiro"`.
- Add admin endpoint for Kiro refresh-token import.
- Add optional admin endpoint for Kiro device-code auth if MVP includes it.
- Redact refresh token and access token in all list/detail responses.
- Add provider validation endpoint for Kiro credentials.
- Add model-list endpoint that can fetch and cache live Kiro models.
- Add RBAC permission checks consistent with existing auth-file/provider-key routes.

Frontend tasks:

- Implement in the `cpab-web` submodule/repo, not as an accidental edit to embedded build output.
- Add Kiro credential form:
  - refresh token paste/import
  - label
  - region
  - optional profile ARN
  - optional proxy selection
- Show token status without revealing token values.
- Add model-list and model-test actions.

Tests:

- Admin can create Kiro auth with refresh token.
- Admin list response redacts secrets.
- Invalid refresh token produces a useful validation error.
- Permission checks reject unauthorized admin users.

## Phase 7 - Model Routing, Billing, And Quotas

| | |
|---|---|
| Scope | M |
| Risk | Requests can route but billing/quotas may be wrong |

Tasks:

- Register Kiro as a provider in CPAB's model mapping flow.
- Ensure selectors work with Kiro auth rows:
  - round-robin
  - fill-first
  - sticky
- Ensure Kiro auth rows can belong to auth groups and user groups.
- Add default billing reference entries or document that admins must configure them.
- Decide whether synthetic variants inherit base-model pricing or get explicit multipliers.
- Ensure usage records capture:
  - requested model alias
  - upstream base model
  - auth index/account
  - input tokens
  - output tokens
  - reasoning tokens if available

Tests:

- A model mapping can route `kr/...` or `kiro/...` to Kiro.
- User group restrictions apply.
- Billing rejects requests without balance.
- Usage records include selected auth and model.

## Phase 8 - Model Testing And Health

| | |
|---|---|
| Scope | M |
| Risk | Without health checks, broken Kiro accounts will be discovered only by users |

Tasks:

- Add admin endpoint to test one Kiro model.
- Add admin endpoint to batch-test all models for a Kiro auth.
- Use CPAB's own `/v1/chat/completions` proxy path for model tests.
- Use an internal service token or direct internal service call; do not bypass business auth accidentally.
- Warm up the first model before parallel tests to avoid token refresh races.
- Apply a short timeout, for example 15 seconds for batch tests.
- Report:
  - ok
  - latency
  - HTTP/status error
  - auth refresh needed
  - proxy used
  - selected account
- Optionally write health state to auth/model cooldown metadata.

Tests:

- Successful model test returns ok and latency.
- Auth failure returns redacted error.
- Timeout returns clear error.
- Batch test does not trigger parallel refresh storm.

## Phase 9 - Stream Resilience And Observability

| | |
|---|---|
| Scope | M |
| Risk | Kiro streams are long-running and proxy-sensitive |

Tasks:

- Add provider-specific stream logs:
  - provider
  - model
  - auth label or redacted ID
  - proxy mode
  - bootstrap latency
  - total duration
  - terminal status
- Add first-event bootstrap timeout distinct from full stream timeout.
- Add optional SSE keepalive comments if safe for clients.
- Record post-commit stream errors in usage/logging even when the client has already received partial output.
- Distinguish:
  - client disconnect
  - upstream EOF
  - proxy connection reset
  - auth failure
  - invalid EventStream frame
  - Kiro service error event

Tests:

- Client cancellation cancels upstream request.
- Upstream EOF before first event can retry/fallback.
- Upstream EOF after first event logs terminal stream error.
- Keepalive setting does not break OpenAI-compatible clients.

## Phase 10 - Documentation And Operational Guardrails

| | |
|---|---|
| Scope | S |
| Risk | Operators may misconfigure an unofficial provider path |

Tasks:

- Document Kiro credential setup.
- Document refresh-token import and token redaction.
- Document proxy recommendations.
- Document why Kiro cannot be configured as OpenAI-compatible.
- Document known limitations:
  - uses unofficial/private Kiro/CodeWhisperer behavior
  - model availability is account-dependent
  - post-commit stream failures cannot be retried transparently
- Add troubleshooting entries for:
  - `401`
  - `403 invalid bearer token`
  - stream closes mid-output
  - model not available
  - proxy connect failure

## Suggested Beads Breakdown

Use these as issue seeds if the work is split into Beads:

| ID seed | Title | Type | Priority | Depends on |
|---|---|---|---|---|
| KIRO-01 | Add Kiro auth metadata and refresh-token flow | feature | P1 | none |
| KIRO-02 | Add AWS EventStream decoder tests | feature | P1 | none |
| KIRO-03 | Add Kiro request translator | feature | P1 | KIRO-02 |
| KIRO-04 | Add Kiro streaming executor | feature | P1 | KIRO-01, KIRO-02, KIRO-03 |
| KIRO-05 | Add Kiro model catalog and synthetic variants | feature | P1 | KIRO-01 |
| KIRO-06 | Wire Kiro into CPAB admin auth flows | feature | P2 | KIRO-01 |
| KIRO-07 | Add Kiro model testing endpoint | feature | P2 | KIRO-04, KIRO-05 |
| KIRO-08 | Add billing, usage, and quota support for Kiro | feature | P1 | KIRO-04, KIRO-05 |
| KIRO-09 | Add Kiro docs and troubleshooting | docs | P2 | KIRO-06, KIRO-07 |

## Verification Strategy

Run targeted checks after each phase and full checks before handoff.

Backend:

```bash
go test ./...
go vet ./...
go build ./...
```

Frontend, only if `web/` changes are made in the proper frontend repo/submodule workflow:

```bash
cd web && npm run build
cd web && npm run lint
```

Full build:

```bash
make build
```

Before any commit:

```bash
ubs <changed-files>
git status
br sync --flush-only
```

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Kiro/CodeWhisperer endpoints are not stable public APIs | Provider may break without notice | Hide behind explicit provider setup, document limitation, keep code isolated. |
| Refresh-token races | Accounts can fail intermittently or rotate tokens unexpectedly | Per-auth in-flight refresh de-dupe, persist refreshed state immediately. |
| `403 invalid bearer token` is missed | Model listing and requests fail despite valid refresh token | Refresh on both `401` and token-related `403`. |
| Treating Kiro as OpenAI-compatible | Binary AWS EventStream is misparsed | Add first-class Kiro executor. |
| Proxy closes stream mid-output | User sees partial/terminated response | Retry only before first payload; log terminal status; add health/cooldown. |
| Synthetic model variants break billing | Wrong cost or quota enforcement | Store upstream base model and define billing inheritance. |
| Secret leakage in admin UI/logs | Token compromise | Redact token fields everywhere; avoid logging request bodies. |

## Out Of Scope For MVP

- Auto-import from `~/.aws/sso/cache` on the server. This is useful for local/self-hosted deployments but risky on hosted CPAB instances.
- Social login flows unless explicitly approved.
- Copying 9router's full combo UI. CPAB already has model mappings and selectors.
- Retrying after bytes have already been sent to the client.
- Mutating user prompts with RTK/token reduction by default.

## Definition Of Done

Kiro support is done when:

- An admin can add a Kiro auth using a refresh token.
- CPAB refreshes Kiro access tokens automatically.
- CPAB can list Kiro models and synthetic variants.
- CPAB can route a streaming chat request through Kiro.
- Kiro usage is recorded and billable.
- Kiro model tests work from the admin API.
- Stream failures are logged with enough detail to distinguish auth, proxy, upstream, and client-cancel causes.
- Existing providers and routes continue to pass the full backend test/build suite.
