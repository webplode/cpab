package app

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// corsMiddleware applies configured CORS headers for browser-based clients.
func corsMiddleware(allowedOrigins ...string) gin.HandlerFunc {
	allowAll := false
	allowedSet := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		trimmed := strings.TrimSpace(origin)
		if trimmed == "" {
			continue
		}
		if trimmed == "*" {
			allowAll = true
			continue
		}
		allowedSet[trimmed] = struct{}{}
	}

	return func(c *gin.Context) {
		c.Header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		if requestUsesHTTPS(c) {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-API-Key, X-Goog-Api-Key")
		c.Header("Access-Control-Max-Age", "86400")
		if origin := strings.TrimSpace(c.GetHeader("Origin")); origin != "" {
			if !allowAll {
				appendVaryHeader(c, "Origin")
			}
			if allowAll {
				c.Header("Access-Control-Allow-Origin", "*")
			} else if _, ok := allowedSet[origin]; ok {
				c.Header("Access-Control-Allow-Origin", origin)
			}
		}

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func requestUsesHTTPS(c *gin.Context) bool {
	if c.Request != nil && c.Request.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
}

func appendVaryHeader(c *gin.Context, value string) {
	existing := c.Writer.Header().Values("Vary")
	for _, headerValue := range existing {
		for _, part := range strings.Split(headerValue, ",") {
			if strings.EqualFold(strings.TrimSpace(part), value) {
				return
			}
		}
	}
	c.Writer.Header().Add("Vary", value)
}
