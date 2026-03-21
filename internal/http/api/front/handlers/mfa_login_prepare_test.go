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

type frontLoginPrepareResponse struct {
	MFAEnabled     bool `json:"mfa_enabled"`
	TOTPEnabled    bool `json:"totp_enabled"`
	PasskeyEnabled bool `json:"passkey_enabled"`
}

type frontAuthResponse struct {
	Error string `json:"error"`
	Token string `json:"token"`
}

func openFrontLoginPrepareTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:front_login_prepare_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.User{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func runFrontLoginPrepare(t *testing.T, handler *AuthHandler, username string) (int, frontLoginPrepareResponse) {
	t.Helper()

	originalDelay := loginPrepareDelay
	loginPrepareDelay = func() {}
	t.Cleanup(func() {
		loginPrepareDelay = originalDelay
	})

	body := bytes.NewBufferString(fmt.Sprintf(`{"username":%q}`, username))
	req := httptest.NewRequest(http.MethodPost, "/v0/front/login/prepare", body)
	req.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.LoginPrepare(ctx)

	var response frontLoginPrepareResponse
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}

	return recorder.Code, response
}

func newFrontMFATestHandler(t *testing.T) (*AuthHandler, *gorm.DB) {
	t.Helper()

	db := openFrontLoginPrepareTestDB(t)
	return &AuthHandler{
		db: db,
		jwtCfg: config.JWTConfig{
			Secret: "front-mfa-test-secret",
			Expiry: time.Hour,
		},
	}, db
}

func runFrontAuthRequest(t *testing.T, target string, body string, invoke func(*gin.Context)) (int, frontAuthResponse) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, target, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	invoke(ctx)

	var response frontAuthResponse
	if len(recorder.Body.Bytes()) > 0 {
		if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
			t.Fatalf("decode response: %v", errDecode)
		}
	}
	return recorder.Code, response
}

func generateFrontTOTPSecret(t *testing.T, accountName string) string {
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

func generateExpiredFrontPendingMFAToken(t *testing.T, secret string, user models.User) string {
	t.Helper()

	now := time.Now().UTC()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, security.PendingMFAClaims{
		UserID:   user.ID,
		Username: user.Username,
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

func TestFrontLoginPrepareMasksMissingAndDisabledUsers(t *testing.T) {
	db := openFrontLoginPrepareTestDB(t)
	handler := &AuthHandler{db: db}

	disabledUser := models.User{
		Username: "disabled-user",
		Password: "hashed",
		Disabled: true,
	}
	if errCreate := db.Create(&disabledUser).Error; errCreate != nil {
		t.Fatalf("create disabled user: %v", errCreate)
	}

	tests := []struct {
		name     string
		username string
	}{
		{name: "missing user", username: "missing-user"},
		{name: "disabled user", username: disabledUser.Username},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, response := runFrontLoginPrepare(t, handler, tc.username)
			if status != http.StatusOK {
				t.Fatalf("status = %d, want %d", status, http.StatusOK)
			}
			if response != (frontLoginPrepareResponse{}) {
				t.Fatalf("response = %+v, want zero MFA flags", response)
			}
		})
	}
}

func TestFrontLoginPrepareReturnsActualMFAStatusForEnabledUser(t *testing.T) {
	db := openFrontLoginPrepareTestDB(t)
	handler := &AuthHandler{db: db}

	user := models.User{
		Username:         "alice",
		Password:         "hashed",
		TOTPSecret:       "totp-secret",
		PasskeyID:        []byte("credential-id"),
		PasskeyPublicKey: []byte("public-key"),
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	status, response := runFrontLoginPrepare(t, handler, user.Username)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}

	want := frontLoginPrepareResponse{
		MFAEnabled:     true,
		TOTPEnabled:    true,
		PasskeyEnabled: true,
	}
	if response != want {
		t.Fatalf("response = %+v, want %+v", response, want)
	}
}

func TestFrontLoginTOTPRejectsMissingPendingToken(t *testing.T) {
	handler, db := newFrontMFATestHandler(t)

	secret := generateFrontTOTPSecret(t, "alice")
	user := models.User{
		Username:   "alice",
		Password:   "hashed",
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}

	status, response := runFrontAuthRequest(t, "/v0/front/login/totp", fmt.Sprintf(`{"username":"%s","code":"%s"}`, user.Username, code), handler.LoginTOTP)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "invalid mfa token" {
		t.Fatalf("error = %q, want %q", response.Error, "invalid mfa token")
	}
}

func TestFrontLoginTOTPRejectsExpiredPendingToken(t *testing.T) {
	handler, db := newFrontMFATestHandler(t)

	secret := generateFrontTOTPSecret(t, "alice")
	user := models.User{
		Username:   "alice",
		Password:   "hashed",
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}
	expiredToken := generateExpiredFrontPendingMFAToken(t, handler.jwtCfg.Secret, user)

	status, response := runFrontAuthRequest(t, "/v0/front/login/totp", fmt.Sprintf(`{"mfa_token":"%s","code":"%s"}`, expiredToken, code), handler.LoginTOTP)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "mfa token expired" {
		t.Fatalf("error = %q, want %q", response.Error, "mfa token expired")
	}
}

func TestFrontLoginTOTPReturnsJWTForValidPendingToken(t *testing.T) {
	handler, db := newFrontMFATestHandler(t)

	secret := generateFrontTOTPSecret(t, "alice")
	user := models.User{
		Username:   "alice",
		Password:   "hashed",
		Name:       "Alice",
		Email:      "alice@example.com",
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}
	mfaToken, err := security.GeneratePendingMFAToken(handler.jwtCfg.Secret, user.ID, user.Username)
	if err != nil {
		t.Fatalf("generate mfa token: %v", err)
	}

	status, response := runFrontAuthRequest(t, "/v0/front/login/totp", fmt.Sprintf(`{"mfa_token":"%s","code":"%s"}`, mfaToken, code), handler.LoginTOTP)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if response.Token == "" {
		t.Fatal("token = empty, want JWT")
	}
	claims, err := security.ParseToken(handler.jwtCfg.Secret, response.Token)
	if err != nil {
		t.Fatalf("ParseToken() error = %v", err)
	}
	if claims.UserID != user.ID {
		t.Fatalf("UserID = %d, want %d", claims.UserID, user.ID)
	}
}

func TestFrontLoginTOTPRejectsInvalidCode(t *testing.T) {
	handler, db := newFrontMFATestHandler(t)

	secret := generateFrontTOTPSecret(t, "alice")
	user := models.User{
		Username:   "alice",
		Password:   "hashed",
		TOTPSecret: secret,
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	mfaToken, err := security.GeneratePendingMFAToken(handler.jwtCfg.Secret, user.ID, user.Username)
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

	status, response := runFrontAuthRequest(t, "/v0/front/login/totp", fmt.Sprintf(`{"mfa_token":"%s","code":"%s"}`, mfaToken, invalidCode), handler.LoginTOTP)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "invalid code" {
		t.Fatalf("error = %q, want %q", response.Error, "invalid code")
	}
}

func TestFrontLoginPasskeyOptionsRejectsMissingPendingToken(t *testing.T) {
	handler, _ := newFrontMFATestHandler(t)

	originalSessions := passkeyLoginSessions
	passkeyLoginSessions = newSessionStore()
	t.Cleanup(func() {
		passkeyLoginSessions = originalSessions
	})

	status, response := runFrontAuthRequest(t, "/v0/front/login/passkey/options", `{}`, handler.LoginPasskeyOptions)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", status, http.StatusUnauthorized)
	}
	if response.Error != "invalid mfa token" {
		t.Fatalf("error = %q, want %q", response.Error, "invalid mfa token")
	}
}
