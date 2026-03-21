package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/ratelimit"
)

func TestAuthRateLimitMiddlewareBlocksAfterLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Date(2025, 1, 1, 12, 0, 5, 0, time.UTC)
	manager := ratelimit.NewManager(func() ratelimit.SettingsConfig {
		return ratelimit.SettingsConfig{AuthLimit: 1}
	}, func() time.Time {
		return now
	}, nil)

	engine := gin.New()
	engine.Use(AuthRateLimitMiddleware(manager))
	engine.POST("/login", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	firstRecorder := httptest.NewRecorder()
	firstRequest := httptest.NewRequest(http.MethodPost, "/login", nil)
	firstRequest.RemoteAddr = "127.0.0.1:12345"
	engine.ServeHTTP(firstRecorder, firstRequest)
	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d", firstRecorder.Code)
	}

	secondRecorder := httptest.NewRecorder()
	secondRequest := httptest.NewRequest(http.MethodPost, "/login", nil)
	secondRequest.RemoteAddr = "127.0.0.1:12345"
	engine.ServeHTTP(secondRecorder, secondRequest)
	if secondRecorder.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request 429, got %d", secondRecorder.Code)
	}
	if got := secondRecorder.Header().Get("Retry-After"); got == "" {
		t.Fatalf("expected Retry-After header")
	}
}

func TestAuthRateLimitMiddlewareAllowsWhenManagerNil(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(AuthRateLimitMiddleware(nil))
	engine.POST("/login", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
}
