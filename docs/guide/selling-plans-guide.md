# Hướng Dẫn Bán Gói Cho User

> Hướng dẫn đầy đủ cho admin: cấu hình từng bước để bán các gói subscription cho user.

---

## Tổng Quan

Khi bạn muốn bán một gói (plan) cho user, bạn cần cấu hình **7 bước theo thứ tự**. Mỗi bước phụ thuộc vào bước trước đó.

```
User Groups → Auth Groups → Provider API Keys → Model Mappings → Billing Rules → Plans → Prepaid Cards
```

### Entity Relationship Map

```
┌─────────────────┐
│   User Groups   │ ←─────────── Entity chính, mọi thứ đều tham chiếu đến đây
└────┬────────────┘
     │
     ├──→ Auth Groups (restrict user group nào được dùng credential)
     │
     ├──→ Model Mappings (restrict user group nào được truy cập model)
     │
     ├──→ Billing Rules (scoped theo auth group + user group)
     │
     ├──→ Plans (grant user group khi user mua plan)
     │
     └──→ Prepaid Cards (scope deductions cho user group)
```

---

## Bước 1: Tạo User Groups

User Groups là cơ chế kiểm soát truy cập chính. Mỗi group đại diện cho một tier (free, pro, enterprise...).

**Path:** Admin Dashboard > User Groups

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Name | string | Có | Tên nhóm duy nhất (vd: "free", "pro", "enterprise") |
| Default | bool | Không | Tự động gán cho user mới. Chỉ 1 group được default |
| Rate Limit | int | Không | Req/sec cho tất cả user trong group. 0 = unlimited |

### Ví dụ: Tạo 3 tier

| Group | Default | Rate Limit | Mục đích |
|-------|---------|------------|----------|
| free | Yes | 3 | Mặc định cho tất cả signup mới |
| pro | No | 10 | Người dùng trả phí |
| enterprise | No | 0 | Không giới hạn cho enterprise |

> **Mẹo:** Luôn tạo một group `free` làm default. Nếu user không có plan nào, họ sẽ rơi vào group free.

---

## Bước 2: Tạo Auth Groups

Auth Groups nhóm các credential của provider và restrict user group nào được dùng.

**Path:** Admin Dashboard > Auth Groups

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Name | string | Có | Tên nhóm duy nhất (vd: "claude-primary", "gemini-fallback") |
| Default | bool | Không | Tự động gán cho auth entries mới |
| Rate Limit | int | Không | Req/sec cho tất cả credential trong group. 0 = unlimited |
| User Group ID | int[] | Không | User groups nào được dùng credential này. Empty = tất cả |

### Ví dụ: Tạo 2 auth groups

| Auth Group | Default | Rate Limit | User Group ID | Mục đích |
|-------------|---------|------------|---------------|----------|
| shared | Yes | 0 | [] (tất cả) | Shared credentials cho mọi tier |
| premium | No | 0 | [pro, enterprise] | Priority credentials chỉ cho pro/enterprise |

> **Khi nào cần nhiều Auth Groups?** Nếu bạn có API key khác nhau cho các tier khác nhau (vd: key ưu tiên cho enterprise, key shared cho free), hãy tạo Auth Groups riêng và restrict bằng User Group ID.

---

## Bước 3: Thêm Provider API Keys

Thêm credential upstream vào Auth Groups.

**Path:** Admin Dashboard > Auth Files

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Type | dropdown | Có | Auth type (tùy provider) |
| Auth Group | dropdown | Có | Auth Group mà credential này thuộc về |
| Proxy URL | string | Không | Proxy override cho credential này |
| *(dynamic fields)* | varies | varies | Fields tùy auth type |

Mỗi auth entry còn có:
- **Rate Limit** (int) - Req/sec per credential
- **Priority** (int) - Credential priority cao hơn được chọn trước
- **Is Available** (bool) - Bật/tắt credential

### Quy trình:

1. Chọn **Auth Group** (từ Bước 2)
2. Chọn **Type** (tùy upstream provider: Claude, Gemini, OpenAI...)
3. Điền **credential fields** (API key, secret key...)
4. Set **Priority** (cao hơn = ưu tiên hơn)

---

## Bước 4: Tạo Model Mappings

Model Mappings định nghĩa model nào được expose cho user và routing strategy.

**Path:** Admin Dashboard > Models

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Provider | dropdown | Có | `gemini`, `codex`, `claude`, `kiro`, `openai-compatibility` |
| Model Name | string | Có | Tên model upstream/internal |
| New Model Name | string | Có | Tên expose cho API consumers |
| Selector | enum | Có | Routing strategy cho auth credentials |
| Rate Limit | int | Không | Req/sec per model. 0 = unlimited |
| User Group ID | int[] | Không | User groups nào được truy cập. Empty = tất cả |
| Fork | bool | Không | Fork metadata cho routing |
| Enabled | bool | Có | Active flag |

### Selector Strategies

| Giá trị | Tên | Hành vi |
|---------|-----|---------|
| 0 | Round Robin | Phân phối request đều các credentials |
| 1 | Fill First | Dùng 1 credential cho đến khi exhausted, rồi chuyển credential khác |
| 2 | Sticky | Duy trì session affinity với 1 credential |

### Ví dụ: Model Mappings cho 3 tier

| Provider | Model Name | New Model Name | User Group ID | Selector | Rate Limit |
|----------|-----------|----------------|---------------|----------|------------|
| claude | claude-haiku-2-0912 | haiku | [] (tất cả) | Round Robin | 5 |
| claude | claude-sonnet-2-0912 | sonnet | [] (tất cả) | Round Robin | 10 |
| claude | claude-opus-2-0912 | opus | [enterprise] | Fill First | 0 |

> **Quan trọng:** Model Mappings với `User Group ID` = [pro, enterprise] sẽ chỉ expose model đó cho user thuộc group pro/enterprise.

---

## Bước 5: Tạo Billing Rules

Billing Rules định nghĩa giá cho mỗi request, scoped theo Auth Group, User Group, Provider, Model.

**Path:** Admin Dashboard > Billing Rules

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Auth Group | dropdown | Có | Provider credentials này áp dụng cho |
| User Group | dropdown | Có | Users này áp dụng cho |
| Provider | string | Không | Provider name filter (vd: "claude") |
| Model | string | Không | Model name filter (vd: "claude-sonnet-4-20250514") |
| Billing Type | enum | Có | `Per Request` hoặc `Per Token` |
| Enabled | bool | Có | Active flag |

### Per Request Pricing

| Trường | Mô tả |
|--------|-------|
| Price Per Request | Flat fee cho mỗi API call |

### Per Token Pricing

| Trường | Mô tả |
|--------|-------|
| Price Input Token | Cost per input token |
| Price Output Token | Cost per output token |
| Price Cache Create Token | Cost per cache-creation token |
| Price Cache Read Token | Cost per cache-read token |

### Ví dụ: Billing Rules cho 3 tier

| Auth Group | User Group | Provider | Model | Type | Price |
|------------|------------|----------|-------|------|-------|
| shared | free | claude | haiku | Per Request | $0.003 |
| shared | free | claude | sonnet | Per Request | $0.01 |
| premium | pro | claude | sonnet | Per Token | Input: $3/1M, Output: $7.5/1M |
| premium | enterprise | claude | opus | Per Token | Input: $15/1M, Output: $37.5/1M |

> **Mẹo:** Khi setup billing lần đầu, dùng **Batch Import** để auto-create rules cho tất cả enabled models, sau đó adjust pricing multiplier.

---

## Bước 6: Tạo Plans

Plans là subscription tiers mà user có thể purchase. Mỗi plan bundle quota limits, rate limits, và User Group access.

**Path:** Admin Dashboard > Plans

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Name | string | Có | Plan display name (vd: "Starter", "Pro", "Enterprise") |
| Monthly Price | float | Không | Price per month (trong currency của bạn) |
| Sort Order | int | Không | Display ordering (lower = first) |
| Total Quota | float | Không | Max total usage cho billing period. 0 = unlimited |
| Daily Quota | float | Không | Max usage per day. 0 = unlimited |
| Rate Limit | int | Không | Req/sec cho plan subscribers. 0 = unlimited |
| User Group | int[] | Không | User Groups được grant khi purchase plan này |
| Support Models | JSON | Không | Model mappings nào included trong plan này |
| Description | text | Không | Plan description shown to users |
| Feature 1-4 | text | Không | Feature bullet points cho plan card |
| Enabled | bool | Có | Plan có available để purchase không |

### Ví dụ: Tạo 3 plans

| Plan | Monthly Price | Total Quota | Daily Quota | Rate Limit | User Group | Enabled |
|------|---------------|-------------|-------------|------------|------------|---------|
| Starter | $9.99 | 10.0 | 2.0 | 3 | [free] | Yes |
| Pro | $29.99 | 100.0 | 20.0 | 10 | [pro] | Yes |
| Enterprise | $99.99 | 0 (unlimited) | 0 (unlimited) | 0 | [enterprise] | Yes |

> **Lưu ý:** 
> - `Total Quota = 0` = unlimited
> - `Daily Quota = 0` = unlimited per day
> - User Group là groups được **grant access** khi user mua plan

---

## Bước 7: Tạo Prepaid Cards

Prepaid Cards là card nạp tiền trước để user purchase plans.

**Path:** Admin Dashboard > Prepaid Cards

### Single Card Creation

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| Name | string | Có | Card display name |
| Card SN | string | Có | Unique serial number |
| Password | string | Có | Redemption password |
| Amount | float | Có | Card value (phải > 0) |
| User Group ID | int | Không | Scope deductions cho User Group cụ thể |
| Valid Days | int | Không | Days until expiration after redemption |
| Enabled | bool | Có | Card có thể redeem được không |

### Batch Generation

| Trường | Kiểu | Default | Mô tả |
|--------|------|---------|-------|
| Name | string | - | Card name prefix |
| Amount | float | - | Value per card |
| Count | int | - | Number of cards (1-1000) |
| Card SN Prefix | string | - | Serial number prefix |
| Password Length | int | 10 | Generated password length (6-32) |
| User Group ID | int | - | Optional group scope |
| Valid Days | int | - | Expiration window |

---

## Flow Khi User Purchase Plan

### Tự động (User Self-Service)

```
1. User đăng nhập vào front-end portal
2. User xem danh sách plans (GET /v0/front/plans)
3. User chọn plan muốn mua (POST /v0/front/bills)
4. System kiểm tra prepaid card balance của user
5. Nếu đủ balance → trừ tiền từ prepaid cards
6. Tạo Bill (status = Paid)
7. Grant User Group access cho user (qua BillUserGroupID)
8. User có thể dùng API với các quyền của plan
```

### Thủ Công (Admin Tạo Bill)

Admin có thể tạo bill trực tiếp qua admin API hoặc UI:

```
1. Admin tạo Bill cho user
2. Set:
   - Plan ID: plan muốn grant
   - User ID: user nhận plan
   - User Group ID: từ plan (auto)
   - Period Type: Monthly (1) hoặc Yearly (2)
   - Amount: số tiền bill
   - Period Start/End: khoảng thời gian billing
   - Total Quota, Daily Quota: từ plan
   - Status: Paid (2) để active ngay
3. System refresh BillUserGroupIDs của user
4. User có quyền truy cập plan ngay lập tức
```

---

## Kiểm Tra Sau Khi Setup

### 1. Kiểm tra User Group Assignment

```bash
# Kiểm tra user có đúng group không
curl -s http://localhost:8318/v0/admin/users | jq '.users[] | {username, user_group_id, bill_user_group_id}'
```

### 2. Kiểm tra Billing Rule Matching

System lookup billing rule theo priority:

```
Priority 3: AuthGroup + UserGroup + Provider + Model (specific)
Priority 2: AuthGroup + UserGroup (general)
Priority 1: Default AuthGroup + Default UserGroup + Provider + Model
Priority 0: Default AuthGroup + Default UserGroup (fallback)
```

### 3. Kiểm Tra Model Access

```bash
# User gọi API với model mapping
curl -s -H "Authorization: Bearer <USER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }' \
  http://localhost:8318/v1/chat/completions
```

### 4. Kiểm Tra Quota

```bash
# Xem bill của user
curl -s http://localhost:8318/v0/admin/bills | jq '.bills[] | {user_id, plan_id, total_quota, used_quota, left_quota, status}'
```

---

## Checklist Setup Hoàn Chỉnh

Dùng checklist này để đảm bảo bạn không bỏ sót bước nào:

- [ ] **User Groups** đã tạo đủ các tier (free, pro, enterprise...)
- [ ] **Auth Groups** đã tổ chức credentials theo tier
- [ ] **Provider API Keys** đã được thêm vào đúng Auth Groups
- [ ] **Auth Files** đã được tạo với đúng credentials
- [ ] **Model Mappings** đã map tất cả models cần expose
- [ ] **Model Mappings** đã restrict User Group ID đúng
- [ ] **Billing Rules** đã định giá cho từng auth group + user group
- [ ] **Plans** đã tạo với quota, rate limit, user group
- [ ] **Prepaid Cards** đã tạo đủ số lượng cho user purchase
- [ ] **Settings** đã enable Redis rate limiting (nếu production)
- [ ] **Kiểm thử** user mua plan và dùng API thành công

---

## Ví Dụ Complete Setup: Bán Gói Pro $29.99/tháng

### Scenario

Bạn muốn bán gói Pro với:
- **Giá:** $29.99/tháng
- **Quota:** 100 total, 20 daily
- **Rate Limit:** 10 req/sec
- **Access:** Claude Sonnet, Gemini Pro
- **Pricing:** Per token (input $3/1M, output $7.5/1M)

### Cấu Hình

#### 1. User Groups

| Group | Default | Rate Limit |
|-------|---------|------------|
| free | Yes | 3 |
| pro | No | 10 |

#### 2. Auth Groups

| Auth Group | Default | User Group ID |
|-------------|---------|---------------|
| shared | Yes | [] (tất cả) |
| premium | No | [pro] |

#### 3. Provider API Keys

Thêm Claude API key vào `premium` auth group.
Thêm Gemini API key vào `premium` auth group.

#### 4. Model Mappings

| Provider | Model Name | New Model Name | User Group ID | Selector |
|----------|-----------|----------------|---------------|----------|
| claude | claude-sonnet-2-0912 | sonnet | [pro] | Round Robin |
| gemini | gemini-pro | gemini-pro | [pro] | Round Robin |

#### 5. Billing Rules

| Auth Group | User Group | Provider | Model | Type | Price |
|------------|------------|----------|-------|------|-------|
| premium | pro | claude | sonnet | Per Token | Input: $3/1M, Output: $7.5/1M |
| premium | pro | gemini | gemini-pro | Per Token | Input: $1.25/1M, Output: $5/1M |

#### 6. Plan

| Field | Value |
|-------|-------|
| Name | Pro Plan |
| Monthly Price | $29.99 |
| Total Quota | 100.0 |
| Daily Quota | 20.0 |
| Rate Limit | 10 |
| User Group | [pro] |
| Enabled | Yes |

#### 7. Prepaid Cards

Tạo 10 cards, mỗi card $50 (để user có thể mua 1-2 plans).

---

## Troubleshooting

### User Không Truy Cập Được Model

**Nguyên nhân:** Model Mapping có `User Group ID` restrict.

**Kiểm tra:**
1. User có `bill_user_group_id` chứa group đúng không?
2. Model Mapping có include user group không?
3. Billing Rule có match với auth group + user group không?

### Billing Rule Không Áp Dụng

**Nguyên nhân:** Billing rule lookup theo priority.

**Kiểm tra:**
1. Rule có `is_enabled = true` không?
2. Auth Group + User Group có match không?
3. Provider + Model có match không?
4. Có rule nào priority cao hơn override không?

### User Không Purchase Được Plan

**Nguyên nhân:** Insufficient prepaid card balance.

**Kiểm tra:**
1. User có prepaid card nào đã redeem chưa?
2. Prepaid card balance có đủ `plan.month_price` không?
3. Prepaid card có `is_enabled = true` và chưa expired?

### Quota Hết Quá Nhanh

**Nguyên nhân:** Billing rule pricing quá thấp hoặc quota quá nhỏ.

**Kiểm tra:**
1. `Plan.TotalQuota` có quá nhỏ không?
2. Billing rule price có quá thấp không?
3. Có thể increase `DailyQuota` hoặc `TotalQuota` trong Plan.

---

## Tài Liệu Liên Quan

- [Admin Guide](../admin-guide.md) - Hướng dẫn cấu hình admin đầy đủ
- [Setup Walkthrough](../admin-guide.md#setup-walkthrough) - Minimal và Full setup
