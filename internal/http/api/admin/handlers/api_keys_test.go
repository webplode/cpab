package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

func openAdminAPIKeysTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_api_keys_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.APIKey{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func TestAdminListByUserHidesFullKey(t *testing.T) {
	db := openAdminAPIKeysTestDB(t)
	userID := uint64(5)
	row := models.APIKey{
		UserID:    &userID,
		Name:      "primary",
		APIKey:    "cpab-secret-token-1234",
		Active:    true,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create api key: %v", errCreate)
	}

	handler := NewAPIKeyHandler(db)
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v0/admin/users/%d/api-keys", userID), nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", userID)}}

	handler.ListByUser(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		APIKeys []map[string]any `json:"api_keys"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.APIKeys) != 1 {
		t.Fatalf("api_keys len = %d, want 1", len(response.APIKeys))
	}
	if _, ok := response.APIKeys[0]["key"]; ok {
		t.Fatalf("list response leaked full key: %+v", response.APIKeys[0])
	}
	if response.APIKeys[0]["key_prefix"] == "" {
		t.Fatalf("key_prefix = %v, want masked prefix", response.APIKeys[0]["key_prefix"])
	}
}
