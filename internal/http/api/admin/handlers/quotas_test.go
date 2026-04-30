package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	quotapkg "github.com/router-for-me/CLIProxyAPIBusiness/internal/quota"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func openAdminQuotaTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_quota_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}, &models.Quota{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func mustMarshalJSON(t *testing.T, value any) []byte {
	t.Helper()

	payload, errMarshal := json.Marshal(value)
	if errMarshal != nil {
		t.Fatalf("marshal json: %v", errMarshal)
	}
	return payload
}

func buildTestJWT(t *testing.T, authClaims map[string]any) string {
	t.Helper()

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString(mustMarshalJSON(t, map[string]any{
		"https://api.openai.com/auth": authClaims,
	}))
	return header + "." + payload + ".sig"
}

func TestExtractCodexSubscriptionSupportsNestedMetadataIDToken(t *testing.T) {
	token := buildTestJWT(t, map[string]any{
		"chatgpt_plan_type":                 "plus",
		"chatgpt_subscription_active_start": "2026-04-01T00:00:00Z",
		"chatgpt_subscription_active_until": "2026-05-01T00:00:00Z",
	})

	content := datatypes.JSON(mustMarshalJSON(t, map[string]any{
		"metadata": map[string]any{
			"id_token": token,
		},
	}))

	got := extractCodexSubscription("codex", content)
	if got == nil {
		t.Fatal("extractCodexSubscription returned nil")
	}
	if got["plan_type"] != "plus" {
		t.Fatalf("plan_type = %v, want plus", got["plan_type"])
	}
	if got["active_start"] != "2026-04-01T00:00:00Z" {
		t.Fatalf("active_start = %v, want 2026-04-01T00:00:00Z", got["active_start"])
	}
	if got["active_until"] != "2026-05-01T00:00:00Z" {
		t.Fatalf("active_until = %v, want 2026-05-01T00:00:00Z", got["active_until"])
	}
}

func TestExtractCodexSubscriptionSupportsDirectSubscriptionObject(t *testing.T) {
	content := datatypes.JSON(mustMarshalJSON(t, map[string]any{
		"subscription": map[string]any{
			"planType":        "pro",
			"startDate":       "2026-04-15T00:00:00Z",
			"nextRenewalDate": "2026-05-15T00:00:00Z",
		},
	}))

	got := extractCodexSubscription("codex", content)
	if got == nil {
		t.Fatal("extractCodexSubscription returned nil")
	}
	if got["plan_type"] != "pro" {
		t.Fatalf("plan_type = %v, want pro", got["plan_type"])
	}
	if got["active_start"] != "2026-04-15T00:00:00Z" {
		t.Fatalf("active_start = %v, want 2026-04-15T00:00:00Z", got["active_start"])
	}
	if got["active_until"] != "2026-05-15T00:00:00Z" {
		t.Fatalf("active_until = %v, want 2026-05-15T00:00:00Z", got["active_until"])
	}
}

func TestExtractCodexSubscriptionSupportsCamelCaseIDToken(t *testing.T) {
	token := buildTestJWT(t, map[string]any{
		"chatgpt_plan_type":                 "plus",
		"chatgpt_subscription_active_start": "2026-04-01T00:00:00Z",
		"chatgpt_subscription_active_until": "2026-05-01T00:00:00Z",
	})

	content := datatypes.JSON(mustMarshalJSON(t, map[string]any{
		"metadata": map[string]any{
			"idToken": token,
		},
	}))

	got := extractCodexSubscription("codex", content)
	if got == nil {
		t.Fatal("extractCodexSubscription returned nil")
	}
	if got["plan_type"] != "plus" {
		t.Fatalf("plan_type = %v, want plus", got["plan_type"])
	}
	if got["active_start"] != "2026-04-01T00:00:00Z" {
		t.Fatalf("active_start = %v, want 2026-04-01T00:00:00Z", got["active_start"])
	}
	if got["active_until"] != "2026-05-01T00:00:00Z" {
		t.Fatalf("active_until = %v, want 2026-05-01T00:00:00Z", got["active_until"])
	}
}

func TestQuotaHandlerListIncludesSubscriptionFromTopLevelIDToken(t *testing.T) {
	db := openAdminQuotaTestDB(t)
	now := time.Date(2026, time.April, 20, 1, 25, 0, 0, time.UTC)
	token := buildTestJWT(t, map[string]any{
		"chatgpt_plan_type":                 "plus",
		"chatgpt_subscription_active_start": "2026-04-01T00:00:00Z",
		"chatgpt_subscription_active_until": "2026-05-01T00:00:00Z",
	})

	auth := models.Auth{
		Key:       "codex-example-plus.json",
		Content:   datatypes.JSON(mustMarshalJSON(t, map[string]any{"type": "codex", "id_token": token})),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&auth).Error; errCreate != nil {
		t.Fatalf("create auth: %v", errCreate)
	}

	quota := models.Quota{
		AuthID:    auth.ID,
		Type:      "codex",
		Data:      datatypes.JSON(mustMarshalJSON(t, map[string]any{"plan_type": "plus"})),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&quota).Error; errCreate != nil {
		t.Fatalf("create quota: %v", errCreate)
	}

	handler := NewQuotaHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/quotas?page=1&limit=12", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.List(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		Quotas []map[string]any `json:"quotas"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.Quotas) != 1 {
		t.Fatalf("quotas len = %d, want 1", len(response.Quotas))
	}

	subscription, ok := response.Quotas[0]["subscription"].(map[string]any)
	if !ok {
		t.Fatalf("subscription = %T, want map[string]any", response.Quotas[0]["subscription"])
	}
	if subscription["plan_type"] != "plus" {
		t.Fatalf("plan_type = %v, want plus", subscription["plan_type"])
	}
	if subscription["active_start"] != "2026-04-01T00:00:00Z" {
		t.Fatalf("active_start = %v, want 2026-04-01T00:00:00Z", subscription["active_start"])
	}
	if subscription["active_until"] != "2026-05-01T00:00:00Z" {
		t.Fatalf("active_until = %v, want 2026-05-01T00:00:00Z", subscription["active_until"])
	}
}

func TestQuotaHandlerListIncludesAuthStatusAndUnwrappedPayload(t *testing.T) {
	db := openAdminQuotaTestDB(t)
	now := time.Date(2026, time.April, 24, 12, 0, 0, 0, time.UTC)

	auth := models.Auth{
		Key:         "gemini-cli-account.json",
		Content:     datatypes.JSON(mustMarshalJSON(t, map[string]any{"type": "gemini-cli"})),
		IsAvailable: false,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := db.Create(&auth).Error; errCreate != nil {
		t.Fatalf("create auth: %v", errCreate)
	}

	storedQuota, errMarshal := quotapkg.MarshalStoredQuotaData([]byte(`{"remaining":12}`), &quotapkg.AuthStatus{
		State:        "needs_relogin",
		Message:      "Auth token expired, need re-login",
		Detail:       "quota request failed",
		CheckedAt:    now,
		HTTPStatus:   http.StatusUnauthorized,
		NeedsRelogin: true,
	})
	if errMarshal != nil {
		t.Fatalf("marshal stored quota: %v", errMarshal)
	}

	quota := models.Quota{
		AuthID:    auth.ID,
		Type:      "gemini-cli",
		Data:      datatypes.JSON(storedQuota),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&quota).Error; errCreate != nil {
		t.Fatalf("create quota: %v", errCreate)
	}

	handler := NewQuotaHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/quotas?page=1&limit=12", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.List(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		Quotas []map[string]any `json:"quotas"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.Quotas) != 1 {
		t.Fatalf("quotas len = %d, want 1", len(response.Quotas))
	}

	data, ok := response.Quotas[0]["data"].(map[string]any)
	if !ok {
		t.Fatalf("data = %T, want map[string]any", response.Quotas[0]["data"])
	}
	if data["remaining"] != float64(12) {
		t.Fatalf("remaining = %v, want 12", data["remaining"])
	}

	authStatus, ok := response.Quotas[0]["auth_status"].(map[string]any)
	if !ok {
		t.Fatalf("auth_status = %T, want map[string]any", response.Quotas[0]["auth_status"])
	}
	if authStatus["message"] != "Auth token expired, need re-login" {
		t.Fatalf("message = %v, want relogin message", authStatus["message"])
	}
	if authStatus["needs_relogin"] != true {
		t.Fatalf("needs_relogin = %v, want true", authStatus["needs_relogin"])
	}
}

func TestQuotaHandlerListIncludesOAuthInfoSummary(t *testing.T) {
	db := openAdminQuotaTestDB(t)
	now := time.Date(2026, time.April, 24, 12, 0, 0, 0, time.UTC)
	expiresAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second).Format(time.RFC3339)

	auth := models.Auth{
		Key: "codex-refreshing.json",
		Content: datatypes.JSON(mustMarshalJSON(t, map[string]any{
			"type":          "codex",
			"refresh_token": "refresh-token",
			"last_refresh":  "2026-04-24T10:30:00Z",
			"expired":       expiresAt,
		})),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&auth).Error; errCreate != nil {
		t.Fatalf("create auth: %v", errCreate)
	}

	quota := models.Quota{
		AuthID:    auth.ID,
		Type:      "codex",
		Data:      datatypes.JSON(mustMarshalJSON(t, map[string]any{"remaining": 7})),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&quota).Error; errCreate != nil {
		t.Fatalf("create quota: %v", errCreate)
	}

	handler := NewQuotaHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/quotas?page=1&limit=10", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.List(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		Quotas []map[string]any `json:"quotas"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.Quotas) != 1 {
		t.Fatalf("quotas len = %d, want 1", len(response.Quotas))
	}

	oauthInfo, ok := response.Quotas[0]["oauth"].(map[string]any)
	if !ok {
		t.Fatalf("oauth = %T, want map[string]any", response.Quotas[0]["oauth"])
	}
	if oauthInfo["refresh_status"] != "active" {
		t.Fatalf("refresh_status = %v, want active", oauthInfo["refresh_status"])
	}
	if oauthInfo["refresh_status_label"] != "Active" {
		t.Fatalf("refresh_status_label = %v, want Active", oauthInfo["refresh_status_label"])
	}
	if oauthInfo["last_refresh"] != "2026-04-24T10:30:00Z" {
		t.Fatalf("last_refresh = %v, want 2026-04-24T10:30:00Z", oauthInfo["last_refresh"])
	}
	if oauthInfo["expires_at"] != expiresAt {
		t.Fatalf("expires_at = %v, want %s", oauthInfo["expires_at"], expiresAt)
	}
	if oauthInfo["has_refresh_token"] != true {
		t.Fatalf("has_refresh_token = %v, want true", oauthInfo["has_refresh_token"])
	}
}

func TestQuotaHandlerListIncludesNestedOAuthInfoSummary(t *testing.T) {
	db := openAdminQuotaTestDB(t)
	now := time.Date(2026, time.April, 24, 12, 0, 0, 0, time.UTC)

	auth := models.Auth{
		Key: "gemini-nested.json",
		Content: datatypes.JSON(mustMarshalJSON(t, map[string]any{
			"type":         "gemini-cli",
			"last_refresh": "2026-04-24T11:00:00Z",
			"token": map[string]any{
				"refresh_token": "nested-refresh",
				"expiry":        "2026-05-01T15:45:00Z",
			},
		})),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&auth).Error; errCreate != nil {
		t.Fatalf("create auth: %v", errCreate)
	}

	quota := models.Quota{
		AuthID:    auth.ID,
		Type:      "gemini-cli",
		Data:      datatypes.JSON(mustMarshalJSON(t, map[string]any{"remaining": 3})),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&quota).Error; errCreate != nil {
		t.Fatalf("create quota: %v", errCreate)
	}

	handler := NewQuotaHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/quotas?page=1&limit=10", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.List(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		Quotas []map[string]any `json:"quotas"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.Quotas) != 1 {
		t.Fatalf("quotas len = %d, want 1", len(response.Quotas))
	}

	oauthInfo, ok := response.Quotas[0]["oauth"].(map[string]any)
	if !ok {
		t.Fatalf("oauth = %T, want map[string]any", response.Quotas[0]["oauth"])
	}
	if oauthInfo["expires_at"] != "2026-05-01T15:45:00Z" {
		t.Fatalf("expires_at = %v, want 2026-05-01T15:45:00Z", oauthInfo["expires_at"])
	}
	if oauthInfo["last_refresh"] != "2026-04-24T11:00:00Z" {
		t.Fatalf("last_refresh = %v, want 2026-04-24T11:00:00Z", oauthInfo["last_refresh"])
	}
}
