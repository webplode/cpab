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
	"github.com/golang-jwt/jwt/v5"
	"github.com/pquerna/otp/totp"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/config"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/security"
	"gorm.io/gorm"
)

type adminLoginPrepareResponse struct {
	MFAEnabled     bool `json:"mfa_enabled"`
	TOTPEnabled    bool `json:"totp_enabled"`
	PasskeyEnabled bool `json:"passkey_enabled"`
}

type adminAuthResponse struct {
	Error string `json:"error"`
	Token string `json:"token"`
}

func openAdminLoginPrepareTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_login_prepare_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Admin{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func runAdminLoginPrepare(t *testing.T, handler *AuthHandler, username string) (int, adminLoginPrepareResponse) {
	t.Helper()

	originalDelay := loginPrepareDelay
	loginPrepareDelay = func() {}
	t.Cleanup(func() {
		loginPrepareDelay = originalDelay
	})

	body := bytes.NewBufferString(fmt.Sprintf(`{"username":%q}`, username))
	req := httptest.NewRequest(http.MethodPost, "/v0/admin/login/prepare", body)
	req.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.LoginPrepare(ctx)

	var response adminLoginPrepareResponse
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}

	return recorder.Code, response
}

func newAdminMFATestHandler(t *testing.T) (*AuthHandler, *gorm.DB) {
	t.Helper()

	db := openAdminLoginPrepareTestDB(t)
	return &AuthHandler{
		db: db,
		jwtCfg: config.JWTConfig{
			Secret: "admin-mfa-test-secret",
			Expiry: time.Hour,
		},
	}, db
}

func runAdminAuthRequest(t *testing.T, target string, body string, invoke func(*gin.Context)) (int, adminAuthResponse) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, target, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	invoke(ctx)

	var response adminAuthResponse
	if len(recorder.Body.Bytes()) > 0 {
		if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
			t.Fatalf("decode response: %v", errDecode)
		}
	}
	return recorder.Code, response
}

func generateAdminTOTPSecret(t *testing.T, accountName string) string {
	t.Helper()

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "CLIProxyAPIBusiness",
		AccountName: accountName,
	})
	if err != nil {
		t.Fatalf("generate totp secret: %v", err)
	}
	return key.Secret()
}

func generateExpiredAdminPendingMFAToken(t *testing.T, secret string, admin models.Admin) string {
	t.Helper()

	now := time.Now().UTC()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, security.PendingMFAClaims{
		UserID:   admin.ID,
		Username: admin.Username,
		Purpose:  "pending_mfa",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "cpab:pending_mfa",
			IssuedAt:  jwt.NewNumericDate(now.Add(-10 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(-5 * time.Minute)),
		},
	})
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign expired mfa token: %v", err)
	}
	return tokenString
}

func TestAdminLoginPrepareMasksMissingAndInactiveAdmins(t *testing.T) {
	db := openAdminLoginPrepareTestDB(t)
	handler := &AuthHandler{db: db}

	inactiveAdmin := models.Admin{
		Username: "inactive-admin",
		Password: "hashed",
		Active:   false,
	}
	if errCreate := db.Create(&inactiveAdmin).Error; errCreate != nil {
		t.Fatalf("create inactive admin: %v", errCreate)
	}

	tests := []struct {
		name     string
		username string
	}{
		{name: "missing admin", username: "missing-admin"},
		{name: "inactive admin", username: inactiveAdmin.Username},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, response := runAdminLoginPrepare(t, handler, tc.username)
			if status != http.StatusOK {
				t.Fatalf("status = %d, want %d", status, http.StatusOK)
			}
			if response != (adminLoginPrepareResponse{}) {
				t.Fatalf("response = %+v, want zero MFA flags", response)
			}
		})
	}
}

func TestAdminLoginPrepareReturnsActualMFAStatusForActiveAdmin(t *testing.T) {
	db := openAdminLoginPrepareTestDB(t)
	handler := &AuthHandler{db: db}

	admin := models.Admin{
		Username:         "root",
		Password:         "hashed",
		TOTPSecret:       "totp-secret",
		PasskeyID:        []byte("credential-id"),
		PasskeyPublicKey: []byte("public-key"),
	}
	if errCreate := db.Create(&admin).Error; errCreate != nil {
		t.Fatalf("create admin: %v", errCreate)
	}

	status, response := runAdminLoginPrepare(t, handler, admin.Username)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}

	want := adminLoginPrepareResponse{
		MFAEnabled:     true,
		TOTPEnabled:    true,
		PasskeyEnabled: true,
	}
	if response != want {
		t.Fatalf("response = %+v, want %+v", response, want)
	}
}

func TestAdminLoginTOTPRejectsMissingPendingToken(t *testing.T) {
	handler, db := newAdminMFATestHandler(t)

	secret := generateAdminTOTPSecret(t, "root")
	admin := models.Admin{
		Username:   "root",
		Password:   "hashed",
		Active:     true,
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&admin).Error; errCreate != nil {
		t.Fatalf("create admin: %v", errCreate)
	}

	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}

	status, response := runAdminAuthRequest(t, "/v0/admin/login/totp", fmt.Sprintf(`{"username":"%s","code":"%s"}`, admin.Username, code), handler.LoginTOTP)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "invalid mfa token" {
		t.Fatalf("error = %q, want %q", response.Error, "invalid mfa token")
	}
}

func TestAdminLoginTOTPRejectsExpiredPendingToken(t *testing.T) {
	handler, db := newAdminMFATestHandler(t)

	secret := generateAdminTOTPSecret(t, "root")
	admin := models.Admin{
		Username:   "root",
		Password:   "hashed",
		Active:     true,
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&admin).Error; errCreate != nil {
		t.Fatalf("create admin: %v", errCreate)
	}

	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}
	expiredToken := generateExpiredAdminPendingMFAToken(t, handler.jwtCfg.Secret, admin)

	status, response := runAdminAuthRequest(t, "/v0/admin/login/totp", fmt.Sprintf(`{"mfa_token":"%s","code":"%s"}`, expiredToken, code), handler.LoginTOTP)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "mfa token expired" {
		t.Fatalf("error = %q, want %q", response.Error, "mfa token expired")
	}
}

func TestAdminLoginTOTPReturnsJWTForValidPendingToken(t *testing.T) {
	handler, db := newAdminMFATestHandler(t)

	secret := generateAdminTOTPSecret(t, "root")
	admin := models.Admin{
		Username:   "root",
		Password:   "hashed",
		Active:     true,
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&admin).Error; errCreate != nil {
		t.Fatalf("create admin: %v", errCreate)
	}

	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}
	mfaToken, err := security.GeneratePendingMFAToken(handler.jwtCfg.Secret, admin.ID, admin.Username)
	if err != nil {
		t.Fatalf("generate mfa token: %v", err)
	}

	status, response := runAdminAuthRequest(t, "/v0/admin/login/totp", fmt.Sprintf(`{"mfa_token":"%s","code":"%s"}`, mfaToken, code), handler.LoginTOTP)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if response.Token == "" {
		t.Fatal("token = empty, want JWT")
	}
	claims, err := security.ParseAdminToken(handler.jwtCfg.Secret, response.Token)
	if err != nil {
		t.Fatalf("ParseAdminToken() error = %v", err)
	}
	if claims.AdminID != admin.ID {
		t.Fatalf("AdminID = %d, want %d", claims.AdminID, admin.ID)
	}
}

func TestAdminLoginTOTPRejectsInvalidCode(t *testing.T) {
	handler, db := newAdminMFATestHandler(t)

	secret := generateAdminTOTPSecret(t, "root")
	admin := models.Admin{
		Username:   "root",
		Password:   "hashed",
		Active:     true,
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&admin).Error; errCreate != nil {
		t.Fatalf("create admin: %v", errCreate)
	}

	mfaToken, err := security.GeneratePendingMFAToken(handler.jwtCfg.Secret, admin.ID, admin.Username)
	if err != nil {
		t.Fatalf("generate mfa token: %v", err)
	}
	validCode, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}
	invalidCode := "000000"
	if invalidCode == validCode {
		invalidCode = "999999"
	}

	status, response := runAdminAuthRequest(t, "/v0/admin/login/totp", fmt.Sprintf(`{"mfa_token":"%s","code":"%s"}`, mfaToken, invalidCode), handler.LoginTOTP)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "invalid code" {
		t.Fatalf("error = %q, want %q", response.Error, "invalid code")
	}
}

func TestAdminLoginPasskeyOptionsRejectsMissingPendingToken(t *testing.T) {
	handler, _ := newAdminMFATestHandler(t)

	originalSessions := passkeyLoginSessions
	passkeyLoginSessions = newSessionStore()
	t.Cleanup(func() {
		passkeyLoginSessions = originalSessions
	})

	status, response := runAdminAuthRequest(t, "/v0/admin/login/passkey/options", `{}`, handler.LoginPasskeyOptions)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "invalid mfa token" {
		t.Fatalf("error = %q, want %q", response.Error, "invalid mfa token")
	}
}
