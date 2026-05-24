package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/runtime/executor/helps"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
)

const (
	kiroModelCacheTTL        = 5 * time.Minute
	kiroRuntimeSDKVersion    = "1.0.0"
	kiroAgentOS              = "windows"
	kiroAgentOSVersion       = "10.0.26200"
	kiroNodeVersion          = "22.21.1"
	kiroIDEVersion           = "0.10.32"
	kiroModelListHTTPTimeout = 30 * time.Second
)

var kiroCatalogCache sync.Map

type kiroCatalogCacheEntry struct {
	models    []*registry.ModelInfo
	expiresAt time.Time
}

// ListAvailableModels fetches Kiro's live model catalog for one auth row,
// refreshing the access token before the request and once more on token errors.
func (e *KiroExecutor) ListAvailableModels(ctx context.Context, auth *cliproxyauth.Auth, forceRefresh bool) ([]*registry.ModelInfo, *cliproxyauth.Auth, error) {
	if auth == nil {
		return nil, nil, fmt.Errorf("kiro models: auth is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	current := auth.Clone()
	meta, err := cliproxyauth.ParseKiroMetadata(current)
	if err != nil {
		return nil, nil, err
	}
	if meta.ShouldRefresh(time.Now().UTC(), kiroRefreshLead) {
		refreshed, err := e.Refresh(ctx, current)
		if err != nil {
			return nil, nil, err
		}
		current = refreshed
		meta, err = cliproxyauth.ParseKiroMetadata(current)
		if err != nil {
			return nil, nil, err
		}
	}

	cacheKey := kiroCatalogCacheKey(current, meta)
	if !forceRefresh {
		if cached, ok := kiroCatalogCache.Load(cacheKey); ok {
			entry, _ := cached.(kiroCatalogCacheEntry)
			if time.Now().UTC().Before(entry.expiresAt) {
				return cloneKiroModelInfos(entry.models), current, nil
			}
		}
	}

	rawModels, err := e.fetchKiroCatalogRaw(ctx, current, meta)
	if err != nil && shouldRefreshKiroCatalogAfterError(err) {
		refreshed, refreshErr := e.Refresh(ctx, current)
		if refreshErr != nil {
			return nil, nil, refreshErr
		}
		current = refreshed
		meta, err = cliproxyauth.ParseKiroMetadata(current)
		if err != nil {
			return nil, nil, err
		}
		rawModels, err = e.fetchKiroCatalogRaw(ctx, current, meta)
	}
	if err != nil {
		return nil, current, err
	}

	models := expandKiroRawModels(rawModels)
	kiroCatalogCache.Store(cacheKey, kiroCatalogCacheEntry{
		models:    cloneKiroModelInfos(models),
		expiresAt: time.Now().UTC().Add(kiroModelCacheTTL),
	})
	meta.ModelCatalogCachedAt = time.Now().UTC()
	cliproxyauth.ApplyKiroMetadata(current, meta)
	return models, current, nil
}

func (e *KiroExecutor) fetchKiroCatalogRaw(ctx context.Context, auth *cliproxyauth.Auth, meta cliproxyauth.KiroMetadata) ([]kiroRawModel, error) {
	region := strings.TrimSpace(meta.Region)
	if region == "" {
		region = kiroDefaultRegion
	}
	values := url.Values{}
	values.Set("origin", "AI_EDITOR")
	if strings.TrimSpace(meta.ProfileARN) != "" {
		values.Set("profileArn", meta.ProfileARN)
	}
	targetURL := fmt.Sprintf("https://q.%s.amazonaws.com/ListAvailableModels?%s", region, values.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}
	for key, values := range buildKiroFingerprintHeaders(auth, meta) {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	req.Header.Set("Authorization", "Bearer "+meta.AccessToken)

	client := helps.NewProxyAwareHTTPClient(ctx, e.cfg, auth, kiroModelListHTTPTimeout)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, statusErr{code: resp.StatusCode, msg: safeKiroHTTPError(resp.StatusCode, body)}
	}
	var decoded struct {
		Models []kiroRawModel `json:"models"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, fmt.Errorf("kiro models: decode ListAvailableModels response: %w", err)
	}
	return decoded.Models, nil
}

type kiroRawModel struct {
	ID             string `json:"id"`
	ModelID        string `json:"modelId"`
	Name           string `json:"name"`
	ModelName      string `json:"modelName"`
	Description    string `json:"description"`
	RateMultiplier any    `json:"rateMultiplier"`
	TokenLimits    struct {
		MaxInputTokens int `json:"maxInputTokens"`
	} `json:"tokenLimits"`
}

func expandKiroRawModels(rawModels []kiroRawModel) []*registry.ModelInfo {
	baseModels := make([]*registry.ModelInfo, 0, len(rawModels))
	now := time.Now().Unix()
	for _, raw := range rawModels {
		id := strings.TrimSpace(raw.ModelID)
		if id == "" {
			id = strings.TrimSpace(raw.ID)
		}
		if id == "" {
			continue
		}
		display := strings.TrimSpace(raw.ModelName)
		if display == "" {
			display = strings.TrimSpace(raw.Name)
		}
		if display == "" {
			display = id
		}
		display = "Kiro " + display
		if rate := kiroRateMultiplier(raw.RateMultiplier); rate > 0 && rate != 1 {
			display = fmt.Sprintf("%s (%.1fx credit)", display, rate)
		}
		contextLength := raw.TokenLimits.MaxInputTokens
		if contextLength <= 0 {
			contextLength = 200000
		}
		baseModels = append(baseModels, &registry.ModelInfo{
			ID:              id,
			Object:          "model",
			Created:         now,
			OwnedBy:         "amazon",
			Type:            "kiro",
			DisplayName:     display,
			Description:     raw.Description,
			ContextLength:   contextLength,
			UpstreamModelID: id,
		})
	}
	return registry.WithKiroVariants(baseModels)
}

func buildKiroFingerprintHeaders(auth *cliproxyauth.Auth, meta cliproxyauth.KiroMetadata) http.Header {
	seed := meta.ClientID
	if strings.TrimSpace(seed) == "" {
		seed = meta.RefreshToken
	}
	if strings.TrimSpace(seed) == "" {
		seed = meta.ProfileARN
	}
	if strings.TrimSpace(seed) == "" {
		seed = meta.AccessToken
	}
	if strings.TrimSpace(seed) == "" && auth != nil {
		seed = auth.ID
	}
	sum := sha256.Sum256([]byte("kiro:" + seed))
	machineID := hex.EncodeToString(sum[:])
	userAgent := fmt.Sprintf(
		"aws-sdk-js/%s ua/2.1 os/%s#%s lang/js md/nodejs#%s api/codewhispererruntime#%s m/N,E KiroIDE-%s-%s",
		kiroRuntimeSDKVersion,
		kiroAgentOS,
		kiroAgentOSVersion,
		kiroNodeVersion,
		kiroRuntimeSDKVersion,
		kiroIDEVersion,
		machineID,
	)
	headers := http.Header{}
	headers.Set("User-Agent", userAgent)
	headers.Set("x-amz-user-agent", fmt.Sprintf("aws-sdk-js/%s KiroIDE-%s-%s", kiroRuntimeSDKVersion, kiroIDEVersion, machineID))
	headers.Set("x-amzn-kiro-agent-mode", "vibe")
	headers.Set("x-amzn-codewhisperer-optout", "true")
	headers.Set("amz-sdk-request", "attempt=1; max=1")
	headers.Set("amz-sdk-invocation-id", uuid.NewString())
	headers.Set("Accept", "application/json")
	return headers
}

func kiroCatalogCacheKey(auth *cliproxyauth.Auth, meta cliproxyauth.KiroMetadata) string {
	seed := ""
	if auth != nil {
		seed = auth.ID
	}
	if seed == "" {
		seed = meta.ProfileARN
	}
	if seed == "" {
		seed = meta.ClientID
	}
	if seed == "" {
		seed = meta.RefreshToken
	}
	sum := sha256.Sum256([]byte("kiro-catalog:" + seed))
	return hex.EncodeToString(sum[:])
}

func shouldRefreshKiroCatalogAfterError(err error) bool {
	if err == nil {
		return false
	}
	if se, ok := err.(cliproxyexecutor.StatusError); ok && se != nil {
		return cliproxyauth.IsKiroTokenAuthError(se.StatusCode(), err.Error())
	}
	return false
}

func kiroRateMultiplier(raw any) float64 {
	switch value := raw.(type) {
	case float64:
		return value
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case json.Number:
		f, _ := value.Float64()
		return f
	default:
		return 0
	}
}

func cloneKiroModelInfos(models []*registry.ModelInfo) []*registry.ModelInfo {
	if len(models) == 0 {
		return nil
	}
	out := make([]*registry.ModelInfo, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		copyModel := *model
		if len(model.SupportedGenerationMethods) > 0 {
			copyModel.SupportedGenerationMethods = append([]string(nil), model.SupportedGenerationMethods...)
		}
		if len(model.SupportedParameters) > 0 {
			copyModel.SupportedParameters = append([]string(nil), model.SupportedParameters...)
		}
		if len(model.SupportedInputModalities) > 0 {
			copyModel.SupportedInputModalities = append([]string(nil), model.SupportedInputModalities...)
		}
		if len(model.SupportedOutputModalities) > 0 {
			copyModel.SupportedOutputModalities = append([]string(nil), model.SupportedOutputModalities...)
		}
		if model.Thinking != nil {
			thinking := *model.Thinking
			if len(model.Thinking.Levels) > 0 {
				thinking.Levels = append([]string(nil), model.Thinking.Levels...)
			}
			copyModel.Thinking = &thinking
		}
		out = append(out, &copyModel)
	}
	return out
}
