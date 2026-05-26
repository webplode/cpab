package quota

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
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

func TestMarkQuotaPollFailedKeepsQuotaAndDoesNotRequireRelogin(t *testing.T) {
	db, errOpen := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open sqlite: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}, &models.Quota{}); errMigrate != nil {
		t.Fatalf("migrate sqlite: %v", errMigrate)
	}

	now := time.Now().UTC()
	authID := "codex-proxy-timeout-test"
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

	poller := NewPoller(db, manager)
	if poller == nil {
		t.Fatalf("expected poller to be initialized")
	}

	detail := "proxyconnect tcp: dial tcp 103.183.115.82:50523: i/o timeout"
	poller.markQuotaPollFailed(
		context.Background(),
		&coreauth.Auth{
			ID:       authID,
			Provider: "codex",
		},
		authRowInfo{ID: authRow.ID, Type: "codex", IsAvailable: true},
		"codex",
		0,
		detail,
	)

	var updatedAuth models.Auth
	if errFindAuth := db.Where("id = ?", authRow.ID).First(&updatedAuth).Error; errFindAuth != nil {
		t.Fatalf("expected auth row to remain, got err=%v", errFindAuth)
	}
	if !updatedAuth.IsAvailable {
		t.Fatalf("expected auth row to remain available")
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
	if status.NeedsRelogin {
		t.Fatalf("expected needs_relogin to be false")
	}
	if status.State != authStatusPollFailed {
		t.Fatalf("state = %q, want %q", status.State, authStatusPollFailed)
	}
	if status.Message != quotaPollFailedMessage {
		t.Fatalf("message = %q, want %q", status.Message, quotaPollFailedMessage)
	}
	if status.HTTPStatus != 0 {
		t.Fatalf("http_status = %d, want 0", status.HTTPStatus)
	}
	if status.Detail != detail {
		t.Fatalf("detail = %q, want %q", status.Detail, detail)
	}

	activeAuth, ok := manager.GetByID(authID)
	if !ok || activeAuth == nil {
		t.Fatalf("expected auth %s to remain in manager", authID)
	}
	if activeAuth.Disabled {
		t.Fatalf("expected auth %s to remain enabled in manager", authID)
	}
}

type codexPollTestExecutor struct {
	httpErr error
}

func (e *codexPollTestExecutor) Identifier() string { return "codex" }

func (e *codexPollTestExecutor) PrepareRequest(*http.Request, *coreauth.Auth) error {
	return nil
}

func (e *codexPollTestExecutor) Execute(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *codexPollTestExecutor) ExecuteStream(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}

func (e *codexPollTestExecutor) Refresh(_ context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	return auth, nil
}

func (e *codexPollTestExecutor) CountTokens(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *codexPollTestExecutor) HttpRequest(context.Context, *coreauth.Auth, *http.Request) (*http.Response, error) {
	return nil, e.httpErr
}

func TestPollCodexTransportErrorStoresPollFailedStatus(t *testing.T) {
	db, errOpen := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open sqlite: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}, &models.Quota{}); errMigrate != nil {
		t.Fatalf("migrate sqlite: %v", errMigrate)
	}

	now := time.Now().UTC()
	authRow := models.Auth{
		Key:         "codex-poll-transport-error-test",
		Content:     datatypes.JSON([]byte(`{"type":"codex","account_id":"acct-test","email":"test@example.com"}`)),
		IsAvailable: true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := db.Create(&authRow).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}

	authStore := store.NewGormAuthStore(db)
	manager := coreauth.NewManager(authStore, nil, nil)
	manager.RegisterExecutor(&codexPollTestExecutor{
		httpErr: errors.New("proxyconnect tcp: dial tcp 103.183.115.82:50523: i/o timeout"),
	})
	if errLoad := manager.Load(context.Background()); errLoad != nil {
		t.Fatalf("load auth manager: %v", errLoad)
	}

	poller := NewPoller(db, manager)
	if poller == nil {
		t.Fatalf("expected poller to be initialized")
	}
	poller.poll(context.Background())

	var quotaRow models.Quota
	if errFind := db.Where("auth_id = ? AND type = ?", authRow.ID, "codex").First(&quotaRow).Error; errFind != nil {
		t.Fatalf("find quota status: %v", errFind)
	}
	_, status := UnwrapStoredQuotaData(quotaRow.Data)
	if status == nil {
		t.Fatalf("expected auth status")
	}
	if status.NeedsRelogin {
		t.Fatalf("expected needs_relogin to be false")
	}
	if status.State != authStatusPollFailed {
		t.Fatalf("state = %q, want %q", status.State, authStatusPollFailed)
	}

	var updatedAuth models.Auth
	if errFindAuth := db.Where("id = ?", authRow.ID).First(&updatedAuth).Error; errFindAuth != nil {
		t.Fatalf("find auth row: %v", errFindAuth)
	}
	if !updatedAuth.IsAvailable {
		t.Fatalf("expected auth row to remain available")
	}
}

type kiroPollTestExecutor struct {
	refreshCalls int
}

func (e *kiroPollTestExecutor) Identifier() string { return "kiro" }

func (e *kiroPollTestExecutor) Execute(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *kiroPollTestExecutor) ExecuteStream(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}

func (e *kiroPollTestExecutor) Refresh(_ context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	e.refreshCalls++
	updated := auth.Clone()
	if updated.Metadata == nil {
		updated.Metadata = make(map[string]any)
	}
	updated.Metadata["access_token"] = "access-new"
	updated.Metadata["refresh_token"] = "refresh-new"
	updated.Metadata["expires_at"] = time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	return updated, nil
}

func (e *kiroPollTestExecutor) CountTokens(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *kiroPollTestExecutor) HttpRequest(context.Context, *coreauth.Auth, *http.Request) (*http.Response, error) {
	return nil, nil
}

func TestPollRefreshesKiroAuthAndStoresHealthyStatus(t *testing.T) {
	db, errOpen := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open sqlite: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}, &models.Quota{}); errMigrate != nil {
		t.Fatalf("migrate sqlite: %v", errMigrate)
	}

	now := time.Now().UTC()
	authRow := models.Auth{
		Key: "kiro-poll-test",
		Content: datatypes.JSON([]byte(`{
			"type":"kiro",
			"label":"Kiro",
			"refresh_token":"refresh-old",
			"access_token":"access-old",
			"expires_at":"2000-01-01T00:00:00Z",
			"region":"us-east-1"
		}`)),
		IsAvailable: true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := db.Create(&authRow).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}

	authStore := store.NewGormAuthStore(db)
	manager := coreauth.NewManager(authStore, nil, nil)
	executor := &kiroPollTestExecutor{}
	manager.RegisterExecutor(executor)
	if errLoad := manager.Load(context.Background()); errLoad != nil {
		t.Fatalf("load auth manager: %v", errLoad)
	}

	poller := NewPoller(db, manager)
	if poller == nil {
		t.Fatalf("expected poller to be initialized")
	}
	poller.poll(context.Background())

	if executor.refreshCalls != 1 {
		t.Fatalf("refreshCalls = %d, want 1", executor.refreshCalls)
	}
	updatedAuth, ok := manager.GetByID(authRow.Key)
	if !ok || updatedAuth == nil {
		t.Fatalf("expected refreshed auth in manager")
	}
	if updatedAuth.Metadata["access_token"] != "access-new" || updatedAuth.Metadata["refresh_token"] != "refresh-new" {
		t.Fatalf("updated metadata = %+v", updatedAuth.Metadata)
	}

	var quotaRow models.Quota
	if errFind := db.Where("auth_id = ? AND type = ?", authRow.ID, "kiro").First(&quotaRow).Error; errFind != nil {
		t.Fatalf("find quota status: %v", errFind)
	}
	_, status := UnwrapStoredQuotaData(quotaRow.Data)
	if status == nil {
		t.Fatalf("expected kiro auth status")
	}
	if status.State != authStatusHealthy || status.NeedsRelogin {
		t.Fatalf("status = %+v, want healthy", status)
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
