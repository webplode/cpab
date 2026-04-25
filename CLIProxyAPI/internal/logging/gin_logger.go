// Package logging provides Gin middleware for HTTP request logging and panic recovery.
// It integrates Gin web framework with logrus for structured logging of HTTP requests,
// responses, and error handling with panic recovery capabilities.
package logging

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/interfaces"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/util"
	log "github.com/sirupsen/logrus"
)

// aiAPIPrefixes defines path prefixes for AI API requests that should have request ID tracking.
var aiAPIPrefixes = []string{
	"/v1/chat/completions",
	"/v1/completions",
	"/v1/images",
	"/v1/messages",
	"/v1/responses",
	"/v1beta/models/",
	"/api/provider/",
}

const (
	skipGinLogKey = "__gin_skip_request_logging__"
	// Byte limits for opportunistic request/response body capture on AI API
	// paths. Kept small so high-traffic endpoints don't retain large buffers;
	// capture is only *consumed* on 5xx, so the cost on success paths is just
	// one bounded allocation per request.
	maxVerboseLogRequestBodyBytes  = 4096
	maxVerboseLogResponseBodyBytes = 2048
)

// capturedBuffer is a bounded byte accumulator used to mirror request and
// response bodies for verbose error logging.
type capturedBuffer struct {
	buf   bytes.Buffer
	limit int
}

func newCapturedBuffer(limit int) *capturedBuffer {
	return &capturedBuffer{limit: limit}
}

func (c *capturedBuffer) Write(p []byte) {
	if c == nil || c.limit <= 0 {
		return
	}
	remaining := c.limit - c.buf.Len()
	if remaining <= 0 {
		return
	}
	if len(p) > remaining {
		p = p[:remaining]
	}
	c.buf.Write(p)
}

func (c *capturedBuffer) String() string {
	if c == nil {
		return ""
	}
	return c.buf.String()
}

func (c *capturedBuffer) Len() int {
	if c == nil {
		return 0
	}
	return c.buf.Len()
}

// teeRequestBody wraps an http request body so every byte read by downstream
// handlers is also mirrored into a bounded capture buffer.
type teeRequestBody struct {
	src     io.ReadCloser
	capture *capturedBuffer
}

func (t *teeRequestBody) Read(p []byte) (int, error) {
	n, err := t.src.Read(p)
	if n > 0 && t.capture != nil {
		t.capture.Write(p[:n])
	}
	return n, err
}

func (t *teeRequestBody) Close() error {
	if t.src == nil {
		return nil
	}
	return t.src.Close()
}

// captureResponseWriter mirrors Write/WriteString calls into a bounded capture
// buffer. Every other method of gin.ResponseWriter (Flush, Hijack, Status,
// Size, WriteHeader, …) is promoted via the embedded interface so streaming
// handlers and type assertions against http.Flusher/http.Hijacker keep working.
type captureResponseWriter struct {
	gin.ResponseWriter
	capture *capturedBuffer
}

func (w *captureResponseWriter) Write(p []byte) (int, error) {
	if w.capture != nil {
		w.capture.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

func (w *captureResponseWriter) WriteString(s string) (int, error) {
	if w.capture != nil {
		w.capture.Write([]byte(s))
	}
	return w.ResponseWriter.WriteString(s)
}

// GinLogrusLogger returns a Gin middleware handler that logs HTTP requests and responses
// using logrus. It captures request details including method, path, status code, latency,
// client IP, and any error messages. Request ID is only added for AI API requests.
//
// Output format (AI API): [2025-12-23 20:14:10] [info ] | a1b2c3d4 | 200 |       23.559s | ...
// Output format (others): [2025-12-23 20:14:10] [info ] | -------- | 200 |       23.559s | ...
//
// Returns:
//   - gin.HandlerFunc: A middleware handler for request logging
func GinLogrusLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := util.MaskSensitiveQuery(c.Request.URL.RawQuery)

		// Only generate request ID and capture bodies for AI API paths. Non-AI
		// paths keep the lightweight old behavior.
		var requestID string
		var reqCapture, respCapture *capturedBuffer
		if isAIAPIPath(path) {
			requestID = GenerateRequestID()
			SetGinRequestID(c, requestID)
			ctx := WithRequestID(c.Request.Context(), requestID)
			c.Request = c.Request.WithContext(ctx)

			if c.Request.Body != nil {
				reqCapture = newCapturedBuffer(maxVerboseLogRequestBodyBytes)
				c.Request.Body = &teeRequestBody{src: c.Request.Body, capture: reqCapture}
			}
			respCapture = newCapturedBuffer(maxVerboseLogResponseBodyBytes)
			c.Writer = &captureResponseWriter{ResponseWriter: c.Writer, capture: respCapture}
		}

		c.Next()

		if shouldSkipGinRequestLogging(c) {
			return
		}

		if raw != "" {
			path = path + "?" + raw
		}

		latency := time.Since(start)
		if latency > time.Minute {
			latency = latency.Truncate(time.Second)
		} else {
			latency = latency.Truncate(time.Millisecond)
		}

		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		method := c.Request.Method
		errorMessage := c.Errors.ByType(gin.ErrorTypePrivate).String()

		if requestID == "" {
			requestID = "--------"
		}
		logLine := fmt.Sprintf("%3d | %13v | %15s | %-7s \"%s\"", statusCode, latency, clientIP, method, path)
		if errorMessage != "" {
			logLine = logLine + " | " + errorMessage
		}

		entry := log.WithField("request_id", requestID)

		switch {
		case statusCode >= http.StatusInternalServerError:
			entry.Error(logLine)
			emitVerbose5xxLogs(c, entry, reqCapture, respCapture)
		case statusCode >= http.StatusBadRequest:
			entry.Warn(logLine)
		default:
			entry.Info(logLine)
		}
	}
}

// emitVerbose5xxLogs writes extra log lines — all tagged with the same
// request_id as the main status line — that carry the request/response body
// snippets and any upstream error details handlers recorded via the
// API_RESPONSE_ERROR gin-context key. Extra context goes into log *messages*
// (not fields) because the custom LogFormatter whitelists which fields it
// renders, so arbitrary fields would be silently dropped.
func emitVerbose5xxLogs(c *gin.Context, entry *log.Entry, reqCapture, respCapture *capturedBuffer) {
	if c == nil || entry == nil {
		return
	}
	entry.Errorf("5xx context: ua=%q content_type=%q content_length=%d remote=%s",
		c.Request.UserAgent(),
		c.GetHeader("Content-Type"),
		c.Request.ContentLength,
		c.Request.RemoteAddr,
	)

	if reqCapture != nil && reqCapture.Len() > 0 {
		entry.Errorf("5xx request_body (%d bytes): %s",
			reqCapture.Len(), sanitizeForLog(reqCapture.String()))
	}
	if respCapture != nil && respCapture.Len() > 0 {
		entry.Errorf("5xx response_body (%d bytes): %s",
			respCapture.Len(), sanitizeForLog(respCapture.String()))
	}

	if raw, exists := c.Get("API_RESPONSE_ERROR"); exists {
		if errs, ok := raw.([]*interfaces.ErrorMessage); ok {
			for i, em := range errs {
				if em == nil {
					continue
				}
				var upstreamErr string
				if em.Error != nil {
					upstreamErr = em.Error.Error()
				}
				entry.Errorf("5xx upstream_error[%d]: status=%d error=%s",
					i, em.StatusCode, sanitizeForLog(upstreamErr))
			}
		}
	}
}

// sanitizeForLog collapses whitespace runs and strips non-printable control
// bytes so captured bodies land on a single log line.
func sanitizeForLog(s string) string {
	if s == "" {
		return ""
	}
	b := make([]byte, 0, len(s))
	prevSpace := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '\n' || ch == '\r' || ch == '\t' || ch < 0x20 {
			if !prevSpace {
				b = append(b, ' ')
				prevSpace = true
			}
			continue
		}
		b = append(b, ch)
		prevSpace = false
	}
	return strings.TrimSpace(string(b))
}

// isAIAPIPath checks if the given path is an AI API endpoint that should have request ID tracking.
func isAIAPIPath(path string) bool {
	for _, prefix := range aiAPIPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// GinLogrusRecovery returns a Gin middleware handler that recovers from panics and logs
// them using logrus. When a panic occurs, it captures the panic value, stack trace,
// and request path, then returns a 500 Internal Server Error response to the client.
//
// Returns:
//   - gin.HandlerFunc: A middleware handler for panic recovery
func GinLogrusRecovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		if err, ok := recovered.(error); ok && errors.Is(err, http.ErrAbortHandler) {
			// Let net/http handle ErrAbortHandler so the connection is aborted without noisy stack logs.
			panic(http.ErrAbortHandler)
		}

		log.WithFields(log.Fields{
			"panic": recovered,
			"stack": string(debug.Stack()),
			"path":  c.Request.URL.Path,
		}).Error("recovered from panic")

		c.AbortWithStatus(http.StatusInternalServerError)
	})
}

// SkipGinRequestLogging marks the provided Gin context so that GinLogrusLogger
// will skip emitting a log line for the associated request.
func SkipGinRequestLogging(c *gin.Context) {
	if c == nil {
		return
	}
	c.Set(skipGinLogKey, true)
}

func shouldSkipGinRequestLogging(c *gin.Context) bool {
	if c == nil {
		return false
	}
	val, exists := c.Get(skipGinLogKey)
	if !exists {
		return false
	}
	flag, ok := val.(bool)
	return ok && flag
}
