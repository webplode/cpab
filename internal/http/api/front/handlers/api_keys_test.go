package handlers

import (
	"bytes"
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

func openFrontAPIKeysTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:front_api_keys_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.APIKey{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func TestFrontListAPIKeysHidesFullKey(t *testing.T) {
	db := openFrontAPIKeysTestDB(t)
	userID := uint64(7)
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
	req := httptest.NewRequest(http.MethodGet, "/v0/front/api-keys", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Set("userID", userID)

	handler.List(ctx)

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

func TestFrontCreateAPIKeyReturnsWarningWithOneTimeToken(t *testing.T) {
	db := openFrontAPIKeysTestDB(t)
	handler := NewAPIKeyHandler(db)

	req := httptest.NewRequest(http.MethodPost, "/v0/front/api-keys", bytes.NewBufferString(`{"name":"primary"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Set("userID", uint64(11))

	handler.Create(ctx)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusCreated)
	}

	var response map[string]any
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if response["token"] == "" {
		t.Fatalf("token = %v, want non-empty", response["token"])
	}
	if response["warning"] != apiKeyRevealWarning {
		t.Fatalf("warning = %v, want %q", response["warning"], apiKeyRevealWarning)
	}
}
