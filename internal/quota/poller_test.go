package quota

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/store"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func TestIsTokenInvalidatedResponse(t *testing.T) {
	t.Parallel()

	valid := []byte(`{"error":{"message":"Your authentication token has been invalidated. Please try signing in again.","type":"invalid_request_error","code":"token_invalidated","param":null},"status":401}`)
	if !isTokenInvalidatedResponse(401, valid) {
		t.Fatalf("expected token_invalidated payload to be detected")
	}

	notInvalidated := []byte(`{"error":{"code":"invalid_api_key"},"status":401}`)
	if isTokenInvalidatedResponse(401, notInvalidated) {
		t.Fatalf("expected non-token-invalidated payload to be ignored")
	}

	if isTokenInvalidatedResponse(500, valid) {
		t.Fatalf("expected non-401 status to be ignored")
	}
}

func TestMarkAuthNeedsReloginKeepsQuotaAndDisablesAuth(t *testing.T) {
	db, errOpen := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open sqlite: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}, &models.Quota{}); errMigrate != nil {
		t.Fatalf("migrate sqlite: %v", errMigrate)
	}

	now := time.Now().UTC()
	authID := "codex-token-invalidated-test"
	authRow := models.Auth{
		Key:         authID,
		Content:     datatypes.JSON([]byte(`{"type":"codex","email":"test@example.com"}`)),
		IsAvailable: true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := db.Create(&authRow).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}
	quotaRow := models.Quota{
		AuthID:    authRow.ID,
		Type:      "codex",
		Data:      datatypes.JSON([]byte(`{"ok":true}`)),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if errCreate := db.Create(&quotaRow).Error; errCreate != nil {
		t.Fatalf("create quota row: %v", errCreate)
	}

	authStore := store.NewGormAuthStore(db)
	manager := coreauth.NewManager(authStore, nil, nil)
	if errLoad := manager.Load(context.Background()); errLoad != nil {
		t.Fatalf("load auth manager: %v", errLoad)
	}
	if _, ok := manager.GetByID(authID); !ok {
		t.Fatalf("expected auth %s to exist in manager before relogin mark", authID)
	}

	poller := NewPoller(db, manager)
	if poller == nil {
		t.Fatalf("expected poller to be initialized")
	}

	poller.markAuthNeedsRelogin(
		context.Background(),
		&coreauth.Auth{
			ID:       authID,
			Provider: "codex",
		},
		authRowInfo{ID: authRow.ID, Type: "codex", IsAvailable: true},
		"codex",
		401,
		`{"error":{"code":"token_invalidated"}}`,
		true,
	)

	var updatedAuth models.Auth
	if errFindAuth := db.Where("id = ?", authRow.ID).First(&updatedAuth).Error; errFindAuth != nil {
		t.Fatalf("expected auth row to remain, got err=%v", errFindAuth)
	}
	if updatedAuth.IsAvailable {
		t.Fatalf("expected auth row to be marked unavailable")
	}

	var updatedQuota models.Quota
	if errFindQuota := db.Where("auth_id = ?", authRow.ID).First(&updatedQuota).Error; errFindQuota != nil {
		t.Fatalf("expected quota row to remain, got err=%v", errFindQuota)
	}

	payload, status := UnwrapStoredQuotaData(updatedQuota.Data)
	if string(payload) != `{"ok":true}` {
		t.Fatalf("payload = %s, want %s", string(payload), `{"ok":true}`)
	}
	if status == nil {
		t.Fatalf("expected auth status to be present")
	}
	if !status.NeedsRelogin {
		t.Fatalf("expected needs_relogin to be true")
	}
	if status.Message != authReloginMessage {
		t.Fatalf("message = %q, want %q", status.Message, authReloginMessage)
	}
	if status.HTTPStatus != 401 {
		t.Fatalf("http_status = %d, want 401", status.HTTPStatus)
	}

	disabledAuth, ok := manager.GetByID(authID)
	if !ok || disabledAuth == nil {
		t.Fatalf("expected auth %s to remain in manager", authID)
	}
	if !disabledAuth.Disabled {
		t.Fatalf("expected auth %s to be disabled in manager", authID)
	}
}

func TestUnwrapStoredQuotaDataReturnsLegacyPayload(t *testing.T) {
	payload := datatypes.JSON([]byte(`{"remaining":42}`))

	gotPayload, gotStatus := UnwrapStoredQuotaData(payload)
	if gotStatus != nil {
		t.Fatalf("expected legacy payload to have no auth status")
	}
	if string(gotPayload) != string(payload) {
		t.Fatalf("payload = %s, want %s", string(gotPayload), string(payload))
	}
}

func TestMarshalStoredQuotaIncludesAuthStatus(t *testing.T) {
	now := time.Date(2026, time.April, 24, 10, 30, 0, 0, time.UTC)
	stored, errMarshal := marshalStoredQuota([]byte(`{"used":10}`), needsReloginAuthStatus(now, 500, "gateway timeout"))
	if errMarshal != nil {
		t.Fatalf("marshalStoredQuota: %v", errMarshal)
	}

	var decoded map[string]any
	if errUnmarshal := json.Unmarshal(stored, &decoded); errUnmarshal != nil {
		t.Fatalf("unmarshal stored payload: %v", errUnmarshal)
	}
	if decoded[quotaEnvelopePayloadKey] == nil {
		t.Fatalf("expected %s to be present", quotaEnvelopePayloadKey)
	}
	if decoded[quotaEnvelopeAuthStatusKey] == nil {
		t.Fatalf("expected %s to be present", quotaEnvelopeAuthStatusKey)
	}
}
