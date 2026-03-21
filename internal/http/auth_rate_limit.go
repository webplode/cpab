package http

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/ratelimit"
	log "github.com/sirupsen/logrus"
)

// AuthRateLimitMiddleware throttles unauthenticated auth endpoints by client IP.
func AuthRateLimitMiddleware(rlManager *ratelimit.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c == nil || c.Request == nil || rlManager == nil {
			if c != nil {
				c.Next()
			}
			return
		}

		clientIP := strings.TrimSpace(c.ClientIP())
		if clientIP == "" {
			clientIP = "unknown"
		}

		result, errAllow := rlManager.AllowAuth(c.Request.Context(), "auth:"+clientIP)
		if errAllow != nil {
			log.WithError(errAllow).Warn("auth rate limit: check failed")
			c.Next()
			return
		}
		if result.Allowed {
			c.Next()
			return
		}

		retryAfter := int(math.Ceil(result.Reset.Sub(time.Now().UTC()).Seconds()))
		if retryAfter < 1 {
			retryAfter = 1
		}
		c.Header("Retry-After", strconv.Itoa(retryAfter))
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
			"error":       "too many authentication attempts",
			"retry_after": retryAfter,
		})
	}
}
