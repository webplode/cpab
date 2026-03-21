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
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/config"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/security"
	"gorm.io/gorm"
)

func openAdminVersionTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_version_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Admin{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func runVersionRequest(t *testing.T, handler *VersionHandler, authHeader string) (int, map[string]any) {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/v0/version", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.GetVersion(ctx)

	var response map[string]any
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	return recorder.Code, response
}

func setVersionCacheForTest(t *testing.T, version, releaseURL string) {
	t.Helper()

	globalVersionCache.mu.Lock()
	globalVersionCache.latestVersion = version
	globalVersionCache.releaseURL = releaseURL
	globalVersionCache.fetchedAt = time.Now()
	globalVersionCache.hasError = false
	globalVersionCache.mu.Unlock()

	t.Cleanup(func() {
		globalVersionCache.mu.Lock()
		globalVersionCache.latestVersion = ""
		globalVersionCache.releaseURL = ""
		globalVersionCache.fetchedAt = time.Time{}
		globalVersionCache.hasError = false
		globalVersionCache.mu.Unlock()
	})
}

func TestVersionHandlerReturnsPublicStatusWithoutAdminToken(t *testing.T) {
	handler := NewVersionHandler(openAdminVersionTestDB(t), config.JWTConfig{Secret: "test-secret", Expiry: time.Hour})

	status, response := runVersionRequest(t, handler, "")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if got := response["status"]; got != "ok" {
		t.Fatalf("status field = %v, want ok", got)
	}
	if _, ok := response["current_version"]; ok {
		t.Fatalf("response leaked version details: %+v", response)
	}
}

func TestVersionHandlerReturnsFullDetailsForAuthenticatedAdmin(t *testing.T) {
	db := openAdminVersionTestDB(t)
	admin := models.Admin{
		Username: "root",
		Password: "hashed",
		Active:   true,
	}
	if errCreate := db.Create(&admin).Error; errCreate != nil {
		t.Fatalf("create admin: %v", errCreate)
	}

	originalVersion := buildinfo.Version
	originalCommit := buildinfo.Commit
	originalBuildDate := buildinfo.BuildDate
	buildinfo.Version = "v1.2.3"
	buildinfo.Commit = "abc123"
	buildinfo.BuildDate = "2026-03-16"
	t.Cleanup(func() {
		buildinfo.Version = originalVersion
		buildinfo.Commit = originalCommit
		buildinfo.BuildDate = originalBuildDate
	})

	setVersionCacheForTest(t, "v1.2.4", "https://example.com/release")

	jwtCfg := config.JWTConfig{Secret: "test-secret", Expiry: time.Hour}
	token, errToken := security.GenerateAdminToken(jwtCfg.Secret, admin.ID, admin.Username, jwtCfg.Expiry)
	if errToken != nil {
		t.Fatalf("generate admin token: %v", errToken)
	}

	handler := NewVersionHandler(db, jwtCfg)
	status, response := runVersionRequest(t, handler, "Bearer "+token)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if got := response["current_version"]; got != buildinfo.Version {
		t.Fatalf("current_version = %v, want %q", got, buildinfo.Version)
	}
	if got := response["commit"]; got != buildinfo.Commit {
		t.Fatalf("commit = %v, want %q", got, buildinfo.Commit)
	}
	if got := response["build_date"]; got != buildinfo.BuildDate {
		t.Fatalf("build_date = %v, want %q", got, buildinfo.BuildDate)
	}
	if got := response["latest_version"]; got != "v1.2.4" {
		t.Fatalf("latest_version = %v, want v1.2.4", got)
	}
	if got := response["release_url"]; got != "https://example.com/release" {
		t.Fatalf("release_url = %v, want cached URL", got)
	}
	if _, ok := response["status"]; ok {
		t.Fatalf("response unexpectedly used public payload: %+v", response)
	}
}
