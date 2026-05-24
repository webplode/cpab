package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

var refreshSupportedModelsCatalog = cliproxy.RefreshGlobalModelCatalog

// ModelMappingHandler manages admin CRUD endpoints for model mappings.
type ModelMappingHandler struct {
	db     *gorm.DB    // Database handle for model mapping records.
	engine *gin.Engine // Full router used for in-process model test requests.
}

// NewModelMappingHandler constructs a model mapping handler.
func NewModelMappingHandler(db *gorm.DB, engine ...*gin.Engine) *ModelMappingHandler {
	h := &ModelMappingHandler{db: db}
	if len(engine) > 0 {
		h.engine = engine[0]
	}
	return h
}

// createModelMappingRequest captures the payload for creating a model mapping.
type createModelMappingRequest struct {
	Provider     string              `json:"provider"`       // Provider identifier.
	ModelName    string              `json:"model_name"`     // Source model name.
	NewModelName string              `json:"new_model_name"` // Target model name.
	UserGroupID  models.UserGroupIDs `json:"user_group_id"`  // Allowed user group IDs.
	IsEnabled    *bool               `json:"is_enabled"`     // Optional active flag.
	Fork         *bool               `json:"fork"`           // Optional fork flag.
	Selector     *int                `json:"selector"`       // Optional routing selector.
	RateLimit    *int                `json:"rate_limit"`     // Optional rate limit per second.
}

// Create validates input and inserts a new model mapping.
func (h *ModelMappingHandler) Create(c *gin.Context) {
	var body createModelMappingRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	if strings.TrimSpace(body.Provider) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}
	if strings.TrimSpace(body.ModelName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "model_name is required"})
		return
	}
	if strings.TrimSpace(body.NewModelName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new_model_name is required"})
		return
	}

	isEnabled := true
	if body.IsEnabled != nil {
		isEnabled = *body.IsEnabled
	}
	fork := false
	if body.Fork != nil {
		fork = *body.Fork
	}
	selector := 0
	if body.Selector != nil {
		selector = *body.Selector
		if selector < 0 || selector > 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "selector must be 0, 1, or 2"})
			return
		}
	}
	rateLimit := 0
	if body.RateLimit != nil {
		rateLimit = *body.RateLimit
	}

	now := time.Now().UTC()
	mapping := models.ModelMapping{
		Provider:     strings.TrimSpace(body.Provider),
		ModelName:    strings.TrimSpace(body.ModelName),
		NewModelName: strings.TrimSpace(body.NewModelName),
		Fork:         fork,
		Selector:     selector,
		RateLimit:    rateLimit,
		UserGroupID:  body.UserGroupID.Clean(),
		IsEnabled:    isEnabled,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if errCreate := h.db.WithContext(c.Request.Context()).Create(&mapping).Error; errCreate != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create model mapping failed"})
		return
	}
	c.JSON(http.StatusCreated, h.formatMapping(&mapping))
}

// List returns model mappings filtered by query parameters.
func (h *ModelMappingHandler) List(c *gin.Context) {
	var (
		providerQ  = strings.TrimSpace(c.Query("provider"))
		modelNameQ = strings.TrimSpace(c.Query("model_name"))
		enabledQ   = strings.TrimSpace(c.Query("is_enabled"))
	)

	q := h.db.WithContext(c.Request.Context()).Model(&models.ModelMapping{})
	if providerQ != "" {
		q = q.Where("provider = ?", providerQ)
	}
	if modelNameQ != "" {
		q = q.Where("model_name = ?", modelNameQ)
	}
	if enabledQ != "" {
		if enabledQ == "true" || enabledQ == "1" {
			q = q.Where("is_enabled = ?", true)
		} else if enabledQ == "false" || enabledQ == "0" {
			q = q.Where("is_enabled = ?", false)
		}
	}

	var rows []models.ModelMapping
	if errFind := q.Order("created_at DESC").Find(&rows).Error; errFind != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list model mappings failed"})
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, h.formatMapping(&row))
	}
	c.JSON(http.StatusOK, gin.H{"model_mappings": out})
}

// Get fetches a model mapping by ID.
func (h *ModelMappingHandler) Get(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var mapping models.ModelMapping
	if errFind := h.db.WithContext(c.Request.Context()).First(&mapping, id).Error; errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	c.JSON(http.StatusOK, h.formatMapping(&mapping))
}

// updateModelMappingRequest captures optional fields for mapping updates.
type updateModelMappingRequest struct {
	Provider     *string              `json:"provider"`       // Optional provider.
	ModelName    *string              `json:"model_name"`     // Optional source model name.
	NewModelName *string              `json:"new_model_name"` // Optional target model name.
	UserGroupID  *models.UserGroupIDs `json:"user_group_id"`  // Optional allowed user group IDs.
	IsEnabled    *bool                `json:"is_enabled"`     // Optional active flag.
	Fork         *bool                `json:"fork"`           // Optional fork flag.
	Selector     *int                 `json:"selector"`       // Optional routing selector.
	RateLimit    *int                 `json:"rate_limit"`     // Optional rate limit per second.
}

// Update validates and applies model mapping field updates.
func (h *ModelMappingHandler) Update(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var body updateModelMappingRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	var existing models.ModelMapping
	if errFind := h.db.WithContext(c.Request.Context()).First(&existing, id).Error; errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}

	updates := map[string]any{
		"updated_at": time.Now().UTC(),
	}

	if body.Provider != nil {
		p := strings.TrimSpace(*body.Provider)
		if p == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "provider cannot be empty"})
			return
		}
		updates["provider"] = p
	}
	if body.ModelName != nil {
		m := strings.TrimSpace(*body.ModelName)
		if m == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "model_name cannot be empty"})
			return
		}
		updates["model_name"] = m
	}
	if body.NewModelName != nil {
		n := strings.TrimSpace(*body.NewModelName)
		if n == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "new_model_name cannot be empty"})
			return
		}
		updates["new_model_name"] = n
	}
	if body.IsEnabled != nil {
		updates["is_enabled"] = *body.IsEnabled
	}
	if body.Fork != nil {
		updates["fork"] = *body.Fork
	}
	if body.Selector != nil {
		selector := *body.Selector
		if selector < 0 || selector > 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "selector must be 0, 1, or 2"})
			return
		}
		updates["selector"] = selector
	}
	if body.RateLimit != nil {
		updates["rate_limit"] = *body.RateLimit
	}
	if body.UserGroupID != nil {
		updates["user_group_id"] = body.UserGroupID.Clean()
	}

	res := h.db.WithContext(c.Request.Context()).Model(&models.ModelMapping{}).Where("id = ?", id).Updates(updates)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Delete removes a model mapping by ID.
func (h *ModelMappingHandler) Delete(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	res := h.db.WithContext(c.Request.Context()).Delete(&models.ModelMapping{}, id)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

// Enable marks a model mapping as enabled.
func (h *ModelMappingHandler) Enable(c *gin.Context) {
	h.setEnabled(c, true)
}

// Disable marks a model mapping as disabled.
func (h *ModelMappingHandler) Disable(c *gin.Context) {
	h.setEnabled(c, false)
}

// setEnabled toggles the enabled state for a model mapping.
func (h *ModelMappingHandler) setEnabled(c *gin.Context, enabled bool) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	now := time.Now().UTC()
	res := h.db.WithContext(c.Request.Context()).Model(&models.ModelMapping{}).Where("id = ?", id).
		Updates(map[string]any{"is_enabled": enabled, "updated_at": now})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// formatMapping converts a model mapping into a response payload.
func (h *ModelMappingHandler) formatMapping(m *models.ModelMapping) gin.H {
	return gin.H{
		"id":             m.ID,
		"provider":       m.Provider,
		"model_name":     m.ModelName,
		"new_model_name": m.NewModelName,
		"fork":           m.Fork,
		"selector":       m.Selector,
		"rate_limit":     m.RateLimit,
		"user_group_id":  m.UserGroupID.Clean(),
		"is_enabled":     m.IsEnabled,
		"created_at":     m.CreatedAt,
		"updated_at":     m.UpdatedAt,
	}
}

// AvailableModels lists mapped or provider-supported models based on query.
func (h *ModelMappingHandler) AvailableModels(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Query("provider")))
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	mappedQ := strings.TrimSpace(c.Query("mapped"))
	if mappedQ == "1" || strings.EqualFold(mappedQ, "true") {
		var result []string
		if errFind := h.db.WithContext(c.Request.Context()).
			Model(&models.ModelMapping{}).
			Distinct("new_model_name").
			Where("LOWER(provider) = ? AND is_enabled = ?", provider, true).
			Where("new_model_name <> ''").
			Order("new_model_name ASC").
			Pluck("new_model_name", &result).Error; errFind != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "list mapped models failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"models": result})
		return
	}
	infos := cliproxy.GlobalModelRegistry().GetAvailableModelsByProvider(provider)
	result := make([]string, 0, len(infos))
	for _, info := range infos {
		if info != nil && info.ID != "" {
			result = append(result, info.ID)
		}
	}
	c.JSON(http.StatusOK, gin.H{"models": result})
}

// RefreshSupportedModels fetches the latest remote model catalog and rebinds supported models.
func (h *ModelMappingHandler) RefreshSupportedModels(c *gin.Context) {
	result, err := refreshSupportedModelsCatalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":                true,
		"source":            result.Source,
		"changed_providers": result.ChangedProviders,
	})
}

type modelTestRequest struct {
	Provider       string           `json:"provider"`
	Model          string           `json:"model"`
	Models         []string         `json:"models"`
	APIKey         string           `json:"api_key"`
	APIKeyID       *uint64          `json:"api_key_id"`
	Prompt         string           `json:"prompt"`
	Messages       []map[string]any `json:"messages"`
	MaxTokens      int              `json:"max_tokens"`
	TimeoutSeconds int              `json:"timeout_seconds"`
	MaxConcurrency int              `json:"max_concurrency"`
}

type modelTestResult struct {
	Model      string `json:"model"`
	OK         bool   `json:"ok"`
	LatencyMS  int64  `json:"latency_ms"`
	StatusCode int    `json:"status_code,omitempty"`
	ErrorType  string `json:"error_type,omitempty"`
	Error      string `json:"error,omitempty"`
	Preview    string `json:"preview,omitempty"`
}

type resolvedModelTestAPIKey struct {
	value string
	id    *uint64
}

// TestModel sends a small request through the normal /v1/chat/completions path.
func (h *ModelMappingHandler) TestModel(c *gin.Context) {
	var body modelTestRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	model := strings.TrimSpace(body.Model)
	if model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "model is required"})
		return
	}
	apiKey, statusCode, errMsg := h.resolveModelTestAPIKey(c.Request.Context(), body)
	if errMsg != "" {
		c.JSON(statusCode, gin.H{"error": errMsg})
		return
	}
	result := h.runModelTest(c.Request.Context(), model, apiKey, body)
	c.JSON(http.StatusOK, result)
}

// BatchTestModels tests multiple models, warming the first model before parallel checks.
func (h *ModelMappingHandler) BatchTestModels(c *gin.Context) {
	var body modelTestRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	modelsToTest := normalizeModelList(body.Models)
	provider := strings.ToLower(strings.TrimSpace(body.Provider))
	if provider == "" {
		provider = cliproxyauth.KiroProvider
	}
	if len(modelsToTest) == 0 {
		modelsToTest = h.availableProviderModels(provider)
	}
	if len(modelsToTest) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "models are required"})
		return
	}
	apiKey, statusCode, errMsg := h.resolveModelTestAPIKey(c.Request.Context(), body)
	if errMsg != "" {
		c.JSON(statusCode, gin.H{"error": errMsg})
		return
	}

	results := make([]modelTestResult, len(modelsToTest))
	results[0] = h.runModelTest(c.Request.Context(), modelsToTest[0], apiKey, body)

	concurrency := body.MaxConcurrency
	if concurrency <= 0 {
		concurrency = 4
	}
	if concurrency > 8 {
		concurrency = 8
	}
	if concurrency > len(modelsToTest) {
		concurrency = len(modelsToTest)
	}
	if concurrency < 1 {
		concurrency = 1
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	for i := 1; i < len(modelsToTest); i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i] = h.runModelTest(c.Request.Context(), modelsToTest[i], apiKey, body)
		}()
	}
	wg.Wait()

	okCount := 0
	for _, result := range results {
		if result.OK {
			okCount++
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
		"summary": gin.H{
			"total":  len(results),
			"ok":     okCount,
			"failed": len(results) - okCount,
		},
		"results": results,
	})
}

func (h *ModelMappingHandler) resolveModelTestAPIKey(ctx context.Context, body modelTestRequest) (resolvedModelTestAPIKey, int, string) {
	if direct := strings.TrimSpace(body.APIKey); direct != "" {
		return resolvedModelTestAPIKey{value: direct}, 0, ""
	}
	if body.APIKeyID == nil || *body.APIKeyID == 0 {
		return resolvedModelTestAPIKey{}, http.StatusBadRequest, "api_key or api_key_id is required"
	}
	if h == nil || h.db == nil {
		return resolvedModelTestAPIKey{}, http.StatusServiceUnavailable, "api key lookup is unavailable"
	}
	now := time.Now().UTC()
	var row models.APIKey
	errFind := h.db.WithContext(ctx).
		Where("id = ? AND active = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", *body.APIKeyID, true, now).
		First(&row).Error
	if errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			return resolvedModelTestAPIKey{}, http.StatusNotFound, "api key not found"
		}
		return resolvedModelTestAPIKey{}, http.StatusInternalServerError, "api key lookup failed"
	}
	id := row.ID
	return resolvedModelTestAPIKey{value: row.APIKey, id: &id}, 0, ""
}

func (h *ModelMappingHandler) runModelTest(ctx context.Context, model string, apiKey resolvedModelTestAPIKey, body modelTestRequest) modelTestResult {
	model = strings.TrimSpace(model)
	result := modelTestResult{Model: model}
	if h == nil || h.engine == nil {
		result.StatusCode = http.StatusServiceUnavailable
		result.ErrorType = "request_failed"
		result.Error = "model test router is unavailable"
		return result
	}
	if model == "" {
		result.StatusCode = http.StatusBadRequest
		result.ErrorType = "model_unavailable"
		result.Error = "model is required"
		return result
	}

	timeout := time.Duration(body.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if timeout > 2*time.Minute {
		timeout = 2 * time.Minute
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	payload, errPayload := buildModelTestPayload(model, body)
	if errPayload != nil {
		result.StatusCode = http.StatusBadRequest
		result.ErrorType = "request_failed"
		result.Error = errPayload.Error()
		return result
	}

	recorder := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(reqCtx, http.MethodPost, "/v1/chat/completions", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+apiKey.value)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	done := make(chan struct{})
	go func() {
		h.engine.ServeHTTP(recorder, req)
		close(done)
	}()
	select {
	case <-done:
	case <-reqCtx.Done():
		result.LatencyMS = time.Since(start).Milliseconds()
		result.StatusCode = http.StatusGatewayTimeout
		result.ErrorType = classifyModelTestError(result.StatusCode, reqCtx.Err().Error())
		result.Error = reqCtx.Err().Error()
		return result
	}

	result.LatencyMS = time.Since(start).Milliseconds()
	result.StatusCode = recorder.Code
	responseBody := redactModelTestText(recorder.Body.String(), apiKey.value)
	if recorder.Code >= 200 && recorder.Code < 300 {
		result.OK = true
		result.Preview = truncateModelTestText(responseBody)
		return result
	}
	result.ErrorType = classifyModelTestError(recorder.Code, responseBody)
	result.Error = truncateModelTestText(responseBody)
	return result
}

func buildModelTestPayload(model string, body modelTestRequest) ([]byte, error) {
	messages := body.Messages
	if len(messages) == 0 {
		prompt := strings.TrimSpace(body.Prompt)
		if prompt == "" {
			prompt = "Reply with OK."
		}
		messages = []map[string]any{{"role": "user", "content": prompt}}
	}
	maxTokens := body.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 16
	}
	payload := map[string]any{
		"model":      model,
		"messages":   messages,
		"stream":     false,
		"max_tokens": maxTokens,
	}
	return json.Marshal(payload)
}

func normalizeModelList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		model := strings.TrimSpace(value)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		out = append(out, model)
	}
	return out
}

func (h *ModelMappingHandler) availableProviderModels(provider string) []string {
	infos := cliproxy.GlobalModelRegistry().GetAvailableModelsByProvider(provider)
	out := make([]string, 0, len(infos))
	seen := make(map[string]struct{}, len(infos))
	for _, info := range infos {
		if info == nil {
			continue
		}
		model := strings.TrimSpace(info.ID)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		out = append(out, model)
	}
	sort.Strings(out)
	return out
}

func classifyModelTestError(statusCode int, text string) string {
	lower := strings.ToLower(strings.TrimSpace(text))
	switch {
	case statusCode == http.StatusGatewayTimeout || strings.Contains(lower, "deadline exceeded") || strings.Contains(lower, "timeout"):
		return "timeout"
	case strings.Contains(lower, "client disconnect") || strings.Contains(lower, "client canceled") || strings.Contains(lower, "context canceled") || strings.Contains(lower, "broken pipe"):
		return "client_disconnect"
	case strings.Contains(lower, "invalid bearer") || strings.Contains(lower, "invalid token") || strings.Contains(lower, "access token"):
		return "invalid_bearer_token"
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return "auth_failure"
	case statusCode == http.StatusNotFound || strings.Contains(lower, "model not") || strings.Contains(lower, "model unavailable") || strings.Contains(lower, "unsupported model"):
		return "model_unavailable"
	case strings.Contains(lower, "proxy") || strings.Contains(lower, "socks") || strings.Contains(lower, "connection refused") || strings.Contains(lower, "no such host") || strings.Contains(lower, "dial tcp"):
		return "proxy_failure"
	case strings.Contains(lower, "eof") || strings.Contains(lower, "terminated") || strings.Contains(lower, "connection reset") || strings.Contains(lower, "upstream close"):
		return "upstream_close"
	case statusCode >= http.StatusInternalServerError:
		return "upstream_error"
	default:
		return "request_failed"
	}
}

func redactModelTestText(text string, apiKey string) string {
	text = strings.TrimSpace(text)
	if apiKey = strings.TrimSpace(apiKey); apiKey != "" {
		text = strings.ReplaceAll(text, apiKey, "[redacted]")
	}
	lower := strings.ToLower(text)
	for _, marker := range []string{"refresh_token", "access_token", "client_secret", "refreshtoken", "accesstoken", "clientsecret"} {
		if strings.Contains(lower, marker) {
			return "response body contained token fields and was redacted"
		}
	}
	return text
}

func truncateModelTestText(text string) string {
	const maxLen = 512
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen]
}
