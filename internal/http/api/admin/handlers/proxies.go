package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/proxyutil"
	dbutil "github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

const (
	proxyCheckTimeout   = 8 * time.Second
	proxyCheckBodyLimit = 1 << 20

	proxyTestStatusNew    = "new"
	proxyTestStatusActive = "active"
	proxyTestStatusError  = "error"
)

var proxyCheckServices = map[string]proxyCheckService{
	"google": {
		Name:   "google.com",
		URL:    "https://google.com/",
		Method: http.MethodHead,
	},
	"google.com": {
		Name:   "google.com",
		URL:    "https://google.com/",
		Method: http.MethodHead,
	},
	"9router": {
		Name:   "google.com",
		URL:    "https://google.com/",
		Method: http.MethodHead,
	},
	"ipify": {
		Name:      "ipify",
		URL:       "https://api.ipify.org?format=json",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"ipinfo": {
		Name:      "ipinfo",
		URL:       "https://ipinfo.io/ip",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"ident4": {
		Name:      "4.ident.me",
		URL:       "https://4.ident.me/",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"ident.me": {
		Name:      "4.ident.me",
		URL:       "https://4.ident.me/",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"4.ident.me": {
		Name:      "4.ident.me",
		URL:       "https://4.ident.me/",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"l2": {
		Name:      "l2.io",
		URL:       "https://l2.io/ip.json",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"l2.io": {
		Name:      "l2.io",
		URL:       "https://l2.io/ip.json",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
	"l2.io/ip.json": {
		Name:      "l2.io",
		URL:       "https://l2.io/ip.json",
		Method:    http.MethodGet,
		ExpectsIP: true,
	},
}

var proxyCheckDefaultServices = []proxyCheckService{
	proxyCheckServices["google"],
}

// ProxyHandler manages admin proxy CRUD endpoints.
type ProxyHandler struct {
	db *gorm.DB // Database handle for proxy records.
}

// NewProxyHandler constructs a proxy handler with a database dependency.
func NewProxyHandler(db *gorm.DB) *ProxyHandler {
	return &ProxyHandler{db: db}
}

// createProxyRequest captures the payload for creating a proxy.
type createProxyRequest struct {
	ProxyURL string `json:"proxy_url"` // Proxy URL.
}

// updateProxyRequest captures the payload for updating a proxy.
type updateProxyRequest struct {
	ProxyURL *string `json:"proxy_url"` // Optional updated proxy URL.
}

// batchCreateProxyRequest captures the payload for batch proxy creation.
type batchCreateProxyRequest struct {
	ProxyURLs []string `json:"proxy_urls"` // List of proxy URLs.
}

type proxyCheckService struct {
	Name      string
	URL       string
	Method    string
	ExpectsIP bool
}

type proxyCheckDiagnosis struct {
	stage             string
	message           string
	hint              string
	suggestedProxyURL string
	stopFallback      bool
}

// Create validates and inserts a new proxy record.
func (h *ProxyHandler) Create(c *gin.Context) {
	var body createProxyRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	normalized, errNormalize := normalizeProxyURL(body.ProxyURL)
	if errNormalize != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proxy_url"})
		return
	}

	now := time.Now().UTC()
	row := models.Proxy{
		ProxyURL:   normalized,
		IsActive:   true,
		TestStatus: proxyTestStatusNew,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if errCreate := h.db.WithContext(c.Request.Context()).Create(&row).Error; errCreate != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create proxy failed"})
		return
	}

	c.JSON(http.StatusCreated, proxyRow(&row))
}

// List returns proxies filtered by keyword.
func (h *ProxyHandler) List(c *gin.Context) {
	keywordQ := strings.TrimSpace(c.Query("keyword"))

	q := h.db.WithContext(c.Request.Context()).Model(&models.Proxy{})
	if keywordQ != "" {
		pattern := dbutil.NormalizeLikePattern(h.db, "%"+keywordQ+"%")
		q = q.Where(dbutil.CaseInsensitiveLikeExpr(h.db, "proxy_url"), pattern)
	}

	var rows []models.Proxy
	if errFind := q.Order("created_at DESC").Find(&rows).Error; errFind != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list proxies failed"})
		return
	}

	out := make([]gin.H, 0, len(rows))
	for i := range rows {
		out = append(out, proxyRow(&rows[i]))
	}
	c.JSON(http.StatusOK, gin.H{"proxies": out})
}

// Check performs an outbound liveness request through a saved proxy.
func (h *ProxyHandler) Check(c *gin.Context) {
	id, errID := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errID != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	services, ok := selectProxyCheckServices(c.Query("service"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid check service"})
		return
	}

	var row models.Proxy
	if errFind := h.db.WithContext(c.Request.Context()).First(&row, "id = ?", id).Error; errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "proxy not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "fetch proxy failed"})
		return
	}

	startedAt := time.Now().UTC()
	checkResult := checkProxyIPWithFallback(c.Request.Context(), row.ProxyURL, services)
	live := checkResult.err == nil
	errorText := ""
	if checkResult.err != nil {
		errorText = checkResult.err.Error()
	}
	storedErrorText := proxyCheckStoredError(checkResult, errorText)

	row.IsActive = live
	row.TestStatus = proxyTestStatusActive
	row.LastError = ""
	row.LastCheckedIP = checkResult.ip
	row.LastTestedAt = &startedAt
	row.UpdatedAt = time.Now().UTC()
	if !live {
		row.TestStatus = proxyTestStatusError
		row.LastError = storedErrorText
		row.LastCheckedIP = ""
	}
	if errSave := h.db.WithContext(c.Request.Context()).Save(&row).Error; errSave != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save proxy check result failed"})
		return
	}

	result := gin.H{
		"live":       live,
		"ip":         checkResult.ip,
		"service":    checkResult.service.Name,
		"target_url": checkResult.service.URL,
		"method":     checkResult.service.Method,
		"latency_ms": time.Since(startedAt).Milliseconds(),
		"checked_at": startedAt,
	}
	if checkResult.statusCode > 0 {
		result["status_code"] = checkResult.statusCode
	}
	if checkResult.statusText != "" {
		result["status_text"] = checkResult.statusText
	}
	if checkResult.err != nil {
		result["error"] = errorText
	}
	if checkResult.failureStage != "" {
		result["failure_stage"] = checkResult.failureStage
	}
	if checkResult.diagnosis != "" {
		result["diagnosis"] = checkResult.diagnosis
	}
	if checkResult.hint != "" {
		result["hint"] = checkResult.hint
	}
	if checkResult.suggestedProxyURL != "" {
		result["suggested_proxy_url"] = checkResult.suggestedProxyURL
	}

	c.JSON(http.StatusOK, result)
}

// Update validates and updates a proxy record by ID.
func (h *ProxyHandler) Update(c *gin.Context) {
	id, errID := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errID != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var row models.Proxy
	if errFind := h.db.WithContext(c.Request.Context()).First(&row, "id = ?", id).Error; errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "proxy not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "fetch proxy failed"})
		return
	}

	var body updateProxyRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	if body.ProxyURL != nil {
		normalized, errNormalize := normalizeProxyURL(*body.ProxyURL)
		if errNormalize != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proxy_url"})
			return
		}
		row.ProxyURL = normalized
	}

	row.UpdatedAt = time.Now().UTC()
	if errSave := h.db.WithContext(c.Request.Context()).Save(&row).Error; errSave != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update proxy failed"})
		return
	}

	c.JSON(http.StatusOK, proxyRow(&row))
}

// Delete removes a proxy record by ID.
func (h *ProxyHandler) Delete(c *gin.Context) {
	id, errID := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errID != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if errDelete := h.db.WithContext(c.Request.Context()).Delete(&models.Proxy{}, "id = ?", id).Error; errDelete != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete proxy failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// BatchDelete removes selected proxy records.
func (h *ProxyHandler) BatchDelete(c *gin.Context) {
	ids, ok := bindRequestIDList(c)
	if !ok {
		return
	}

	var (
		deleted    int64
		missingIDs []uint64
	)
	errDelete := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		existingIDs, errExisting := loadExistingIDs(tx, &models.Proxy{}, ids)
		if errExisting != nil {
			return errExisting
		}
		missingIDs = missingUint64IDs(ids, existingIDs)
		if len(existingIDs) == 0 {
			return nil
		}
		res := tx.Delete(&models.Proxy{}, "id IN ?", existingIDs)
		if res.Error != nil {
			return res.Error
		}
		deleted = res.RowsAffected
		return nil
	})
	if errDelete != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "batch delete proxies failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted":     deleted,
		"missing_ids": missingIDs,
	})
}

// BatchCreate creates multiple proxy records in one request.
func (h *ProxyHandler) BatchCreate(c *gin.Context) {
	var body batchCreateProxyRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	if len(body.ProxyURLs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "proxy_urls is required"})
		return
	}

	now := time.Now().UTC()
	rows := make([]models.Proxy, 0, len(body.ProxyURLs))
	for idx, raw := range body.ProxyURLs {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		normalized, errNormalize := normalizeProxyURL(trimmed)
		if errNormalize != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid proxy_url at line %d", idx+1)})
			return
		}
		rows = append(rows, models.Proxy{
			ProxyURL:   normalized,
			IsActive:   true,
			TestStatus: proxyTestStatusNew,
			CreatedAt:  now,
			UpdatedAt:  now,
		})
	}

	if len(rows) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "proxy_urls is required"})
		return
	}

	if errCreate := h.db.WithContext(c.Request.Context()).Create(&rows).Error; errCreate != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "batch create proxies failed"})
		return
	}

	out := make([]gin.H, 0, len(rows))
	for i := range rows {
		out = append(out, proxyRow(&rows[i]))
	}
	c.JSON(http.StatusCreated, gin.H{"proxies": out})
}

// normalizeProxyURL validates and normalizes proxy URL inputs.
func normalizeProxyURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("proxy_url is required")
	}

	parsed, errParse := url.Parse(trimmed)
	if errParse != nil {
		return "", errParse
	}

	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "http" && scheme != "https" && scheme != "socks5" {
		return "", fmt.Errorf("invalid scheme")
	}
	parsed.Scheme = scheme

	if parsed.Host == "" {
		return "", fmt.Errorf("missing host")
	}
	if _, _, errHost := net.SplitHostPort(parsed.Host); errHost != nil {
		return "", errHost
	}

	if parsed.Path == "" {
		parsed.Path = "/"
	}

	return parsed.String(), nil
}

func selectProxyCheckServices(raw string) ([]proxyCheckService, bool) {
	name := strings.ToLower(strings.TrimSpace(raw))
	if name == "" {
		return proxyCheckDefaultServices, true
	}
	service, ok := proxyCheckServices[name]
	if !ok {
		return nil, false
	}
	return []proxyCheckService{service}, true
}

type proxyCheckResult struct {
	service           proxyCheckService
	ip                string
	statusCode        int
	statusText        string
	err               error
	failureStage      string
	diagnosis         string
	hint              string
	suggestedProxyURL string
}

func checkProxyIPWithFallback(parent context.Context, proxyURL string, services []proxyCheckService) proxyCheckResult {
	var errorsByService []string
	var lastResult proxyCheckResult
	if len(services) == 0 {
		return proxyCheckResult{
			failureStage: "liveness_check",
			diagnosis:    "No proxy check target was selected.",
			err:          errors.New("no proxy check target selected"),
		}
	}

	for _, service := range services {
		ip, statusCode, statusText, errCheck := checkProxyLiveness(parent, proxyURL, service)
		result := proxyCheckResult{
			service:    normalizeProxyCheckService(service),
			ip:         ip,
			statusCode: statusCode,
			statusText: statusText,
			err:        errCheck,
		}
		if errCheck == nil {
			return result
		}
		diagnosis := diagnoseProxyCheckError(errCheck, proxyURL)
		result.failureStage = diagnosis.stage
		result.diagnosis = diagnosis.message
		result.hint = diagnosis.hint
		result.suggestedProxyURL = diagnosis.suggestedProxyURL
		if diagnosis.stopFallback {
			return result
		}
		lastResult = result
		errorsByService = append(errorsByService, fmt.Sprintf("%s: %v", service.Name, errCheck))
	}

	if lastResult.service.Name == "" && len(services) > 0 {
		lastResult.service = services[0]
	}
	if len(errorsByService) > 0 {
		lastResult.err = errors.New(strings.Join(errorsByService, "; "))
		if lastResult.failureStage == "" {
			lastResult.failureStage = "liveness_check"
		}
		if lastResult.diagnosis == "" {
			lastResult.diagnosis = "The proxy request reached the liveness check step, but every configured target failed."
		}
	}
	return lastResult
}

func diagnoseProxyCheckError(err error, proxyURL string) proxyCheckDiagnosis {
	if err == nil {
		return proxyCheckDiagnosis{}
	}

	errText := strings.ToLower(err.Error())
	diagnosis := proxyCheckDiagnosis{stage: "liveness_check"}

	switch {
	case strings.Contains(errText, "configure proxy failed") ||
		strings.Contains(errText, "proxy url missing scheme/host") ||
		strings.Contains(errText, "unsupported proxy scheme"):
		diagnosis.stage = "proxy_config"
		diagnosis.message = "The proxy URL could not be configured."
		diagnosis.stopFallback = true
	case strings.Contains(errText, "proxy authentication required") ||
		strings.Contains(errText, "407"):
		diagnosis.stage = "proxy_auth"
		diagnosis.message = "The proxy rejected the request during authentication."
		diagnosis.hint = "Check the proxy username and password saved for this proxy."
		diagnosis.stopFallback = true
	case strings.Contains(errText, "proxy tls handshake failed") ||
		strings.Contains(errText, "server gave http response to https client") ||
		strings.Contains(errText, "proxyconnect tcp: eof") ||
		strings.Contains(errText, "proxyconnect tcp: unexpected eof") ||
		strings.Contains(errText, "proxyconnect tcp: read") ||
		strings.Contains(errText, "proxyconnect tcp: write") ||
		strings.Contains(errText, "connection reset by peer"):
		diagnosis.stage = "proxy_tunnel"
		diagnosis.message = "The proxy closed the HTTPS tunnel before the liveness target was reached."
		diagnosis.hint = "Check the proxy protocol, credentials, and whether the proxy supports HTTPS CONNECT."
		diagnosis.stopFallback = true
	}

	if diagnosis.stopFallback && isHTTPSProxyURL(proxyURL) {
		diagnosis.suggestedProxyURL = httpSchemeProxyURL(proxyURL)
		diagnosis.hint = "This proxy is saved as https://, which means TLS to the proxy server itself. If your proxy provider labels it as an HTTPS proxy, it usually still needs to be saved as http:// so HTTPS destinations use CONNECT."
	}

	return diagnosis
}

func proxyCheckStoredError(result proxyCheckResult, fallback string) string {
	parts := make([]string, 0, 4)
	if result.diagnosis != "" {
		parts = append(parts, result.diagnosis)
	}
	if fallback != "" {
		parts = append(parts, fallback)
	}
	if result.hint != "" {
		parts = append(parts, result.hint)
	}
	if result.suggestedProxyURL != "" {
		parts = append(parts, "Suggested URL: "+result.suggestedProxyURL)
	}
	return strings.Join(parts, " ")
}

func isHTTPSProxyURL(raw string) bool {
	parsed, errParse := url.Parse(strings.TrimSpace(raw))
	if errParse != nil {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "https")
}

func httpSchemeProxyURL(raw string) string {
	parsed, errParse := url.Parse(strings.TrimSpace(raw))
	if errParse != nil {
		return ""
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return ""
	}
	parsed.Scheme = "http"
	return parsed.String()
}

func checkProxyLiveness(parent context.Context, proxyURL string, service proxyCheckService) (string, int, string, error) {
	service = normalizeProxyCheckService(service)
	transport, _, errTransport := proxyutil.BuildHTTPTransport(proxyURL)
	if errTransport != nil {
		return "", 0, "", fmt.Errorf("configure proxy failed: %w", errTransport)
	}
	if transport == nil {
		return "", 0, "", fmt.Errorf("proxy transport unavailable")
	}
	defer transport.CloseIdleConnections()

	ctx, cancel := context.WithTimeout(parent, proxyCheckTimeout)
	defer cancel()

	req, errReq := http.NewRequestWithContext(ctx, service.Method, service.URL, nil)
	if errReq != nil {
		return "", 0, "", fmt.Errorf("create check request failed: %w", errReq)
	}
	req.Header.Set("Accept", "application/json,text/plain;q=0.9,*/*;q=0.8")
	req.Header.Set("User-Agent", "9Router")

	client := &http.Client{
		Transport: transport,
		Timeout:   proxyCheckTimeout,
	}
	resp, errDo := client.Do(req)
	if errDo != nil {
		return "", 0, "", fmt.Errorf("request through proxy failed: %w", errDo)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", resp.StatusCode, resp.Status, fmt.Errorf("proxy check returned status %d", resp.StatusCode)
	}

	if !service.ExpectsIP {
		return "", resp.StatusCode, resp.Status, nil
	}

	body, errRead := io.ReadAll(io.LimitReader(resp.Body, proxyCheckBodyLimit))
	if errRead != nil {
		return "", resp.StatusCode, resp.Status, fmt.Errorf("read check response failed: %w", errRead)
	}

	ip, errIP := parseProxyCheckIP(body)
	if errIP != nil {
		return "", resp.StatusCode, resp.Status, errIP
	}
	return ip, resp.StatusCode, resp.Status, nil
}

func normalizeProxyCheckService(service proxyCheckService) proxyCheckService {
	if strings.TrimSpace(service.Method) == "" {
		if service.ExpectsIP {
			service.Method = http.MethodGet
		} else {
			service.Method = http.MethodHead
		}
	}
	return service
}

func parseProxyCheckIP(body []byte) (string, error) {
	var jsonBody struct {
		IP string `json:"ip"`
	}
	if errJSON := json.Unmarshal(body, &jsonBody); errJSON == nil {
		if ip := strings.TrimSpace(jsonBody.IP); ip != "" {
			return normalizeCheckedIP(ip)
		}
	}

	return normalizeCheckedIP(strings.TrimSpace(string(body)))
}

func normalizeCheckedIP(raw string) (string, error) {
	if raw == "" {
		return "", fmt.Errorf("ip check response did not contain an IP address")
	}
	ip := net.ParseIP(raw)
	if ip == nil {
		return "", fmt.Errorf("ip check response did not contain a valid IP address")
	}
	return ip.String(), nil
}

// proxyRow converts a proxy model into a response payload.
func proxyRow(row *models.Proxy) gin.H {
	if row == nil {
		return gin.H{}
	}
	return gin.H{
		"id":              row.ID,
		"proxy_url":       row.ProxyURL,
		"is_active":       row.IsActive,
		"test_status":     row.TestStatus,
		"last_tested_at":  row.LastTestedAt,
		"last_error":      row.LastError,
		"last_checked_ip": row.LastCheckedIP,
		"created_at":      row.CreatedAt,
		"updated_at":      row.UpdatedAt,
	}
}
