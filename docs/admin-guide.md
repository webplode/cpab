# CLIProxyAPIBusiness Admin Guide

This guide covers every configurable entity in the admin dashboard, how they relate to each other, and recommended configuration for common deployment scenarios.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Entity Relationship Map](#entity-relationship-map)
- [Configuration Entities](#configuration-entities)
  - [1. Settings (Global)](#1-settings-global)
  - [2. User Groups](#2-user-groups)
  - [3. Auth Groups](#3-auth-groups)
  - [4. Provider API Keys](#4-provider-api-keys)
  - [5. Auth Files (Credentials)](#5-auth-files-credentials)
  - [6. Proxies](#6-proxies)
  - [7. Model Mappings](#7-model-mappings)
  - [8. Billing Rules](#8-billing-rules)
  - [9. Plans](#9-plans)
  - [10. Users](#10-users)
  - [11. Prepaid Cards](#11-prepaid-cards)
  - [12. Administrators](#12-administrators)
- [Read-Only Views](#read-only-views)
  - [Bills](#bills)
  - [Quotas](#quotas)
  - [Logs](#logs)
  - [Dashboard](#dashboard)
- [Rate Limiting](#rate-limiting)
- [Quota & Billing Flow](#quota--billing-flow)
- [Setup Walkthrough](#setup-walkthrough)
  - [Minimal Setup (API-only, no billing)](#minimal-setup-api-only-no-billing)
  - [Full Setup (with billing and plans)](#full-setup-with-billing-and-plans)
  - [Public Tunnel Setup (Cloudflare)](#public-tunnel-setup-cloudflare)

---

## Architecture Overview

CLIProxyAPIBusiness is an LLM API gateway that exposes an OpenAI-compatible API (`/v1/*`) to end users while routing requests to multiple upstream providers (Claude, Gemini, Codex, OpenAI-compatible). The admin dashboard manages all configuration: credentials, routing, billing, quotas, and access control.

**API Paths:**

| Path | Purpose | Audience |
|------|---------|----------|
| `/v1/*` | OpenAI-compatible API | API consumers (public) |
| `/v1beta/*` | Gemini-compatible API | API consumers (public) |
| `/v0/admin/*` | Admin API | Administrators (local only) |
| `/v0/front/*` | User self-service API | Registered users (local only) |
| `/healthz` | Health check | Monitoring |
| `/` | Web UI | Administrators / users (local only) |

**Default port:** `8318`

---

## Entity Relationship Map

```
Settings (global defaults)
 |
 |  User Groups <──────────────────────────────────────┐
 |   └─ Name, Default, RateLimit                       │ (referenced by most entities)
 |                                                     │
 |  Auth Groups ── restricts access to → User Groups   │
 |   └─ Name, Default, RateLimit, UserGroupID[]        │
 |                                                     │
 |  Auth Files (credentials) ── belongs to → Auth Groups
 |   └─ Type, Content, ProxyURL, RateLimit, Priority
 |
 |  Provider API Keys (separate credential type)
 |   └─ Provider, APIKey, BaseURL, Models
 |
 |  Model Mappings ── restricts access to → User Groups
 |   └─ Provider → ModelName → NewModelName
 |   └─ Selector (routing), RateLimit
 |   └─ Model Payload Rules (sub-entity)
 |
 |  Billing Rules ── scoped to → Auth Group + User Group
 |   └─ Provider/Model filter, BillingType, Pricing
 |
 |  Plans ── grants → User Groups, references → Model Mappings
 |   └─ TotalQuota, DailyQuota, RateLimit, MonthPrice
 |
 |  Users ── member of → User Groups, subscribes to → Plan
 |   └─ DailyMaxUsage, RateLimit, APIKeys[]
 |
 |  Bills ── links → User + Plan (created on purchase)
 |   └─ TotalQuota, DailyQuota, LeftQuota, UsedQuota
 |
 |  Prepaid Cards ── redeemed by → User
 |   └─ Amount, Balance, ValidDays
```

---

## Configuration Entities

### 1. Settings (Global)

Global key-value configuration that applies system-wide.

**Path:** Admin Dashboard > Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `SITE_NAME` | string | "CLIProxyAPI" | Display name in the web UI |
| `ONLY_MAPPED_MODELS` | bool | false | Only expose models with explicit mappings |
| `AUTO_ASSIGN_PROXY` | bool | false | Auto-assign proxy to new auth entries |
| `RATE_LIMIT` | int | 0 | Global default rate limit (req/sec). 0 = unlimited |
| `RATE_LIMIT_REDIS_ENABLED` | bool | false | Use Redis for distributed rate limiting |
| `RATE_LIMIT_REDIS_ADDR` | string | - | Redis server address (e.g. `localhost:6379`) |
| `RATE_LIMIT_REDIS_PASSWORD` | string | - | Redis password |
| `RATE_LIMIT_REDIS_DB` | int | 0 | Redis database index |
| `RATE_LIMIT_REDIS_PREFIX` | string | "cpab:rl" | Redis key prefix for rate limit counters |
| `QUOTA_POLL_INTERVAL_SECONDS` | int | 180 | How often to poll upstream provider quotas |
| `QUOTA_POLL_MAX_CONCURRENCY` | int | 5 | Max concurrent quota poll requests |
| `WEB_AUTHN_ORIGIN` | string | - | WebAuthn origin URL for passkey verification |
| `WEB_AUTHN_RPID` | string | - | WebAuthn Relying Party ID (domain only) |
| `WEB_AUTHN_ORIGINS` | string | - | Additional WebAuthn origins (comma-separated) |

> **Recommendation:** Enable Redis rate limiting for production deployments. In-memory rate limiting does not persist across restarts and does not work with multiple instances.

---

### 2. User Groups

User Groups are the primary access control mechanism. They determine which models, auth credentials, and billing rules apply to a user.

**Path:** Admin Dashboard > User Groups

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Name | string | Yes | Unique group name (e.g. "free", "pro", "enterprise") |
| Default | bool | No | Auto-assign to new users. Only one group can be default |
| Rate Limit | int | No | Req/sec for all users in this group. 0 = unlimited |

**How User Groups are used:**

- **Model Mappings** reference User Groups to restrict which groups can access which models
- **Auth Groups** reference User Groups to restrict which groups can use which provider credentials
- **Billing Rules** are scoped to a User Group to apply different pricing per group
- **Plans** grant User Group memberships when purchased
- **Prepaid Cards** can be scoped to a User Group

**Example setup:**

| Group | Default | Rate Limit | Purpose |
|-------|---------|------------|---------|
| free | Yes | 3 | Default for all new signups |
| pro | No | 10 | Paid subscribers |
| enterprise | No | 0 | Unlimited for enterprise contracts |

---

### 3. Auth Groups

Auth Groups organize provider credentials and restrict which User Groups can use them.

**Path:** Admin Dashboard > Auth Groups

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Name | string | Yes | Unique group name (e.g. "claude-primary", "gemini-fallback") |
| Default | bool | No | Auto-assign to new auth entries |
| Rate Limit | int | No | Req/sec for all credentials in this group. 0 = unlimited |
| User Group ID | int[] | No | Which User Groups can use these credentials. Empty = all groups |

**Purpose:** If you have separate API keys for different tiers (e.g. a high-priority Claude key for enterprise users and a shared one for free users), you put them in different Auth Groups and restrict access via User Group IDs.

---

### 4. Provider API Keys

Upstream provider API keys for direct provider integrations.

**Path:** Admin Dashboard > API Keys (Provider)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Provider | dropdown | Yes | `gemini`, `codex`, `claude`, or `openai-compatibility` |
| Name | string | No | Display label |
| API Key | string | Yes | The upstream provider API key |
| Priority | int | No | Higher priority keys are preferred during selection |
| Prefix | string | No | Key prefix identifier |
| Base URL | string | No | Custom endpoint URL (for self-hosted or regional endpoints) |
| Proxy URL | string | No | HTTP proxy for upstream requests |
| Headers | JSON | No | Custom headers sent with upstream requests |
| Models | JSON | No | Model name aliases (array of `{name, alias}`) |
| Excluded Models | string[] | No | Models to skip for this key |
| API Key Entries | JSON | No | Multiple sub-keys (openai-compatibility provider only) |

---

### 5. Auth Files (Credentials)

Provider credential entries with dynamic fields based on auth type. These are the actual authentication payloads used to call upstream providers.

**Path:** Admin Dashboard > Auth Files

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Type | dropdown | Yes | Auth type (varies by provider) |
| Auth Group | dropdown | Yes | Which Auth Group this credential belongs to |
| Proxy URL | string | No | HTTP proxy override for this credential |
| *(dynamic fields)* | varies | varies | Additional fields depend on the selected auth type |

Each auth entry also has:
- **Rate Limit** (int) - Per-credential req/sec
- **Priority** (int) - Higher priority credentials are selected first
- **Is Available** (bool) - Can be toggled on/off

---

### 6. Proxies

HTTP/HTTPS/SOCKS5 proxies for upstream provider requests.

**Path:** Admin Dashboard > Proxies

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Protocol | dropdown | Yes | `http`, `https`, or `socks5` |
| Host | string | Yes | Proxy hostname or IP |
| Port | int | Yes | Proxy port |
| Username | string | No | Proxy auth username |
| Password | string | No | Proxy auth password |

Supports **batch add** by pasting one proxy URL per line (e.g. `socks5://user:pass@host:port`).

---

### 7. Model Mappings

Model Mappings define which models are exposed to users and how requests are routed to upstream providers.

**Path:** Admin Dashboard > Models

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Provider | dropdown | Yes | `gemini`, `codex`, `claude`, `openai-compatibility` |
| Model Name | string | Yes | Internal/upstream model name |
| New Model Name | string | Yes | Name exposed to API consumers |
| Selector | enum | Yes | Routing strategy for auth credentials |
| Rate Limit | int | No | Per-model req/sec. 0 = unlimited |
| User Group ID | int[] | No | Which User Groups can access this model. Empty = all |
| Fork | bool | No | Fork metadata for routing |
| Enabled | bool | Yes | Active flag |

**Selector strategies:**

| Value | Name | Behavior |
|-------|------|----------|
| 0 | Round Robin | Distribute requests evenly across credentials |
| 1 | Fill First | Use one credential until exhausted, then move to next |
| 2 | Sticky | Maintain session affinity to a single credential |

**Model Payload Rules** (sub-entity):

Each model mapping can have payload rules that inject or override parameters for specific protocols.

| Field | Type | Description |
|-------|------|-------------|
| Protocol | string | Target protocol name |
| Params | JSON | Array of `{path, value, ruleType, valueType}` entries |
| Enabled | bool | Active flag |
| Description | string | Human-readable note |

Param rule types:
- `default` - Set value only if not already present in the request
- `override` - Always replace the value

---

### 8. Billing Rules

Billing Rules define how much users are charged for each request, scoped by Auth Group, User Group, provider, and model.

**Path:** Admin Dashboard > Billing Rules

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Auth Group | dropdown | Yes | Which provider credentials this rule applies to |
| User Group | dropdown | Yes | Which users this rule applies to |
| Provider | string | No | Provider name filter (e.g. "claude") |
| Model | string | No | Model name filter (e.g. "claude-sonnet-4-20250514") |
| Billing Type | enum | Yes | `Per Request` or `Per Token` |
| Enabled | bool | Yes | Active flag |

**Per Request pricing:**

| Field | Description |
|-------|-------------|
| Price Per Request | Flat fee charged for each API call |

**Per Token pricing:**

| Field | Description |
|-------|-------------|
| Price Input Token | Cost per input token |
| Price Output Token | Cost per output token |
| Price Cache Create Token | Cost per cache-creation token |
| Price Cache Read Token | Cost per cache-read token |

**Batch Import:** The billing rules page supports batch importing rules for all enabled model mappings, pre-populated with pricing from Model References (upstream provider pricing data).

> **Tip:** When setting up billing for the first time, use Batch Import to auto-create rules for all enabled models, then adjust the pricing multiplier as needed.

---

### 9. Plans

Plans are subscription tiers that users can purchase. Each plan bundles quota limits, rate limits, and User Group access.

**Path:** Admin Dashboard > Plans

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Name | string | Yes | Plan display name (e.g. "Starter", "Pro", "Enterprise") |
| Monthly Price | float | No | Price per month (in your currency) |
| Sort Order | int | No | Display ordering (lower = first) |
| Total Quota | float | No | Max total usage for the billing period. 0 = unlimited |
| Daily Quota | float | No | Max usage per day. 0 = unlimited |
| Rate Limit | int | No | Req/sec for plan subscribers. 0 = unlimited |
| User Group | int[] | No | User Groups granted when purchasing this plan |
| Support Models | JSON | No | Which model mappings are included in this plan |
| Description | text | No | Plan description shown to users |
| Feature 1-4 | text | No | Feature bullet points for the plan card |
| Enabled | bool | Yes | Whether the plan is available for purchase |

**How plans work:**

1. Admin creates a Plan with quotas, rate limits, and User Group assignments
2. User purchases the Plan (via front-end self-service or admin creates a Bill)
3. A **Bill** is created linking the User to the Plan
4. The Bill's `UserGroupID` is inherited from the Plan
5. The User's `BillUserGroupID` is updated, granting access to the plan's models and auth groups
6. Usage is tracked against the Bill's quotas (`UsedQuota`, `LeftQuota`)

---

### 10. Users

End users who access the API via API keys.

**Path:** Admin Dashboard > Users

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Username | string | Yes | Unique login name |
| Email | string | Yes | Unique email address |
| Password | string | Yes (create) | Password (hashed, can be changed separately) |
| User Group ID | int[] | No | Manual group assignments |
| Daily Max Usage | float | No | Hard daily spending cap. 0 = unlimited |
| Rate Limit | int | No | Per-user req/sec. 0 = unlimited |
| Disabled | bool | No | Block all access |

**Read-only fields:**

| Field | Description |
|-------|-------------|
| Bill User Group ID | Groups automatically granted by active bills/plans |
| Active | Whether the user can sign in |
| API Keys | Associated API keys |

**User API Keys** can be managed per-user or via the admin API key page. Each user can have multiple API keys.

---

### 11. Prepaid Cards

Pre-loaded balance cards that users can redeem for quota.

**Path:** Admin Dashboard > Prepaid Cards

**Single card creation:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Name | string | Yes | Card display name |
| Card SN | string | Yes | Unique serial number |
| Password | string | Yes | Redemption password |
| Amount | float | Yes | Card value (must be > 0) |
| User Group ID | int | No | Scope deductions to a specific User Group |
| Valid Days | int | No | Days until expiration after redemption |
| Enabled | bool | Yes | Whether the card can be redeemed |

**Batch generation:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | - | Card name prefix |
| Amount | float | - | Value per card |
| Count | int | - | Number of cards (1-1000) |
| Card SN Prefix | string | - | Serial number prefix |
| Password Length | int | 10 | Generated password length (6-32) |
| User Group ID | int | - | Optional group scope |
| Valid Days | int | - | Expiration window |

**Redemption flow:**
1. User enters Card SN + Password in the front-end self-service portal
2. Card balance is credited to the user
3. `ExpiresAt` is calculated from `ValidDays`
4. Balance is deducted as the user makes API requests

---

### 12. Administrators

Admin accounts that can access the admin dashboard.

**Path:** Admin Dashboard > Administrators

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Username | string | Yes | Admin login name |
| Password | string | Yes (create) | Admin password |
| Super Admin | bool | No | Grants all permissions |
| Permissions | string[] | No | Granular permission keys (if not super admin) |

**MFA support:**
- TOTP (Time-based One-Time Password)
- WebAuthn / Passkeys

Permissions are defined as `METHOD /v0/admin/path` patterns grouped by module. Non-super-admin accounts can be restricted to specific sections of the dashboard.

---

## Read-Only Views

### Bills

**Path:** Admin Dashboard > Bills

Bills are created when users purchase plans. They track quota usage per billing period.

| Field | Description |
|-------|-------------|
| Plan | Which plan was purchased |
| User | Who purchased it |
| Period Type | Monthly (1) or Yearly (2) |
| Amount | Bill amount |
| Period Start / End | Billing period dates |
| Total Quota | Max usage for the period |
| Daily Quota | Max daily usage |
| Used Quota | How much has been consumed |
| Left Quota | Remaining quota |
| Used Count | Number of requests made |
| Rate Limit | Req/sec for this subscription |
| Status | Pending (1), Paid (2), Refund Requested (3), Refunded (4) |

> Bills can only be deleted from the admin dashboard, not edited. They are created automatically via user plan purchases or manually via the admin API.

### Quotas

**Path:** Admin Dashboard > Quotas

Displays upstream provider quota data for each auth credential, polled at the interval set by `QUOTA_POLL_INTERVAL_SECONDS`. Shows remaining capacity for provider-side limits.

### Logs

**Path:** Admin Dashboard > Logs

Request logs with filtering by model, provider, date range. Shows:
- Request counts and token usage (input, output, total)
- Cost in micros (1,000,000 = $1.00)
- Error rates and status codes
- Per-model and per-provider breakdowns

### Dashboard

**Path:** Admin Dashboard > Dashboard

- **KPI Cards** - Today's requests, tokens consumed, avg response time, error rate
- **Traffic Chart** - Request volume over time
- **Cost Distribution** - Spending breakdown by model/provider
- **Recent Transactions** - Latest API calls with details

---

## Rate Limiting

Rate limits are enforced at multiple levels. When multiple limits apply, the **most specific non-zero limit** takes effect.

**Priority order (most specific to least specific):**

```
1. Model Mapping rate limit     (per model)
2. Bill rate limit              (per subscription)
3. User rate limit              (per user)
4. User Group rate limit        (per group)
5. Auth Group rate limit        (per auth group)
6. Auth entry rate limit        (per credential)
7. Global RATE_LIMIT setting    (system-wide fallback)
```

**Implementation:**

| Mode | Setting | Behavior |
|------|---------|----------|
| In-memory | `RATE_LIMIT_REDIS_ENABLED` = false | Simple counter, resets on restart, single-instance only |
| Redis | `RATE_LIMIT_REDIS_ENABLED` = true | Sliding window, persists across restarts, works with multiple instances |

> **Production recommendation:** Always use Redis rate limiting. Configure `RATE_LIMIT_REDIS_ADDR` and set `RATE_LIMIT_REDIS_ENABLED` to true.

---

## Quota & Billing Flow

### How a request is billed

```
1. User sends request to /v1/chat/completions with API key
2. API key is validated → User is identified
3. User's groups are resolved (UserGroupID + BillUserGroupID)
4. Model mapping is found for the requested model
5. Auth credential is selected based on Selector strategy
6. Billing rule is looked up: AuthGroup × UserGroup × Provider × Model
7. Request is forwarded to upstream provider
8. Response tokens are counted
9. Cost is calculated based on billing rule:
   - Per Request: flat fee
   - Per Token: (input_tokens × price_input) + (output_tokens × price_output)
                 + (cache_create × price_cache_create) + (cache_read × price_cache_read)
10. Cost is deducted from the user's active Bill (LeftQuota decreases)
11. Usage record is created with all token counts and cost
```

### Quota enforcement checks

Before the request is forwarded:

| Check | Source | Behavior when exceeded |
|-------|--------|----------------------|
| Daily Max Usage | `User.DailyMaxUsage` | Request rejected with 429 |
| Daily Quota | `Bill.DailyQuota` | Request rejected with 429 |
| Total Quota | `Bill.LeftQuota` | Request rejected with 429 |
| Rate Limit | Multiple levels (see above) | Request rejected with 429 |

---

## Setup Walkthrough

### Minimal Setup (API-only, no billing)

For a simple proxy setup where you don't need billing or quotas:

1. **Settings** - Set `SITE_NAME`, leave rate limits at 0
2. **Provider API Keys** - Add your upstream API keys (e.g. Claude, Gemini)
3. **Model Mappings** - Create mappings for the models you want to expose
   - Set `New Model Name` to the name your users will request
   - Leave `User Group ID` empty (all users)
4. **Users** - Create user accounts
5. **API Keys** - Generate API keys for each user

Users can now call `/v1/chat/completions` with their API key and any mapped model name.

### Full Setup (with billing and plans)

1. **User Groups** - Create groups for your tiers:
   - `free` (default=true, rate_limit=3)
   - `pro` (rate_limit=10)
   - `enterprise` (rate_limit=0)

2. **Auth Groups** - Organize your provider credentials:
   - `shared` (user_group_id=[], all groups can use)
   - `premium` (user_group_id=[pro, enterprise])

3. **Provider API Keys** + **Auth Files** - Add upstream credentials to auth groups

4. **Model Mappings** - Map models with group restrictions:
   - `claude-haiku` → user_group_id=[] (all groups)
   - `claude-sonnet` → user_group_id=[pro, enterprise]
   - `claude-opus` → user_group_id=[enterprise]

5. **Billing Rules** - Set pricing per auth group + user group + model:
   - free + shared + claude-haiku: $0.001/request
   - pro + premium + claude-sonnet: per-token pricing

6. **Plans** - Create subscription tiers:
   - Starter: total_quota=10, daily_quota=2, rate_limit=3, user_group=[free]
   - Pro: total_quota=100, daily_quota=20, rate_limit=10, user_group=[pro]
   - Enterprise: total_quota=0, daily_quota=0, rate_limit=0, user_group=[enterprise]

7. **Settings** - Enable Redis rate limiting for production

### Public Tunnel Setup (Cloudflare)

When exposing the API via Cloudflare Tunnel, only `/v1/*` and `/healthz` should be public. The admin UI and user portal stay local-only.

**cloudflared config.yml:**

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: api.yourdomain.com
    path: /v1/.*
    service: http://localhost:8318
  - hostname: api.yourdomain.com
    path: /healthz
    service: http://localhost:8318
  - hostname: api.yourdomain.com
    service: http_status:404
  - service: http_status:404
```

**Recommended settings for public exposure:**

| Setting | Value | Why |
|---------|-------|-----|
| `RATE_LIMIT` | 10-20 | Global fallback |
| `RATE_LIMIT_REDIS_ENABLED` | true | Accurate distributed counting |
| User `RateLimit` | 3-10 | Per-user abuse prevention |
| User `DailyMaxUsage` | Based on pricing tier | Hard daily spending cap |
| Plan `DailyQuota` | Tier-based | Enforced per billing period |

Additionally, consider adding a Cloudflare WAF rate limit rule on `/v1/chat/completions` (e.g. 60 req/min per IP) as an outer defense layer.
