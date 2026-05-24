# Codex Goal: Port Kiro Provider Support To CPAB

## Objective

Add first-class Kiro provider support to CLIProxyAPIBusiness by porting the useful parts of 9router's Kiro implementation into CPAB's Go/Gin/GORM architecture and local `CLIProxyAPI` SDK, while avoiding 9router's Next.js/Undici/Web Streams failure mode.

The end state is that an admin can add a Kiro account using a refresh token, CPAB can refresh Kiro access tokens, list Kiro models, route streaming requests through Kiro, test models, record usage, and bill requests safely.

## Context

Research source:

- 9router repo: `/Users/iznogoud/Desktop/Projects-AI/Webplode/cpab-project/9router`
- CPAB repo: `/Users/iznogoud/Desktop/Projects-AI/Webplode/cpab-project/cpab`
- Detailed plan: `docs/plans/kiro-provider-port-plan.md`

Key findings:

- 9router's `error: terminated` happens after the initial streaming response succeeds, while Node/Undici/Next is piping the stream body.
- CPAB does not currently have Kiro support, so it is not exposed to the exact same failure today.
- Kiro must not be configured as generic OpenAI-compatible. Kiro uses AWS binary EventStream and needs a real executor.
- Kiro auth is refresh-token driven. Once the refresh token is present, access token refresh can be automated.
- Refresh should happen on expiry, `401`, and token-related `403`.
- Synthetic Kiro models such as `claude-opus-4.6-thinking-agentic` are local aliases that strip to a base upstream model and enable thinking/agentic behavior.

## Non-Negotiable Constraints

- Do not delete files.
- Do not run destructive git or filesystem commands.
- Do not use script-based code transformations.
- Do not copy 9router's Next.js API route structure into CPAB.
- Do not treat Kiro as OpenAI-compatible.
- Preserve existing CPAB behavior for OpenAI-compatible, Claude, Gemini, Codex, model mappings, billing, and quotas.
- Keep secrets redacted in logs, admin API responses, and frontend UI.
- Frontend changes belong in the `cpab-web` submodule/repo workflow, not in generated embedded assets.
- Support PostgreSQL and SQLite for any CPAB schema changes.

## Success Criteria

Kiro provider support is complete when all of these are true:

- Admin can create a Kiro credential with at least a refresh token, label, region, and optional proxy.
- CPAB stores Kiro metadata through the existing auth store or a justified migration.
- CPAB automatically refreshes Kiro access tokens and persists refreshed state.
- Refresh de-duping prevents concurrent refresh storms for the same account.
- CPAB lists Kiro models and expands synthetic variants:
  - base
  - `-thinking`
  - `-agentic`
  - `-thinking-agentic`
- CPAB routes streaming requests through a first-class Kiro executor.
- The Kiro executor decodes AWS EventStream and emits CPAB SDK stream chunks.
- CPAB retries/falls back only before the first client-visible stream payload.
- CPAB records Kiro usage with selected auth, requested model, upstream base model, input tokens, output tokens, and available reasoning usage.
- Billing and user group restrictions apply to Kiro requests.
- Admin model test endpoints can test one Kiro model and batch-test Kiro models.
- Errors distinguish auth failure, invalid bearer token, model unavailable, proxy failure, upstream close, and client disconnect.
- `go test ./...`, `go vet ./...`, and `go build ./...` pass.
- If frontend files are changed, `cd web && npm run build` and `cd web && npm run lint` pass.
- `make build` passes before final handoff when embedded frontend changes are included.

## Work Plan

### Phase 0 - Confirm Scope

Read the detailed plan and reconfirm:

- no existing Kiro implementation exists in CPAB or local `CLIProxyAPI`;
- `CLIProxyAPI` SDK is the correct home for the runtime provider;
- MVP auth path is refresh-token import;
- Kiro should be enabled behind explicit admin setup.

Do not implement until these assumptions are checked against current source.

### Phase 1 - Auth And Refresh

Implement Kiro auth metadata helpers and refresh-token flow.

Required behavior:

- parse Kiro metadata from auth rows;
- refresh access token near expiry;
- refresh and retry on `401`;
- refresh and retry on token-related `403`;
- persist new access token and rotated refresh token;
- de-dupe concurrent refreshes per auth ID;
- redact all token values in logs and responses.

### Phase 2 - EventStream Decoder

Implement and test AWS EventStream decoding.

Required behavior:

- decode binary frames;
- parse headers and payload;
- handle multiple events;
- reject malformed/truncated/oversized frames safely;
- keep this code independently unit tested.

### Phase 3 - Request Translation

Implement Kiro request translation.

Required behavior:

- parse synthetic suffixes;
- map requested synthetic model to upstream base model;
- translate messages, tools, tool results, and supported media;
- inject thinking mode only when requested;
- inject agentic behavior only when requested;
- fail loudly on unsupported content that would otherwise be lost.

### Phase 4 - Runtime Executor

Implement the first-class Kiro executor in `CLIProxyAPI`.

Required behavior:

- send CodeWhisperer `GenerateAssistantResponse` requests;
- use selected auth access token;
- use per-auth proxy transport;
- respect request context cancellation;
- decode AWS EventStream;
- emit SDK stream chunks;
- aggregate non-streaming responses only if required;
- retry before first payload only;
- never hide post-commit stream failure with fallback.

### Phase 5 - Model Catalog

Implement Kiro model listing and synthetic variant expansion.

Required behavior:

- list models using Kiro/Amazon Q model endpoint;
- refresh on `401` and token-related `403`;
- cache per auth;
- expand synthetic variants;
- attach upstream base model metadata;
- provide billing/model registry metadata.

### Phase 6 - CPAB Admin Surface

Wire Kiro into CPAB admin APIs and frontend.

Required behavior:

- create/list/update/delete Kiro auth rows;
- redact secrets;
- validate Kiro credentials;
- expose model listing;
- enforce RBAC;
- provide frontend forms in the frontend repo/submodule workflow.

### Phase 7 - Routing, Billing, Quotas, Usage

Make Kiro usable by CPAB customers.

Required behavior:

- model mappings can route to Kiro;
- selector modes work with Kiro accounts;
- auth groups and user groups restrict access;
- billing rules apply;
- quota/rate limits apply;
- usage records include Kiro-specific metadata.

### Phase 8 - Model Testing And Health

Add model testing and operational health.

Required behavior:

- test one Kiro model;
- batch test Kiro models;
- warm the first model before parallel tests to avoid refresh races;
- report latency and redacted error details;
- optionally feed repeated failures into cooldown state.

### Phase 9 - Observability And Docs

Add logs, metrics, and operator documentation.

Required behavior:

- stream start/end logs include provider, model, auth, proxy mode, duration, and terminal status;
- docs explain refresh-token setup, model variants, proxy behavior, limitations, and troubleshooting;
- known limitations are explicit.

## Quality Gates

After substantive backend changes:

```bash
go test ./...
go vet ./...
go build ./...
```

After frontend changes in `web/`:

```bash
cd web && npm run build
cd web && npm run lint
```

Before final handoff:

```bash
make build
ubs <changed-files>
git status
br sync --flush-only
```

## Residual Risks To Track

- Kiro/CodeWhisperer APIs may be unofficial or unstable.
- Account-level model availability may differ.
- Proxy instability can still terminate streams after the first payload.
- Post-commit stream retry is intentionally unsupported.
- Prompt mutation for thinking/agentic variants must remain explicit and test-covered.

## First Concrete Next Step

Start with Phase 0 and Phase 1:

1. Re-read `docs/plans/kiro-provider-port-plan.md`.
2. Inspect current `CLIProxyAPI` provider registration and auth manager code.
3. Add Kiro auth metadata parsing and refresh-token support with tests.
4. Do not touch request translation or streaming until auth refresh tests are passing.
