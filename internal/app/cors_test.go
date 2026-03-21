package app

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func runCORSMiddlewareRequest(t *testing.T, allowedOrigins []string, method string, headers map[string]string, secure bool) *httptest.ResponseRecorder {
	t.Helper()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, engine := gin.CreateTestContext(recorder)
	engine.Use(corsMiddleware(allowedOrigins...))
	engine.GET("/", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(method, "/", nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if secure {
		req.TLS = &tls.ConnectionState{}
	}
	ctx.Request = req
	engine.HandleContext(ctx)

	return recorder
}

func TestCORSMiddlewareAllowsConfiguredOrigin(t *testing.T) {
	recorder := runCORSMiddlewareRequest(t, []string{"https://admin.example.com"}, http.MethodGet, map[string]string{
		"Origin": "https://admin.example.com",
	}, false)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "https://admin.example.com" {
		t.Fatalf("expected reflected origin, got %q", got)
	}
	if got := recorder.Header().Values("Vary"); len(got) != 1 || got[0] != "Origin" {
		t.Fatalf("expected Vary=[Origin], got %q", got)
	}
}

func TestCORSMiddlewareOmitsDisallowedOrigin(t *testing.T) {
	recorder := runCORSMiddlewareRequest(t, []string{"https://admin.example.com"}, http.MethodGet, map[string]string{
		"Origin": "https://attacker.example.com",
	}, false)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS allow-origin header, got %q", got)
	}
	if got := recorder.Header().Values("Vary"); len(got) != 1 || got[0] != "Origin" {
		t.Fatalf("expected Vary=[Origin], got %q", got)
	}
}

func TestCORSMiddlewareAllowsWildcard(t *testing.T) {
	recorder := runCORSMiddlewareRequest(t, []string{"*"}, http.MethodGet, map[string]string{
		"Origin": "https://admin.example.com",
	}, false)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected wildcard origin, got %q", got)
	}
}

func TestCORSMiddlewareAddsSecurityHeaders(t *testing.T) {
	recorder := runCORSMiddlewareRequest(t, nil, http.MethodGet, nil, false)

	if got := recorder.Header().Get("Content-Security-Policy"); got == "" {
		t.Fatal("expected Content-Security-Policy header")
	}
	if got := recorder.Header().Get("Referrer-Policy"); got != "strict-origin-when-cross-origin" {
		t.Fatalf("Referrer-Policy = %q, want strict-origin-when-cross-origin", got)
	}
	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := recorder.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", got)
	}
	if got := recorder.Header().Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("Strict-Transport-Security = %q, want empty on non-HTTPS requests", got)
	}
}

func TestCORSMiddlewareAddsHSTSForSecureRequests(t *testing.T) {
	tests := []struct {
		name    string
		headers map[string]string
		secure  bool
	}{
		{
			name:   "tls request",
			secure: true,
		},
		{
			name: "forwarded proto",
			headers: map[string]string{
				"X-Forwarded-Proto": "https",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recorder := runCORSMiddlewareRequest(t, nil, http.MethodGet, tc.headers, tc.secure)
			if got := recorder.Header().Get("Strict-Transport-Security"); got != "max-age=31536000; includeSubDomains" {
				t.Fatalf("Strict-Transport-Security = %q, want max-age=31536000; includeSubDomains", got)
			}
		})
	}
}
