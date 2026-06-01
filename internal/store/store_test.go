package store

import (
	"context"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func TestGormAuthStoreListSkipsUnavailableAuths(t *testing.T) {
	db, errOpen := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open sqlite: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}); errMigrate != nil {
		t.Fatalf("migrate sqlite: %v", errMigrate)
	}

	now := time.Now().UTC()
	rows := []models.Auth{
		{
			Key:         "available-auth",
			Content:     datatypes.JSON([]byte(`{"type":"codex","email":"available@example.com"}`)),
			IsAvailable: true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			Key:         "unavailable-auth",
			Content:     datatypes.JSON([]byte(`{"type":"codex","email":"unavailable@example.com"}`)),
			IsAvailable: false,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}
	if errCreate := db.Create(&rows).Error; errCreate != nil {
		t.Fatalf("create auth rows: %v", errCreate)
	}
	if errUpdate := db.Model(&models.Auth{}).Where("key = ?", "unavailable-auth").Update("is_available", false).Error; errUpdate != nil {
		t.Fatalf("mark unavailable auth: %v", errUpdate)
	}

	manager := coreauth.NewManager(NewGormAuthStore(db), nil, nil)
	if errLoad := manager.Load(context.Background()); errLoad != nil {
		t.Fatalf("load manager: %v", errLoad)
	}
	if _, ok := manager.GetByID("available-auth"); !ok {
		t.Fatalf("expected available auth to load")
	}
	if auth, ok := manager.GetByID("unavailable-auth"); ok || auth != nil {
		t.Fatalf("expected unavailable auth not to load, got %+v", auth)
	}
}
