package quota

import (
	"context"
	"errors"
	"os"
	"path/filepath"
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

func TestEvictInvalidatedAuthDeletesRecordAndFile(t *testing.T) {
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
		t.Fatalf("expected auth %s to exist in manager before eviction", authID)
	}

	tempDir := t.TempDir()
	previousWD, errGetwd := os.Getwd()
	if errGetwd != nil {
		t.Fatalf("getwd: %v", errGetwd)
	}
	if errChdir := os.Chdir(tempDir); errChdir != nil {
		t.Fatalf("chdir temp dir: %v", errChdir)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})

	authFilePath := filepath.Join(tempDir, authID)
	if errWrite := os.WriteFile(authFilePath, []byte(`{"token":"x"}`), 0o600); errWrite != nil {
		t.Fatalf("write auth file: %v", errWrite)
	}

	poller := NewPoller(db, manager)
	if poller == nil {
		t.Fatalf("expected poller to be initialized")
	}

	poller.evictInvalidatedAuth(context.Background(), &coreauth.Auth{
		ID:       authID,
		Provider: "codex",
		Attributes: map[string]string{
			"path": authFilePath,
		},
	}, authRowInfo{ID: authRow.ID, Type: "codex"}, "codex")

	var remainingAuth models.Auth
	errFindAuth := db.Where("id = ?", authRow.ID).First(&remainingAuth).Error
	if !errors.Is(errFindAuth, gorm.ErrRecordNotFound) {
		t.Fatalf("expected auth row to be deleted, got err=%v", errFindAuth)
	}

	var remainingQuota int64
	if errCount := db.Model(&models.Quota{}).Where("auth_id = ?", authRow.ID).Count(&remainingQuota).Error; errCount != nil {
		t.Fatalf("count quota rows: %v", errCount)
	}
	if remainingQuota != 0 {
		t.Fatalf("expected quota rows to be deleted, got %d", remainingQuota)
	}

	if _, ok := manager.GetByID(authID); ok {
		t.Fatalf("expected auth %s to be removed from manager after refresh", authID)
	}
	if _, errStat := os.Stat(authFilePath); !errors.Is(errStat, os.ErrNotExist) {
		t.Fatalf("expected auth file to be removed, stat err=%v", errStat)
	}
}
