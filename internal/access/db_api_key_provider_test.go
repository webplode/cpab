package access

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v6/sdk/access"
	"gorm.io/gorm"
)

func openDBAPIKeyProviderTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:db_api_key_provider_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.User{}, &models.APIKey{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func newDBAPIKeyProviderForPathTest(t *testing.T) *DBAPIKeyProvider {
	t.Helper()
	return &DBAPIKeyProvider{
		db:                 openDBAPIKeyProviderTestDB(t),
		name:               ProviderTypeDBAPIKey,
		header:             "Authorization",
		scheme:             "Bearer",
		allowXAPIKey:       true,
		bypassPathPrefixes: []string{"/healthz", "/v0/management"},
	}
}

func TestDBAPIKeyProviderAuthenticateSkipsUnprotectedPath(t *testing.T) {
	provider := newDBAPIKeyProviderForPathTest(t)
	req := httptest.NewRequest("GET", "/assets/app.js", nil)

	result, authErr := provider.Authenticate(context.Background(), req)

	if authErr != nil {
		t.Fatalf("expected nil authErr, got %v", authErr)
	}
	if result != nil {
		t.Fatalf("expected nil result")
	}
}

func TestDBAPIKeyProviderAuthenticateSkipsPrefixBoundaryPath(t *testing.T) {
	provider := newDBAPIKeyProviderForPathTest(t)
	req := httptest.NewRequest("GET", "/v10/models", nil)

	result, authErr := provider.Authenticate(context.Background(), req)

	if authErr != nil {
		t.Fatalf("expected nil authErr, got %v", authErr)
	}
	if result != nil {
		t.Fatalf("expected nil result")
	}
}

func TestDBAPIKeyProviderAuthenticateRequiresAuthOnCLIProxyPath(t *testing.T) {
	provider := newDBAPIKeyProviderForPathTest(t)
	req := httptest.NewRequest("GET", "/v1/models", nil)

	_, authErr := provider.Authenticate(context.Background(), req)

	if !sdkaccess.IsAuthErrorCode(authErr, sdkaccess.AuthErrorCodeNoCredentials) {
		t.Fatalf("expected no_credentials auth error, got %v", authErr)
	}
}

func TestDBAPIKeyProviderAuthenticateRejectsExpiredAPIKey(t *testing.T) {
	provider := newDBAPIKeyProviderForPathTest(t)
	expiresAt := time.Now().UTC().Add(-time.Minute)
	createDBAPIKeyProviderTestAPIKey(t, provider.db, "expired-key", &expiresAt)

	req := httptest.NewRequest("GET", "/v1/models", nil)
	req.Header.Set("Authorization", "Bearer expired-key")

	result, authErr := provider.Authenticate(context.Background(), req)

	if result != nil {
		t.Fatalf("expected nil result for expired key")
	}
	if !sdkaccess.IsAuthErrorCode(authErr, sdkaccess.AuthErrorCodeInvalidCredential) {
		t.Fatalf("expected invalid_credential auth error, got %v", authErr)
	}
}

func TestDBAPIKeyProviderAuthenticateAcceptsFutureExpiryAPIKey(t *testing.T) {
	provider := newDBAPIKeyProviderForPathTest(t)
	expiresAt := time.Now().UTC().Add(time.Hour)
	apiKey := createDBAPIKeyProviderTestAPIKey(t, provider.db, "future-key", &expiresAt)

	req := httptest.NewRequest("GET", "/v1/models", nil)
	req.Header.Set("Authorization", "Bearer future-key")

	result, authErr := provider.Authenticate(context.Background(), req)

	if authErr != nil {
		t.Fatalf("expected nil authErr, got %v", authErr)
	}
	if result == nil {
		t.Fatalf("expected auth result for non-expired key")
	}
	if got := result.Principal; got != fmt.Sprintf("%d", apiKey.ID) {
		t.Fatalf("expected principal %d, got %s", apiKey.ID, got)
	}
}

func TestDBAPIKeyProviderAuthenticateAcceptsNonExpiringAPIKey(t *testing.T) {
	provider := newDBAPIKeyProviderForPathTest(t)
	apiKey := createDBAPIKeyProviderTestAPIKey(t, provider.db, "no-expiry-key", nil)

	req := httptest.NewRequest("GET", "/v1/models", nil)
	req.Header.Set("Authorization", "Bearer no-expiry-key")

	result, authErr := provider.Authenticate(context.Background(), req)

	if authErr != nil {
		t.Fatalf("expected nil authErr, got %v", authErr)
	}
	if result == nil {
		t.Fatalf("expected auth result for non-expiring key")
	}
	if got := result.Principal; got != fmt.Sprintf("%d", apiKey.ID) {
		t.Fatalf("expected principal %d, got %s", apiKey.ID, got)
	}
}

func createDBAPIKeyProviderTestAPIKey(t *testing.T, db *gorm.DB, token string, expiresAt *time.Time) models.APIKey {
	t.Helper()

	apiKey := models.APIKey{
		Name:      token,
		APIKey:    token,
		IsAdmin:   true,
		Active:    true,
		ExpiresAt: expiresAt,
	}
	if errCreate := db.Create(&apiKey).Error; errCreate != nil {
		t.Fatalf("create api key: %v", errCreate)
	}
	return apiKey
}
