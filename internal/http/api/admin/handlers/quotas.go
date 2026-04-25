package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	dbutil "github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	quotapkg "github.com/router-for-me/CLIProxyAPIBusiness/internal/quota"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// QuotaHandler handles admin quota endpoints.
type QuotaHandler struct {
	db *gorm.DB
}

// NewQuotaHandler constructs a QuotaHandler.
func NewQuotaHandler(db *gorm.DB) *QuotaHandler {
	return &QuotaHandler{db: db}
}

// quotaListQuery defines filters for the quota list view.
type quotaListQuery struct {
	Page  int    `form:"page,default=1"`   // Page number.
	Limit int    `form:"limit,default=10"` // Page size.
	Key   string `form:"key"`              // Auth key filter.
	Type  string `form:"type"`             // Auth type filter.
	Group string `form:"auth_group_id"`    // Auth group filter.
}

// quotaListRow defines the query result row for quota list.
type quotaListRow struct {
	ID          uint64         `gorm:"column:id"`
	AuthID      uint64         `gorm:"column:auth_id"`
	Type        string         `gorm:"column:type"`
	Data        datatypes.JSON `gorm:"column:data"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	AuthKey     string         `gorm:"column:auth_key"`
	AuthContent datatypes.JSON `gorm:"column:auth_content"`
}

// List returns quota records with paging and filters.
func (h *QuotaHandler) List(c *gin.Context) {
	var q quotaListQuery
	if errBind := c.ShouldBindQuery(&q); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid query"})
		return
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 10
	}

	keyQ := strings.TrimSpace(q.Key)
	typeQ := strings.TrimSpace(q.Type)
	groupQ := strings.TrimSpace(q.Group)
	var groupID uint64
	if groupQ != "" {
		parsed, errParse := strconv.ParseUint(groupQ, 10, 64)
		if errParse != nil || parsed == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid auth_group_id"})
			return
		}
		groupID = parsed
	}

	ctx := c.Request.Context()

	base := h.db.WithContext(ctx).
		Table("quota").
		Joins("JOIN auths ON auths.id = quota.auth_id")
	if keyQ != "" {
		pattern := dbutil.NormalizeLikePattern(h.db, "%"+keyQ+"%")
		base = base.Where(dbutil.CaseInsensitiveLikeExpr(h.db, "auths.key"), pattern)
	}
	if typeQ != "" {
		base = base.Where("quota.type = ?", typeQ)
	}
	if groupID > 0 {
		base = base.Where(dbutil.JSONArrayContainsExpr(h.db, "auths.auth_group_id"), dbutil.JSONArrayContainsValue(h.db, groupID))
	}

	var total int64
	if errCount := base.Count(&total).Error; errCount != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "count quotas failed"})
		return
	}

	typeQuery := h.db.WithContext(ctx).
		Table("quota").
		Joins("JOIN auths ON auths.id = quota.auth_id")
	if keyQ != "" {
		pattern := dbutil.NormalizeLikePattern(h.db, "%"+keyQ+"%")
		typeQuery = typeQuery.Where(dbutil.CaseInsensitiveLikeExpr(h.db, "auths.key"), pattern)
	}
	if groupID > 0 {
		typeQuery = typeQuery.Where(dbutil.JSONArrayContainsExpr(h.db, "auths.auth_group_id"), dbutil.JSONArrayContainsValue(h.db, groupID))
	}
	var types []string
	if errTypes := typeQuery.Distinct("quota.type").Order("quota.type ASC").Pluck("quota.type", &types).Error; errTypes != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list quota types failed"})
		return
	}

	offset := (q.Page - 1) * q.Limit
	var rows []quotaListRow
	if errFind := base.
		Select("quota.id, quota.auth_id, quota.type, quota.data, quota.updated_at, auths.key AS auth_key, auths.content AS auth_content").
		Order("auths.id ASC, quota.updated_at DESC").
		Offset(offset).
		Limit(q.Limit).
		Scan(&rows).Error; errFind != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list quotas failed"})
		return
	}

	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		payload, authStatus := quotapkg.UnwrapStoredQuotaData(row.Data)
		if isAntigravityType(row.Type) {
			payload = normalizeAntigravityQuota(payload)
		}
		entry := gin.H{
			"id":         row.ID,
			"auth_id":    row.AuthID,
			"auth_key":   row.AuthKey,
			"type":       row.Type,
			"data":       payload,
			"updated_at": row.UpdatedAt,
		}
		if authStatus != nil {
			entry["auth_status"] = authStatus
		}
		if oauth := extractQuotaOAuthInfo(row.AuthContent, authStatus); oauth != nil {
			entry["oauth"] = oauth
		}
		if sub := extractCodexSubscription(row.Type, row.AuthContent); sub != nil {
			entry["subscription"] = sub
		}
		out = append(out, entry)
	}

	c.JSON(http.StatusOK, gin.H{
		"quotas": out,
		"types":  types,
		"total":  total,
		"page":   q.Page,
		"limit":  q.Limit,
	})
}

func isAntigravityType(value string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(value)), "antigravity")
}

func modelName2Alias(modelName string) string {
	switch modelName {
	case "rev19-uic3-1p":
		return "gemini-2.5-computer-use-preview-10-2025"
	case "gemini-3-pro-image":
		return "gemini-3-pro-image-preview"
	case "gemini-3-pro-high":
		return "gemini-3-pro-preview"
	case "gemini-3-flash":
		return "gemini-3-flash-preview"
	case "claude-sonnet-4-5":
		return "gemini-claude-sonnet-4-5"
	case "claude-sonnet-4-5-thinking":
		return "gemini-claude-sonnet-4-5-thinking"
	case "claude-opus-4-5-thinking":
		return "gemini-claude-opus-4-5-thinking"
	case "chat_20706", "chat_23310", "gemini-2.5-flash-thinking", "gemini-3-pro-low", "gemini-2.5-pro":
		return ""
	default:
		return modelName
	}
}

func normalizeAntigravityQuota(data datatypes.JSON) datatypes.JSON {
	if len(data) == 0 {
		return data
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return data
	}
	modelsRaw, ok := payload["models"].(map[string]any)
	if !ok {
		return data
	}

	buckets := make([]map[string]any, 0, len(modelsRaw))
	for key, value := range modelsRaw {
		entry, okEntry := value.(map[string]any)
		if !okEntry {
			continue
		}
		if _, okProvider := entry["modelProvider"]; !okProvider {
			continue
		}
		modelName := strings.TrimSpace(key)
		alias := modelName2Alias(strings.ToLower(modelName))
		if alias == "" {
			continue
		}
		bucket := map[string]any{
			"modelId": alias,
		}
		if quotaInfo, okQuota := entry["quotaInfo"].(map[string]any); okQuota {
			if resetTime, okReset := quotaInfo["resetTime"]; okReset {
				bucket["resetTime"] = resetTime
			}
			if remaining, okRemaining := quotaInfo["remainingFraction"]; okRemaining {
				bucket["remainingFraction"] = remaining
			}
		}
		buckets = append(buckets, bucket)
	}
	if len(buckets) > 1 {
		getModelID := func(bucket map[string]any) string {
			if v, ok := bucket["modelId"].(string); ok {
				return strings.ToLower(strings.TrimSpace(v))
			}
			return ""
		}
		sort.Slice(buckets, func(i, j int) bool {
			return getModelID(buckets[i]) < getModelID(buckets[j])
		})
	}
	updated, errMarshal := json.Marshal(map[string]any{
		"buckets": buckets,
	})
	if errMarshal != nil {
		return data
	}
	return datatypes.JSON(updated)
}

func extractQuotaOAuthInfo(content datatypes.JSON, authStatus *quotapkg.AuthStatus) gin.H {
	var payload map[string]any
	if len(content) > 0 {
		if err := json.Unmarshal(content, &payload); err != nil {
			payload = nil
		}
	}

	candidates := collectAuthMetadataCandidates(payload)
	expiresAt, expiryTime, hasExpiry := findFirstTimeCandidate(candidates,
		"expired",
		"expire",
		"expires_at",
		"expiresAt",
		"expiry",
		"expires",
	)
	lastRefresh, _, hasLastRefresh := findFirstTimeCandidate(candidates,
		"last_refresh",
		"lastRefresh",
		"last_refreshed_at",
		"lastRefreshedAt",
	)
	hasRefreshToken := findFirstStringCandidate(candidates, "refresh_token", "refreshToken") != ""
	refreshStatus, refreshLabel := deriveOAuthRefreshStatus(authStatus, hasRefreshToken, expiryTime)

	if !hasExpiry && !hasLastRefresh && refreshStatus == "" {
		return nil
	}

	out := gin.H{
		"refresh_status": refreshStatus,
	}
	if refreshLabel != "" {
		out["refresh_status_label"] = refreshLabel
	}
	if hasExpiry && expiresAt != "" {
		out["expires_at"] = expiresAt
	}
	if hasLastRefresh && lastRefresh != "" {
		out["last_refresh"] = lastRefresh
	}
	if hasRefreshToken {
		out["has_refresh_token"] = true
	}
	return out
}

func collectAuthMetadataCandidates(payload map[string]any) []map[string]any {
	candidates := make([]map[string]any, 0, 12)
	appendMapCandidate(&candidates, payload)
	appendAuthMetadataNestedCandidates(&candidates, payload)
	return candidates
}

func appendAuthMetadataNestedCandidates(candidates *[]map[string]any, source map[string]any) {
	if source == nil {
		return
	}
	for _, key := range []string{"metadata", "attributes", "details", "token", "Token", "tokens", "oauth", "auth"} {
		appendMapCandidate(candidates, mapFromAny(source[key]))
	}
	for _, key := range []string{"metadata", "attributes", "details"} {
		nested := mapFromAny(source[key])
		if nested == nil {
			continue
		}
		for _, childKey := range []string{"token", "Token", "tokens", "oauth", "auth"} {
			appendMapCandidate(candidates, mapFromAny(nested[childKey]))
		}
	}
}

func findFirstStringCandidate(candidates []map[string]any, keys ...string) string {
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}
		for _, key := range keys {
			if value := scalarString(candidate[key]); value != "" {
				return value
			}
		}
	}
	return ""
}

func findFirstTimeCandidate(candidates []map[string]any, keys ...string) (string, time.Time, bool) {
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}
		for _, key := range keys {
			raw, ok := candidate[key]
			if !ok || raw == nil {
				continue
			}
			if ts, okParse := parseTimeCandidate(raw); okParse {
				ts = ts.UTC()
				return ts.Format(time.RFC3339), ts, true
			}
			if value := scalarString(raw); value != "" {
				return value, time.Time{}, true
			}
		}
	}
	return "", time.Time{}, false
}

func deriveOAuthRefreshStatus(authStatus *quotapkg.AuthStatus, hasRefreshToken bool, expiry time.Time) (string, string) {
	if authStatus != nil {
		if authStatus.NeedsRelogin || strings.EqualFold(strings.TrimSpace(authStatus.State), "needs_relogin") {
			return "needs_relogin", "Needs re-login"
		}
	}
	if !expiry.IsZero() && expiry.Before(time.Now().UTC()) {
		return "expired", "Expired"
	}
	if hasRefreshToken {
		return "active", "Active"
	}
	return "unknown", "Unknown"
}

func parseTimeCandidate(value any) (time.Time, bool) {
	switch typed := value.(type) {
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return time.Time{}, false
		}
		for _, layout := range []string{
			time.RFC3339,
			time.RFC3339Nano,
			"2006-01-02 15:04:05",
			"2006-01-02 15:04",
		} {
			if ts, err := time.Parse(layout, text); err == nil {
				return ts, true
			}
		}
		if unix, err := strconv.ParseInt(text, 10, 64); err == nil {
			return normalizeUnixTimestamp(unix), true
		}
	case float64:
		return normalizeUnixTimestamp(int64(typed)), true
	case float32:
		return normalizeUnixTimestamp(int64(typed)), true
	case int:
		return normalizeUnixTimestamp(int64(typed)), true
	case int64:
		return normalizeUnixTimestamp(typed), true
	case int32:
		return normalizeUnixTimestamp(int64(typed)), true
	case uint64:
		return normalizeUnixTimestamp(int64(typed)), true
	case uint32:
		return normalizeUnixTimestamp(int64(typed)), true
	case json.Number:
		if unix, err := typed.Int64(); err == nil {
			return normalizeUnixTimestamp(unix), true
		}
	}
	return time.Time{}, false
}

func normalizeUnixTimestamp(raw int64) time.Time {
	if raw > 1_000_000_000_000 {
		return time.UnixMilli(raw)
	}
	return time.Unix(raw, 0)
}

func scalarString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return strings.TrimSpace(typed.String())
	case float64:
		return strings.TrimSpace(strconv.FormatFloat(typed, 'f', -1, 64))
	case float32:
		return strings.TrimSpace(strconv.FormatFloat(float64(typed), 'f', -1, 64))
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case uint32:
		return strconv.FormatUint(uint64(typed), 10)
	default:
		return ""
	}
}

// extractCodexSubscription extracts subscription start/until dates from a codex
// auth's content JSON by decoding the embedded id_token JWT payload.
func extractCodexSubscription(authType string, content datatypes.JSON) gin.H {
	if !strings.Contains(strings.ToLower(authType), "codex") || len(content) == 0 {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil
	}
	result := gin.H{}
	for _, candidate := range collectCodexSubscriptionCandidates(payload) {
		assignFirstSubscriptionValue(result, "plan_type", candidate, []string{
			"chatgpt_plan_type",
			"plan_type",
			"planType",
			"subscription_plan_type",
			"subscriptionPlanType",
			"subscription_type",
			"subscriptionType",
			"plan",
			"tier",
		})
		assignFirstSubscriptionValue(result, "active_start", candidate, []string{
			"chatgpt_subscription_active_start",
			"subscription_active_start",
			"subscription_start",
			"subscriptionStart",
			"active_start",
			"activeStart",
			"current_period_start",
			"currentPeriodStart",
			"period_start",
			"periodStart",
			"start_date",
			"startDate",
		})
		assignFirstSubscriptionValue(result, "active_until", candidate, []string{
			"chatgpt_subscription_active_until",
			"subscription_active_until",
			"subscription_end",
			"subscriptionEnd",
			"active_until",
			"activeUntil",
			"renewal_date",
			"renewalDate",
			"next_renewal_date",
			"nextRenewalDate",
			"current_period_end",
			"currentPeriodEnd",
			"period_end",
			"periodEnd",
			"end_date",
			"endDate",
			"expires_at",
			"expiresAt",
			"expiration_date",
			"expirationDate",
			"expires",
		})
		if result["plan_type"] != nil && result["active_start"] != nil && result["active_until"] != nil {
			break
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func collectCodexSubscriptionCandidates(payload map[string]any) []map[string]any {
	candidates := make([]map[string]any, 0, 16)
	appendMapCandidate(&candidates, payload)
	appendNestedSubscriptionCandidates(&candidates, payload)
	if claims := extractCodexJWTClaims(payload); claims != nil {
		appendMapCandidate(&candidates, claims)
		authClaims := mapFromAny(claims["https://api.openai.com/auth"])
		appendMapCandidate(&candidates, authClaims)
		appendNestedSubscriptionCandidates(&candidates, claims)
		appendNestedSubscriptionCandidates(&candidates, authClaims)
	}
	return candidates
}

func appendNestedSubscriptionCandidates(candidates *[]map[string]any, source map[string]any) {
	if source == nil {
		return
	}
	containerKeys := []string{
		"subscription",
		"billing",
		"membership",
		"account",
		"plan",
		"profile",
		"user",
	}
	for _, key := range containerKeys {
		appendMapCandidate(candidates, mapFromAny(source[key]))
	}
	for _, key := range []string{"metadata", "attributes", "details"} {
		nested := mapFromAny(source[key])
		appendMapCandidate(candidates, nested)
		for _, containerKey := range containerKeys {
			appendMapCandidate(candidates, mapFromAny(nested[containerKey]))
		}
	}
}

func appendMapCandidate(candidates *[]map[string]any, candidate map[string]any) {
	if candidate == nil {
		return
	}
	*candidates = append(*candidates, candidate)
}

func assignFirstSubscriptionValue(result gin.H, field string, candidate map[string]any, keys []string) {
	if candidate == nil || result[field] != nil {
		return
	}
	if value := firstValueForKeys(candidate, keys); value != nil {
		result[field] = value
	}
}

func firstValueForKeys(candidate map[string]any, keys []string) any {
	if candidate == nil {
		return nil
	}
	for _, key := range keys {
		value, ok := candidate[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) == "" {
				continue
			}
		case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, bool:
		default:
			continue
		}
		return value
	}
	return nil
}

func extractCodexJWTClaims(payload map[string]any) map[string]any {
	if payload == nil {
		return nil
	}
	candidates := []any{
		payload["id_token"],
		payload["idToken"],
		payload["jwt"],
		payload["claims"],
		mapValue(payload, "metadata", "id_token"),
		mapValue(payload, "metadata", "idToken"),
		mapValue(payload, "metadata", "jwt"),
		mapValue(payload, "metadata", "claims"),
		mapValue(payload, "attributes", "id_token"),
		mapValue(payload, "attributes", "idToken"),
		mapValue(payload, "attributes", "jwt"),
		mapValue(payload, "attributes", "claims"),
		mapValue(payload, "tokens", "id_token"),
		mapValue(payload, "tokens", "idToken"),
		mapValue(payload, "oauth", "id_token"),
		mapValue(payload, "oauth", "idToken"),
		mapValue(payload, "auth", "id_token"),
		mapValue(payload, "auth", "idToken"),
	}
	for _, candidate := range candidates {
		if claims := decodeJWTValue(candidate); claims != nil {
			return claims
		}
	}
	return nil
}

func mapValue(payload map[string]any, mapKey, valueKey string) any {
	nested := mapFromAny(payload[mapKey])
	if nested == nil {
		return nil
	}
	return nested[valueKey]
}

func mapFromAny(value any) map[string]any {
	typed, _ := value.(map[string]any)
	return typed
}

func decodeJWTValue(value any) map[string]any {
	switch typed := value.(type) {
	case string:
		token := strings.TrimSpace(typed)
		if token == "" {
			return nil
		}
		return decodeJWTPayload(token)
	case map[string]any:
		return typed
	default:
		return nil
	}
}

// decodeJWTPayload extracts the payload section of a JWT as a map without
// verifying the signature. Returns nil if the token is malformed.
func decodeJWTPayload(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	data := parts[1]
	switch len(data) % 4 {
	case 2:
		data += "=="
	case 3:
		data += "="
	}
	decoded, err := base64.URLEncoding.DecodeString(data)
	if err != nil {
		return nil
	}
	var claims map[string]any
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return nil
	}
	return claims
}
