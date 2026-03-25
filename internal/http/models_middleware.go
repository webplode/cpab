package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	sdkcliproxy "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/modelmapping"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/modelregistry"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"
	"gorm.io/gorm"
)

// CLIProxyModelsMiddleware serves model list responses with optional DB mappings.
func CLIProxyModelsMiddleware(db *gorm.DB, store *modelregistry.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c == nil || c.Request == nil || c.Request.URL == nil {
			if c != nil {
				c.Next()
			}
			return
		}

		if c.Request.Method != http.MethodGet {
			c.Next()
			return
		}

		path := normalizeRequestPath(c.Request.URL.Path)
		switch path {
		case "/v1/models", "/v1beta/models":
			if !authenticateModelsRequest(c, db) {
				return
			}
		}

		switch path {
		case "/v1/models":
			onlyMapped := dbConfigBool("ONLY_MAPPED_MODELS")
			userGroups, billUserGroups, okUser := loadUserGroupMembership(c, db)
			userAgent := c.GetHeader("User-Agent")
			if strings.HasPrefix(userAgent, "claude-cli") {
				if !onlyMapped {
					data := sdkcliproxy.GlobalModelRegistry().GetAvailableModels("claude")
					if okUser {
						data = filterOpenAIRegistryModelsByUserGroups(data, "claude", userGroups, billUserGroups)
					}
					c.AbortWithStatusJSON(http.StatusOK, gin.H{"data": data})
					return
				}

				modelInfos, errList := listMappedModelInfos(c.Request.Context(), db, store)
				if errList != nil {
					c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "list models failed"})
					return
				}

				if okUser {
					modelInfos = filterModelInfosByUserGroups(modelInfos, userGroups, billUserGroups)
				}

				data := make([]map[string]any, 0, len(modelInfos))
				for _, info := range modelInfos {
					m := convertModelToMap(info, "claude")
					if m != nil {
						data = append(data, m)
					}
				}
				c.AbortWithStatusJSON(http.StatusOK, gin.H{"data": data})
				return
			}

			if !onlyMapped {
				allModels := sdkcliproxy.GlobalModelRegistry().GetAvailableModels("openai")
				filtered := make([]map[string]any, 0, len(allModels))
				for _, model := range allModels {
					if okUser {
						if id, ok := model["id"].(string); ok && strings.TrimSpace(id) != "" {
							if allowed, okAllowed := modelmapping.LookupUserGroupIDs("openai", strings.TrimSpace(id)); okAllowed && len(allowed.Clean()) > 0 {
								if !hasAnyAllowedUserGroup(allowed, userGroups, billUserGroups) {
									continue
								}
							}
						}
					}
					filteredModel := map[string]any{
						"id":     model["id"],
						"object": model["object"],
					}
					if created, exists := model["created"]; exists {
						filteredModel["created"] = created
					}
					if ownedBy, exists := model["owned_by"]; exists {
						filteredModel["owned_by"] = ownedBy
					}
					filtered = append(filtered, filteredModel)
				}
				c.AbortWithStatusJSON(http.StatusOK, gin.H{"object": "list", "data": filtered})
				return
			}

			modelInfos, errList := listMappedModelInfos(c.Request.Context(), db, store)
			if errList != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "list models failed"})
				return
			}

			if okUser {
				modelInfos = filterModelInfosByUserGroups(modelInfos, userGroups, billUserGroups)
			}

			data := make([]map[string]any, 0, len(modelInfos))
			for _, info := range modelInfos {
				if info == nil || strings.TrimSpace(info.ID) == "" {
					continue
				}
				item := map[string]any{
					"id":       info.ID,
					"object":   "model",
					"owned_by": info.OwnedBy,
				}
				if info.Created > 0 {
					item["created"] = info.Created
				}
				data = append(data, item)
			}

			c.AbortWithStatusJSON(http.StatusOK, gin.H{"object": "list", "data": data})
			return

		case "/v1beta/models":
			onlyMapped := dbConfigBool("ONLY_MAPPED_MODELS")
			userGroups, billUserGroups, okUser := loadUserGroupMembership(c, db)
			rawModels := make([]map[string]any, 0)
			if !onlyMapped {
				rawModels = sdkcliproxy.GlobalModelRegistry().GetAvailableModels("gemini")
				if okUser {
					rawModels = filterGeminiRegistryModelsByUserGroups(rawModels, userGroups, billUserGroups)
				}
			} else {
				modelInfos, errList := listMappedModelInfos(c.Request.Context(), db, store)
				if errList != nil {
					c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "list models failed"})
					return
				}
				if okUser {
					modelInfos = filterModelInfosByUserGroups(modelInfos, userGroups, billUserGroups)
				}

				rawModels = make([]map[string]any, 0, len(modelInfos))
				for _, info := range modelInfos {
					m := convertModelToMap(info, "gemini")
					if m != nil {
						rawModels = append(rawModels, m)
					}
				}
			}

			normalizedModels := make([]map[string]any, 0, len(rawModels))
			defaultMethods := []string{"generateContent"}
			for _, model := range rawModels {
				normalizedModel := make(map[string]any, len(model))
				for k, v := range model {
					normalizedModel[k] = v
				}
				if name, ok := normalizedModel["name"].(string); ok && name != "" && !strings.HasPrefix(name, "models/") {
					normalizedModel["name"] = "models/" + name
				}
				if _, ok := normalizedModel["supportedGenerationMethods"]; !ok {
					normalizedModel["supportedGenerationMethods"] = defaultMethods
				}
				normalizedModels = append(normalizedModels, normalizedModel)
			}

			c.AbortWithStatusJSON(http.StatusOK, gin.H{"models": normalizedModels})
			return
		default:
			c.Next()
			return
		}
	}
}

func loadUserGroupMembership(c *gin.Context, db *gorm.DB) (models.UserGroupIDs, models.UserGroupIDs, bool) {
	if c == nil || db == nil {
		return nil, nil, false
	}
	v, exists := c.Get("accessMetadata")
	if !exists {
		return nil, nil, false
	}
	meta, ok := v.(map[string]string)
	if !ok {
		return nil, nil, false
	}
	rawUserID := strings.TrimSpace(meta["user_id"])
	if rawUserID == "" {
		return nil, nil, false
	}
	parsed, errParse := strconv.ParseUint(rawUserID, 10, 64)
	if errParse != nil || parsed == 0 {
		return nil, nil, false
	}
	var user models.User
	if errFind := db.WithContext(c.Request.Context()).
		Select("user_group_id", "bill_user_group_id").
		First(&user, parsed).Error; errFind != nil {
		return nil, nil, false
	}
	return user.UserGroupID.Clean(), user.BillUserGroupID.Clean(), true
}

func hasAnyAllowedUserGroup(allowed, userGroups, billUserGroups models.UserGroupIDs) bool {
	allowed = allowed.Clean()
	if len(allowed) == 0 {
		return true
	}
	membership := make(map[uint64]struct{}, len(userGroups)+len(billUserGroups))
	for _, id := range userGroups.Values() {
		if id == 0 {
			continue
		}
		membership[id] = struct{}{}
	}
	for _, id := range billUserGroups.Values() {
		if id == 0 {
			continue
		}
		membership[id] = struct{}{}
	}
	for _, id := range allowed {
		if id == nil || *id == 0 {
			continue
		}
		if _, ok := membership[*id]; ok {
			return true
		}
	}
	return false
}

func filterOpenAIRegistryModelsByUserGroups(raw []map[string]any, provider string, userGroups, billUserGroups models.UserGroupIDs) []map[string]any {
	provider = strings.TrimSpace(provider)
	if provider == "" || len(raw) == 0 {
		return raw
	}
	filtered := make([]map[string]any, 0, len(raw))
	for _, model := range raw {
		id, _ := model["id"].(string)
		id = strings.TrimSpace(id)
		if id != "" {
			if allowed, okAllowed := modelmapping.LookupUserGroupIDs(provider, id); okAllowed && len(allowed.Clean()) > 0 {
				if !hasAnyAllowedUserGroup(allowed, userGroups, billUserGroups) {
					continue
				}
			}
		}
		filtered = append(filtered, model)
	}
	return filtered
}

func filterGeminiRegistryModelsByUserGroups(raw []map[string]any, userGroups, billUserGroups models.UserGroupIDs) []map[string]any {
	if len(raw) == 0 {
		return raw
	}
	filtered := make([]map[string]any, 0, len(raw))
	for _, model := range raw {
		name, _ := model["name"].(string)
		name = strings.TrimSpace(name)
		lookup := strings.TrimPrefix(name, "models/")
		if lookup == "" {
			lookup = name
		}
		if lookup != "" {
			if allowed, okAllowed := modelmapping.LookupUserGroupIDs("gemini", lookup); okAllowed && len(allowed.Clean()) > 0 {
				if !hasAnyAllowedUserGroup(allowed, userGroups, billUserGroups) {
					continue
				}
			}
		}
		filtered = append(filtered, model)
	}
	return filtered
}

func filterModelInfosByUserGroups(raw []*sdkcliproxy.ModelInfo, userGroups, billUserGroups models.UserGroupIDs) []*sdkcliproxy.ModelInfo {
	if len(raw) == 0 {
		return raw
	}
	filtered := make([]*sdkcliproxy.ModelInfo, 0, len(raw))
	for _, info := range raw {
		if info == nil {
			continue
		}
		modelID := strings.TrimSpace(info.ID)
		if modelID == "" {
			continue
		}
		provider := strings.ToLower(strings.TrimSpace(info.OwnedBy))
		if provider != "" {
			if allowed, okAllowed := modelmapping.LookupUserGroupIDs(provider, modelID); okAllowed && len(allowed.Clean()) > 0 {
				if !hasAnyAllowedUserGroup(allowed, userGroups, billUserGroups) {
					continue
				}
			}
		}
		filtered = append(filtered, info)
	}
	return filtered
}

// normalizeRequestPath trims trailing slashes for route matching.
func normalizeRequestPath(path string) string {
	path = strings.TrimSpace(path)
	if strings.HasSuffix(path, "/") && len(path) > 1 {
		path = strings.TrimSuffix(path, "/")
	}
	return path
}

// dbConfigBool reads a boolean from the DB config snapshot.
func dbConfigBool(key string) bool {
	raw, ok := internalsettings.DBConfigValue(key)
	if !ok {
		return false
	}
	return parseDBConfigBool(raw)
}

// parseDBConfigBool parses a JSON boolean from DB config payloads.
func parseDBConfigBool(raw json.RawMessage) bool {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return false
	}
	var b bool
	if errUnmarshal := json.Unmarshal(raw, &b); errUnmarshal == nil {
		return b
	}
	var s string
	if errUnmarshal := json.Unmarshal(raw, &s); errUnmarshal == nil {
		s = strings.TrimSpace(s)
		if s == "" {
			return false
		}
		if strings.EqualFold(s, "true") || s == "1" {
			return true
		}
		return false
	}
	var n float64
	if errUnmarshal := json.Unmarshal(raw, &n); errUnmarshal == nil {
		return n != 0
	}
	var wrapper struct {
		Value json.RawMessage `json:"value"`
	}
	if errUnmarshal := json.Unmarshal(raw, &wrapper); errUnmarshal == nil {
		if len(wrapper.Value) > 0 {
			return parseDBConfigBool(wrapper.Value)
		}
	}
	return false
}

// convertModelToMap converts a ModelInfo into a response map for the handler type.
func convertModelToMap(model *sdkcliproxy.ModelInfo, handlerType string) map[string]any {
	if model == nil {
		return nil
	}

	switch handlerType {
	case "openai":
		result := map[string]any{
			"id":       model.ID,
			"object":   "model",
			"owned_by": model.OwnedBy,
		}
		if model.Created > 0 {
			result["created"] = model.Created
		}
		if model.Type != "" {
			result["type"] = model.Type
		}
		if model.DisplayName != "" {
			result["display_name"] = model.DisplayName
		}
		if model.Version != "" {
			result["version"] = model.Version
		}
		if model.Description != "" {
			result["description"] = model.Description
		}
		if model.ContextLength > 0 {
			result["context_length"] = model.ContextLength
		}
		if model.MaxCompletionTokens > 0 {
			result["max_completion_tokens"] = model.MaxCompletionTokens
		}
		if len(model.SupportedParameters) > 0 {
			result["supported_parameters"] = model.SupportedParameters
		}
		return result

	case "claude":
		result := map[string]any{
			"id":       model.ID,
			"object":   "model",
			"owned_by": model.OwnedBy,
		}
		if model.Created > 0 {
			result["created"] = model.Created
		}
		if model.Type != "" {
			result["type"] = model.Type
		}
		if model.DisplayName != "" {
			result["display_name"] = model.DisplayName
		}
		return result

	case "gemini":
		result := map[string]any{}
		if model.Name != "" {
			result["name"] = model.Name
		} else {
			result["name"] = model.ID
		}
		if model.Version != "" {
			result["version"] = model.Version
		}
		if model.DisplayName != "" {
			result["displayName"] = model.DisplayName
		}
		if model.Description != "" {
			result["description"] = model.Description
		}
		if model.InputTokenLimit > 0 {
			result["inputTokenLimit"] = model.InputTokenLimit
		}
		if model.OutputTokenLimit > 0 {
			result["outputTokenLimit"] = model.OutputTokenLimit
		}
		if len(model.SupportedGenerationMethods) > 0 {
			result["supportedGenerationMethods"] = model.SupportedGenerationMethods
		}
		return result

	default:
		result := map[string]any{
			"id":     model.ID,
			"object": "model",
		}
		if model.OwnedBy != "" {
			result["owned_by"] = model.OwnedBy
		}
		if model.Type != "" {
			result["type"] = model.Type
		}
		if model.Created != 0 {
			result["created"] = model.Created
		}
		return result
	}
}

// authenticateModelsRequest validates the API key for /v1/models and /v1beta/models
// requests. Since this middleware runs before route-group auth, it must enforce
// authentication independently. Returns true if authenticated, false if rejected.
func authenticateModelsRequest(c *gin.Context, db *gorm.DB) bool {
	if c == nil || c.Request == nil || db == nil {
		return false
	}

	token := extractModelsToken(c.Request)
	if token == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": map[string]any{
				"message": "API key is required",
				"type":    "authentication_error",
			},
		})
		return false
	}

	var apiKey models.APIKey
	err := db.WithContext(c.Request.Context()).
		Preload("User").
		Where("api_key = ? AND active = ? AND revoked_at IS NULL", token, true).
		First(&apiKey).Error
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": map[string]any{
				"message": "Invalid API key",
				"type":    "authentication_error",
			},
		})
		return false
	}

	if apiKey.User != nil && apiKey.User.Disabled {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": map[string]any{
				"message": "Account disabled",
				"type":    "authentication_error",
			},
		})
		return false
	}

	// Set accessMetadata so downstream loadUserGroupMembership works correctly.
	meta := map[string]string{
		"api_key_id":   strconv.FormatUint(apiKey.ID, 10),
		"api_key_name": apiKey.Name,
		"is_admin":     strconv.FormatBool(apiKey.IsAdmin),
	}
	if apiKey.UserID != nil {
		meta["user_id"] = strconv.FormatUint(*apiKey.UserID, 10)
	}
	c.Set("accessMetadata", meta)

	return true
}

// extractModelsToken extracts an API key from request headers or query parameters.
func extractModelsToken(r *http.Request) string {
	if r == nil {
		return ""
	}
	// Bearer token from Authorization header.
	if val := strings.TrimSpace(r.Header.Get("Authorization")); val != "" {
		if strings.HasPrefix(val, "Bearer ") {
			if t := strings.TrimSpace(strings.TrimPrefix(val, "Bearer ")); t != "" {
				return t
			}
		}
	}
	// X-API-Key header.
	if v := strings.TrimSpace(r.Header.Get("X-API-Key")); v != "" {
		return v
	}
	// X-Goog-Api-Key header (Gemini clients).
	if v := strings.TrimSpace(r.Header.Get("X-Goog-Api-Key")); v != "" {
		return v
	}
	// Query parameter for /v1beta (Gemini convention).
	if r.URL != nil && strings.HasPrefix(r.URL.Path, "/v1beta") {
		if v := strings.TrimSpace(r.URL.Query().Get("key")); v != "" {
			return v
		}
	}
	return ""
}

// listMappedModelInfos returns model infos derived from DB mappings.
func listMappedModelInfos(ctx context.Context, db *gorm.DB, store *modelregistry.Store) ([]*sdkcliproxy.ModelInfo, error) {
	if db == nil {
		return nil, gorm.ErrInvalidDB
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var rows []models.ModelMapping
	if errFind := db.WithContext(ctx).
		Model(&models.ModelMapping{}).
		Select("provider", "model_name", "new_model_name", "is_enabled", "fork").
		Where("is_enabled = ?", true).
		Order("provider ASC, new_model_name ASC, model_name ASC").
		Find(&rows).Error; errFind != nil {
		return nil, errFind
	}

	now := time.Now().Unix()
	seen := make(map[string]struct{})
	out := make([]*sdkcliproxy.ModelInfo, 0, len(rows))

	for _, row := range rows {
		newName := strings.TrimSpace(row.NewModelName)
		if newName == "" {
			continue
		}
		key := strings.ToLower(newName)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}

		provider := strings.ToLower(strings.TrimSpace(row.Provider))
		modelName := strings.TrimSpace(row.ModelName)

		info := (*sdkcliproxy.ModelInfo)(nil)
		if store != nil && provider != "" && modelName != "" {
			info = store.GetByProviderModelID(provider, modelName)
		}
		if info == nil {
			info = &sdkcliproxy.ModelInfo{
				ID:          newName,
				Created:     now,
				OwnedBy:     provider,
				Type:        provider,
				DisplayName: newName,
				Name:        newName,
			}
		} else {
			info.ID = newName
			info.Name = newName
			if strings.TrimSpace(info.OwnedBy) == "" {
				info.OwnedBy = provider
			}
			if strings.TrimSpace(info.Type) == "" {
				info.Type = provider
			}
			if strings.TrimSpace(info.DisplayName) == "" {
				info.DisplayName = newName
			}
			if info.Created == 0 {
				info.Created = now
			}
		}

		out = append(out, info)
	}

	sort.Slice(out, func(i, j int) bool {
		ai := strings.ToLower(strings.TrimSpace(out[i].ID))
		aj := strings.ToLower(strings.TrimSpace(out[j].ID))
		if ai == aj {
			return out[i].ID < out[j].ID
		}
		return ai < aj
	})
	return out, nil
}
