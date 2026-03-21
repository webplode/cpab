package front

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
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/config"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/http/api/front/handlers"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/security"
	"gorm.io/gorm"
)

func openFrontRouteTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:front_route_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.User{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func buildFrontResetPasswordRouter(db *gorm.DB, jwtCfg config.JWTConfig) *gin.Engine {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	authHandler := handlers.NewAuthHandler(db, jwtCfg)

	front := router.Group("/v0/front")
	authed := front.Group("")
	authed.Use(userAuthMiddleware(db, jwtCfg))
	authed.POST("/reset-password", authHandler.ResetPassword)

	return router
}

func TestFrontResetPasswordRouteRejectsUnauthenticatedRequests(t *testing.T) {
	db := openFrontRouteTestDB(t)
	jwtCfg := config.JWTConfig{Secret: "0123456789abcdef0123456789abcdef", Expiry: time.Hour}
	router := buildFrontResetPasswordRouter(db, jwtCfg)

	req := httptest.NewRequest(http.MethodPost, "/v0/front/reset-password", bytes.NewBufferString(`{"old_password":"old-password1","new_password":"new-password1"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestFrontResetPasswordRouteUsesAuthenticatedPasswordChangeFlow(t *testing.T) {
	db := openFrontRouteTestDB(t)
	jwtCfg := config.JWTConfig{Secret: "0123456789abcdef0123456789abcdef", Expiry: time.Hour}
	router := buildFrontResetPasswordRouter(db, jwtCfg)

	oldPassword := "old-password1"
	newPassword := "new-password1"
	hash, errHash := security.HashPassword(oldPassword)
	if errHash != nil {
		t.Fatalf("hash password: %v", errHash)
	}

	user := models.User{
		Username: "alice",
		Email:    "alice@example.com",
		Password: hash,
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	token, errToken := security.GenerateToken(jwtCfg.Secret, user.ID, user.Username, "", user.Email, jwtCfg.Expiry)
	if errToken != nil {
		t.Fatalf("generate token: %v", errToken)
	}

	req := httptest.NewRequest(http.MethodPost, "/v0/front/reset-password", bytes.NewBufferString(fmt.Sprintf(`{"old_password":%q,"new_password":%q}`, oldPassword, newPassword)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response map[string]any
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if ok, exists := response["ok"]; !exists || ok != true {
		t.Fatalf("response = %+v, want ok=true", response)
	}

	var updated models.User
	if errFind := db.First(&updated, user.ID).Error; errFind != nil {
		t.Fatalf("reload user: %v", errFind)
	}
	if !security.CheckPassword(updated.Password, newPassword) {
		t.Fatalf("password was not updated for authenticated user")
	}
}
