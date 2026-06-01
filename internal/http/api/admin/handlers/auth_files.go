package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	dbutil "github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	quotapkg "github.com/router-for-me/CLIProxyAPIBusiness/internal/quota"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AuthFileHandler manages auth file endpoints.
type AuthFileHandler struct {
	db      *gorm.DB
	manager *cliproxyauth.Manager
}

// NewAuthFileHandler constructs an AuthFileHandler.
func NewAuthFileHandler(db *gorm.DB, managers ...*cliproxyauth.Manager) *AuthFileHandler {
	var manager *cliproxyauth.Manager
	if len(managers) > 0 {
		manager = managers[0]
	}
	return &AuthFileHandler{db: db, manager: manager}
}

// createAuthFileRequest defines the request body for auth file creation.
type createAuthFileRequest struct {
	Key         string              `json:"key"`
	AuthGroupID models.AuthGroupIDs `json:"auth_group_id"`
	ProxyURL    *string             `json:"proxy_url"`
	Content     map[string]any      `json:"content"`
	IsAvailable *bool               `json:"is_available"`
	RateLimit   int                 `json:"rate_limit"`
	Priority    int                 `json:"priority"`
}

type importAuthFilesFailure struct {
	File  string `json:"file"`
	Error string `json:"error"`
}

type importAuthFilesResponse struct {
	Imported int                      `json:"imported"`
	Failed   []importAuthFilesFailure `json:"failed"`
}

type authImportEntry struct {
	File    string
	Payload map[string]any
}

type idListRequest struct {
	IDs []uint64 `json:"ids"`
}

const (
	authHealthStateHealthy            = "healthy"
	authHealthStateExpired            = "expired"
	authHealthStateInvalidContent     = "invalid_content"
	authHealthStateMissingCredentials = "missing_credentials"
	authHealthStateNeedsRelogin       = "needs_relogin"
	authHealthStatePollFailed         = "poll_failed"
	authHealthStateRefreshFailed      = "refresh_failed"
	authHealthStateUnknown            = "unknown"
	authHealthStateUnsupported        = "unsupported"
)

type authHealthComputation struct {
	Health   gin.H
	Status   *quotapkg.AuthStatus
	Provider string
}

// Create creates a new auth file entry.
func (h *AuthFileHandler) Create(c *gin.Context) {
	var body createAuthFileRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	key := strings.TrimSpace(body.Key)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing key"})
		return
	}

	isAvailable := true
	if body.IsAvailable != nil {
		isAvailable = *body.IsAvailable
	}

	proxyURL := ""
	if body.ProxyURL != nil {
		proxyURL = strings.TrimSpace(*body.ProxyURL)
		if proxyURL != "" {
			normalizedProxyURL, errNormalizeProxy := normalizeProxyURL(proxyURL)
			if errNormalizeProxy != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proxy_url"})
				return
			}
			proxyURL = normalizedProxyURL
		}
	}
	if proxyURL == "" && autoAssignProxyEnabled() {
		assignedProxyURL, errAssignProxy := pickRandomProxyURL(c.Request.Context(), h.db)
		if errAssignProxy != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "auto assign proxy failed"})
			return
		}
		if assignedProxyURL != "" {
			proxyURL = assignedProxyURL
		}
	}

	contentJSON := datatypes.JSON("{}")
	if body.Content != nil {
		ensureAuthPayloadType(body.Content)
		if errValidate := validateKiroAuthPayload(body.Content); errValidate != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": errValidate.Error()})
			return
		}
		contentBytes, errMarshal := json.Marshal(body.Content)
		if errMarshal == nil {
			contentJSON = datatypes.JSON(contentBytes)
		}
	}

	now := time.Now().UTC()
	authGroupIDs := body.AuthGroupID.Clean()
	if body.AuthGroupID == nil {
		var defaultGroup models.AuthGroup
		if errFind := h.db.WithContext(c.Request.Context()).
			Where("is_default = ?", true).
			First(&defaultGroup).Error; errFind == nil {
			defaultGroupID := defaultGroup.ID
			authGroupIDs = models.AuthGroupIDs{&defaultGroupID}
		} else if !errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "query default auth group failed"})
			return
		}
	}
	auth := models.Auth{
		Key:         key,
		AuthGroupID: authGroupIDs,
		ProxyURL:    proxyURL,
		Content:     contentJSON,
		IsAvailable: isAvailable,
		RateLimit:   body.RateLimit,
		Priority:    body.Priority,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if errCreate := h.db.WithContext(c.Request.Context()).Create(&auth).Error; errCreate != nil {
		if strings.Contains(errCreate.Error(), "duplicate") || strings.Contains(errCreate.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "key already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create auth file failed"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":            auth.ID,
		"key":           auth.Key,
		"auth_group_id": auth.AuthGroupID.Clean(),
		"proxy_url":     auth.ProxyURL,
		"content":       authContentForResponse(auth.Content),
		"is_available":  auth.IsAvailable,
		"rate_limit":    auth.RateLimit,
		"priority":      auth.Priority,
		"created_at":    auth.CreatedAt,
		"updated_at":    auth.UpdatedAt,
	})
}

// Import uploads multiple auth json files and persists them into the auth table.
func (h *AuthFileHandler) Import(c *gin.Context) {
	form, errForm := c.MultipartForm()
	if errForm != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid multipart form"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no files provided"})
		return
	}

	var authGroupIDs models.AuthGroupIDs
	groupValue := strings.TrimSpace(c.PostForm("auth_group_id"))
	groupProvided := groupValue != ""
	if groupProvided {
		parsedIDs, errParse := parseAuthGroupIDsInput(groupValue)
		if errParse != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid auth group id"})
			return
		}
		authGroupIDs = parsedIDs.Clean()
	}

	if !groupProvided {
		var defaultGroup models.AuthGroup
		if errFind := h.db.WithContext(c.Request.Context()).
			Where("is_default = ?", true).
			First(&defaultGroup).Error; errFind == nil {
			defaultGroupID := defaultGroup.ID
			authGroupIDs = models.AuthGroupIDs{&defaultGroupID}
		} else if !errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "query default auth group failed"})
			return
		}
	}

	imported := 0
	failures := make([]importAuthFilesFailure, 0)

	for _, file := range files {
		if file == nil {
			continue
		}
		if !strings.EqualFold(filepath.Ext(file.Filename), ".json") {
			failures = append(failures, importAuthFilesFailure{
				File:  file.Filename,
				Error: "file must be json",
			})
			continue
		}
		reader, errOpen := file.Open()
		if errOpen != nil {
			failures = append(failures, importAuthFilesFailure{
				File:  file.Filename,
				Error: "open file failed",
			})
			continue
		}
		data, errRead := io.ReadAll(reader)
		_ = reader.Close()
		if errRead != nil {
			failures = append(failures, importAuthFilesFailure{
				File:  file.Filename,
				Error: "read file failed",
			})
			continue
		}
		if len(data) == 0 {
			failures = append(failures, importAuthFilesFailure{
				File:  file.Filename,
				Error: "empty json file",
			})
			continue
		}

		entries, errParseEntries := parseAuthImportEntries(file.Filename, data)
		if errParseEntries != nil {
			failures = append(failures, importAuthFilesFailure{
				File:  file.Filename,
				Error: errParseEntries.Error(),
			})
			continue
		}
		for _, entry := range entries {
			errImport := h.importAuthPayload(c.Request.Context(), entry.File, entry.Payload, authGroupIDs, groupProvided)
			if errImport != nil {
				failures = append(failures, importAuthFilesFailure{
					File:  entry.File,
					Error: errImport.Error(),
				})
				continue
			}
			imported++
		}
	}

	c.JSON(http.StatusOK, importAuthFilesResponse{
		Imported: imported,
		Failed:   failures,
	})
}

// Export downloads every auth file as one nested JSON bundle.
func (h *AuthFileHandler) Export(c *gin.Context) {
	h.export(c, nil)
}

// ExportSelected downloads selected auth files as one nested JSON bundle.
func (h *AuthFileHandler) ExportSelected(c *gin.Context) {
	ids, ok := bindRequestIDList(c)
	if !ok {
		return
	}
	h.export(c, ids)
}

func (h *AuthFileHandler) export(c *gin.Context, ids []uint64) {
	var rows []models.Auth
	q := h.db.WithContext(c.Request.Context()).Order("key ASC")
	if len(ids) > 0 {
		q = q.Where("id IN ?", ids)
	}
	if errFind := q.Find(&rows).Error; errFind != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "export auth files failed"})
		return
	}

	authFiles := make(map[string]map[string]any, len(rows))
	for _, row := range rows {
		payload := buildAuthExportPayload(row)
		fileName := exportAuthFileName(row.Key)
		if _, exists := authFiles[fileName]; exists {
			fileName = fmt.Sprintf("%d-%s", row.ID, fileName)
		}
		authFiles[fileName] = payload
	}

	data, errMarshal := json.MarshalIndent(gin.H{"authFiles": authFiles}, "", "  ")
	if errMarshal != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal auth export failed"})
		return
	}

	fileName := fmt.Sprintf("auth-files-%s.json", time.Now().UTC().Format("20060102T150405Z"))
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}

func (h *AuthFileHandler) importAuthPayload(ctx context.Context, fileName string, payload map[string]any, requestAuthGroupIDs models.AuthGroupIDs, groupProvided bool) error {
	if payload == nil {
		return errors.New("json object is required")
	}

	key := strings.TrimSpace(stringValue(payload["id"]))
	if key == "" {
		key = strings.TrimSpace(stringValue(payload["key"]))
	}
	if key == "" {
		key = strings.TrimSpace(fileName)
	}
	if key == "" {
		return errors.New("missing key")
	}

	ensureAuthPayloadType(payload)
	if errValidate := validateKiroAuthPayload(payload); errValidate != nil {
		return errValidate
	}

	proxyURL := strings.TrimSpace(stringValue(payload["proxy_url"]))
	if proxyURL == "" {
		proxyURL = strings.TrimSpace(stringValue(payload["proxyUrl"]))
	}
	if proxyURL != "" {
		normalizedProxyURL, errNormalizeProxy := normalizeProxyURL(proxyURL)
		if errNormalizeProxy != nil {
			return errors.New("invalid proxy_url")
		}
		proxyURL = normalizedProxyURL
	}
	if proxyURL == "" && autoAssignProxyEnabled() {
		assignedProxyURL, errAssignProxy := pickRandomProxyURL(ctx, h.db)
		if errAssignProxy != nil {
			return errors.New("auto assign proxy failed")
		}
		if assignedProxyURL != "" {
			proxyURL = assignedProxyURL
		}
	}

	authGroupIDs := requestAuthGroupIDs
	if !groupProvided {
		if payloadGroupIDs, okGroups := authGroupIDsFromPayload(payload); okGroups {
			authGroupIDs = payloadGroupIDs.Clean()
		}
	}

	isAvailable, hasIsAvailable := boolField(payload, "isActive", "is_active")
	if !hasIsAvailable {
		isAvailable = true
	}
	rateLimit, hasRateLimit := intField(payload, "rateLimit", "rate_limit")
	priority, hasPriority := intField(payload, "priority")

	contentBytes, errMarshal := json.Marshal(payload)
	if errMarshal != nil {
		return errors.New("marshal json failed")
	}

	now := time.Now().UTC()
	auth := models.Auth{
		Key:         key,
		AuthGroupID: authGroupIDs,
		ProxyURL:    proxyURL,
		Content:     datatypes.JSON(contentBytes),
		IsAvailable: isAvailable,
		RateLimit:   rateLimit,
		Priority:    priority,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	updates := map[string]any{
		"auth_group_id": auth.AuthGroupID,
		"proxy_url":     auth.ProxyURL,
		"content":       auth.Content,
		"updated_at":    now,
	}
	if hasIsAvailable {
		updates["is_available"] = auth.IsAvailable
	}
	if hasRateLimit {
		updates["rate_limit"] = auth.RateLimit
	}
	if hasPriority {
		updates["priority"] = auth.Priority
	}

	errCreate := h.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.Assignments(updates),
	}).Create(&auth).Error
	if errCreate != nil {
		return errors.New("import auth file failed")
	}
	return nil
}

// List returns auth files with optional filters.
func (h *AuthFileHandler) List(c *gin.Context) {
	var (
		keyQ         = strings.TrimSpace(c.Query("key"))
		authGroupIDQ = strings.TrimSpace(c.Query("auth_group_id"))
		typeQ        = strings.TrimSpace(c.Query("type"))
	)

	q := h.db.WithContext(c.Request.Context()).Model(&models.Auth{})
	if keyQ != "" {
		pattern := dbutil.NormalizeLikePattern(h.db, "%"+keyQ+"%")
		q = q.Where(dbutil.CaseInsensitiveLikeExpr(h.db, "key"), pattern)
	}
	if authGroupIDQ != "" {
		if id, errParse := strconv.ParseUint(authGroupIDQ, 10, 64); errParse == nil {
			q = q.Where(dbutil.JSONArrayContainsExpr(h.db, "auth_group_id"), dbutil.JSONArrayContainsValue(h.db, id))
		}
	}
	if typeQ != "" {
		typeExpr := dbutil.JSONExtractTextExpr(h.db, "content", "type")
		q = q.Where(typeExpr+" = ?", typeQ)
	}

	var rows []models.Auth
	if errFind := q.Order("created_at DESC").Find(&rows).Error; errFind != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list auth files failed"})
		return
	}

	groupMap, errGroups := loadAuthGroupMap(c.Request.Context(), h.db, rows)
	if errGroups != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load auth groups failed"})
		return
	}
	statusMap, errStatuses := loadLatestAuthStatusMap(c.Request.Context(), h.db, rows)
	if errStatuses != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load auth health failed"})
		return
	}

	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		authGroupIDs := row.AuthGroupID.Clean()
		item := gin.H{
			"id":            row.ID,
			"key":           row.Key,
			"auth_group_id": authGroupIDs,
			"proxy_url":     row.ProxyURL,
			"content":       authContentForResponse(row.Content),
			"is_available":  row.IsAvailable,
			"rate_limit":    row.RateLimit,
			"priority":      row.Priority,
			"created_at":    row.CreatedAt,
			"updated_at":    row.UpdatedAt,
		}
		item["auth_group"] = buildAuthGroupSummaries(authGroupIDs, groupMap)
		item["auth_health"] = h.deriveAuthHealth(row, statusMap[row.ID], time.Time{}, "stored").Health
		out = append(out, item)
	}
	c.JSON(http.StatusOK, gin.H{"auth_files": out})
}

// Get returns a single auth file by ID.
func (h *AuthFileHandler) Get(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var auth models.Auth
	if errFind := h.db.WithContext(c.Request.Context()).First(&auth, id).Error; errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}

	authGroupIDs := auth.AuthGroupID.Clean()
	groupMap, errGroups := loadAuthGroupMap(c.Request.Context(), h.db, []models.Auth{auth})
	if errGroups != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load auth groups failed"})
		return
	}
	status, errStatus := loadLatestAuthStatus(c.Request.Context(), h.db, auth.ID)
	if errStatus != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load auth health failed"})
		return
	}
	item := gin.H{
		"id":            auth.ID,
		"key":           auth.Key,
		"auth_group_id": authGroupIDs,
		"proxy_url":     auth.ProxyURL,
		"content":       authContentForResponse(auth.Content),
		"is_available":  auth.IsAvailable,
		"rate_limit":    auth.RateLimit,
		"priority":      auth.Priority,
		"created_at":    auth.CreatedAt,
		"updated_at":    auth.UpdatedAt,
	}
	item["auth_group"] = buildAuthGroupSummaries(authGroupIDs, groupMap)
	item["auth_health"] = h.deriveAuthHealth(auth, status, time.Time{}, "stored").Health
	c.JSON(http.StatusOK, item)
}

// updateAuthFileRequest defines the request body for auth file updates.
type updateAuthFileRequest struct {
	Key         *string              `json:"key"`
	AuthGroupID *models.AuthGroupIDs `json:"auth_group_id"`
	ProxyURL    *string              `json:"proxy_url"`
	Content     map[string]any       `json:"content"`
	IsAvailable *bool                `json:"is_available"`
	RateLimit   *int                 `json:"rate_limit"`
	Priority    *int                 `json:"priority"`
}

// Update modifies an auth file entry.
func (h *AuthFileHandler) Update(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var body updateAuthFileRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	now := time.Now().UTC()
	updates := map[string]any{"updated_at": now}

	if body.Key != nil {
		updates["key"] = strings.TrimSpace(*body.Key)
	}
	if body.AuthGroupID != nil {
		updates["auth_group_id"] = body.AuthGroupID.Clean()
	}
	if body.ProxyURL != nil {
		proxyURL := strings.TrimSpace(*body.ProxyURL)
		if proxyURL != "" {
			normalizedProxyURL, errNormalizeProxy := normalizeProxyURL(proxyURL)
			if errNormalizeProxy != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proxy_url"})
				return
			}
			proxyURL = normalizedProxyURL
		}
		updates["proxy_url"] = proxyURL
	}
	if body.Content != nil {
		ensureAuthPayloadType(body.Content)
		if errValidate := validateKiroAuthPayload(body.Content); errValidate != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": errValidate.Error()})
			return
		}
		contentBytes, errMarshal := json.Marshal(body.Content)
		if errMarshal == nil {
			updates["content"] = datatypes.JSON(contentBytes)
		}
	}
	if body.IsAvailable != nil {
		updates["is_available"] = *body.IsAvailable
	}
	if body.RateLimit != nil {
		updates["rate_limit"] = *body.RateLimit
	}
	if body.Priority != nil {
		updates["priority"] = *body.Priority
	}

	res := h.db.WithContext(c.Request.Context()).Model(&models.Auth{}).Where("id = ?", id).Updates(updates)
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

// Delete removes an auth file entry.
func (h *AuthFileHandler) Delete(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	res := h.db.WithContext(c.Request.Context()).Delete(&models.Auth{}, id)
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

// BatchDelete removes selected auth file entries.
func (h *AuthFileHandler) BatchDelete(c *gin.Context) {
	ids, ok := bindRequestIDList(c)
	if !ok {
		return
	}

	var (
		deleted    int64
		missingIDs []uint64
	)
	errDelete := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		existingIDs, errExisting := loadExistingIDs(tx, &models.Auth{}, ids)
		if errExisting != nil {
			return errExisting
		}
		missingIDs = missingUint64IDs(ids, existingIDs)
		if len(existingIDs) == 0 {
			return nil
		}
		res := tx.Delete(&models.Auth{}, "id IN ?", existingIDs)
		if res.Error != nil {
			return res.Error
		}
		deleted = res.RowsAffected
		return nil
	})
	if errDelete != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "batch delete auth files failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted":     deleted,
		"missing_ids": missingIDs,
	})
}

// LivenessCheck derives current auth health without refreshing or mutating tokens.
func (h *AuthFileHandler) LivenessCheck(c *gin.Context) {
	auth, ok := h.loadAuthRowParam(c)
	if !ok {
		return
	}

	now := time.Now().UTC()
	computed := h.deriveAuthHealth(auth, nil, now, "liveness_check")
	if errSave := h.saveAuthHealthStatus(c.Request.Context(), auth, computed.Status); errSave != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save auth health failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"auth_health": computed.Health,
	})
}

// Refresh explicitly refreshes provider tokens for a supported auth file.
func (h *AuthFileHandler) Refresh(c *gin.Context) {
	authRow, ok := h.loadAuthRowParam(c)
	if !ok {
		return
	}

	metadata, errMetadata := authMetadataFromContent(authRow.Content)
	if errMetadata != nil {
		computed := h.authHealthWithState(authRow, authHealthStateInvalidContent, "Invalid auth content", time.Now().UTC(), "refresh")
		_ = h.saveAuthHealthStatus(c.Request.Context(), authRow, computed.Status)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":       "invalid auth content",
			"auth_health": computed.Health,
		})
		return
	}

	provider := authProviderFromPayload(metadata)
	if provider == "" {
		computed := h.authHealthWithState(authRow, authHealthStateUnsupported, "Refresh unsupported for auth without provider", time.Now().UTC(), "refresh")
		_ = h.saveAuthHealthStatus(c.Request.Context(), authRow, computed.Status)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":       "unsupported auth provider",
			"auth_health": computed.Health,
		})
		return
	}
	if !hasRefreshCredential(metadata) {
		computed := h.authHealthWithState(authRow, authHealthStateUnsupported, "Refresh token not present", time.Now().UTC(), "refresh")
		_ = h.saveAuthHealthStatus(c.Request.Context(), authRow, computed.Status)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":       "refresh token not present",
			"auth_health": computed.Health,
		})
		return
	}

	executor, okExecutor := h.authExecutor(provider)
	if !okExecutor {
		computed := h.authHealthWithState(authRow, authHealthStateUnsupported, "Refresh unsupported for provider", time.Now().UTC(), "refresh")
		_ = h.saveAuthHealthStatus(c.Request.Context(), authRow, computed.Status)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":       "refresh unsupported for provider",
			"auth_health": computed.Health,
		})
		return
	}

	runtimeAuth := authRowToRuntimeAuth(authRow, metadata, provider)
	refreshed, errRefresh := executor.Refresh(c.Request.Context(), runtimeAuth.Clone())
	if errRefresh != nil {
		computed := h.authHealthWithState(authRow, authHealthStateRefreshFailed, "Refresh failed", time.Now().UTC(), "refresh")
		if status := statusCodeFromError(errRefresh); status > 0 {
			computed.Status.HTTPStatus = status
			computed.Health["http_status"] = status
		}
		_ = h.saveAuthHealthStatus(c.Request.Context(), authRow, computed.Status)
		c.JSON(http.StatusBadGateway, gin.H{
			"error":       "refresh failed",
			"auth_health": computed.Health,
		})
		return
	}
	if refreshed == nil {
		refreshed = runtimeAuth
	}

	updatedContent, errContent := mergeRefreshedAuthContent(authRow.Content, metadata, refreshed, provider)
	if errContent != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal refreshed auth failed"})
		return
	}

	now := time.Now().UTC()
	if !jsonEqual(authRow.Content, updatedContent) {
		if errUpdate := h.db.WithContext(c.Request.Context()).
			Model(&models.Auth{}).
			Where("id = ?", authRow.ID).
			Updates(map[string]any{
				"content":    datatypes.JSON(updatedContent),
				"updated_at": now,
			}).Error; errUpdate != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "persist refreshed auth failed"})
			return
		}
		authRow.Content = datatypes.JSON(updatedContent)
		authRow.UpdatedAt = now
	}

	if authRow.IsAvailable && h.manager != nil {
		refreshed.ID = authRow.Key
		refreshed.Provider = provider
		refreshed.FileName = authRow.Key
		refreshed.ProxyURL = authRow.ProxyURL
		if _, errUpdate := h.manager.Update(cliproxyauth.WithSkipPersist(c.Request.Context()), refreshed); errUpdate != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "update runtime auth failed"})
			return
		}
	}

	computed := h.deriveAuthHealth(authRow, &quotapkg.AuthStatus{
		State:        authHealthStateHealthy,
		CheckedAt:    now,
		NeedsRelogin: false,
	}, now, "refresh")
	if errSave := h.saveAuthHealthStatus(c.Request.Context(), authRow, computed.Status); errSave != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save auth health failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"auth_health": computed.Health,
		"refreshed":   true,
	})
}

// SetAvailable marks an auth file as available.
func (h *AuthFileHandler) SetAvailable(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	now := time.Now().UTC()
	res := h.db.WithContext(c.Request.Context()).Model(&models.Auth{}).Where("id = ?", id).
		Updates(map[string]any{"is_available": true, "updated_at": now})
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

// SetUnavailable marks an auth file as unavailable.
func (h *AuthFileHandler) SetUnavailable(c *gin.Context) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	now := time.Now().UTC()
	res := h.db.WithContext(c.Request.Context()).Model(&models.Auth{}).Where("id = ?", id).
		Updates(map[string]any{"is_available": false, "updated_at": now})
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

// ListTypes returns distinct auth file types.
func (h *AuthFileHandler) ListTypes(c *gin.Context) {
	var types []string
	typeExpr := dbutil.JSONExtractTextExpr(h.db, "content", "type")
	if errQuery := h.db.WithContext(c.Request.Context()).
		Model(&models.Auth{}).
		Select(fmt.Sprintf("DISTINCT %s AS content_type", typeExpr)).
		Where(fmt.Sprintf("%s IS NOT NULL AND %s != ''", typeExpr, typeExpr)).
		Order("content_type").
		Pluck("content_type", &types).Error; errQuery != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list types failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"types": types})
}

func parseAuthGroupIDsInput(value string) (models.AuthGroupIDs, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var list []uint64
		if errUnmarshal := json.Unmarshal([]byte(trimmed), &list); errUnmarshal != nil {
			return nil, errUnmarshal
		}
		return authGroupIDsFromValues(list), nil
	}
	parsed, errParse := strconv.ParseUint(trimmed, 10, 64)
	if errParse != nil {
		return nil, errParse
	}
	return authGroupIDsFromValues([]uint64{parsed}), nil
}

func parseAuthImportEntries(fileName string, data []byte) ([]authImportEntry, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var root any
	if errDecode := decoder.Decode(&root); errDecode != nil {
		return nil, errors.New("invalid json")
	}

	switch value := root.(type) {
	case map[string]any:
		if isAuthPayloadObject(value) {
			return []authImportEntry{{File: fileName, Payload: value}}, nil
		}
		for _, bundleKey := range []string{"authFiles", "auth_files", "files"} {
			if bundleValue, ok := value[bundleKey]; ok {
				return importEntriesFromBundleValue(fileName, bundleValue)
			}
		}
		if entries, ok := importEntriesFromObjectMap(value); ok {
			return entries, nil
		}
		return []authImportEntry{{File: fileName, Payload: value}}, nil
	case []any:
		return importEntriesFromArray(fileName, value)
	default:
		return nil, errors.New("json must be an object")
	}
}

func importEntriesFromBundleValue(fileName string, value any) ([]authImportEntry, error) {
	switch typed := value.(type) {
	case map[string]any:
		if entries, ok := importEntriesFromObjectMap(typed); ok {
			return entries, nil
		}
		return nil, errors.New("nested auth files must be json objects")
	case []any:
		return importEntriesFromArray(fileName, typed)
	default:
		return nil, errors.New("nested auth files must be json objects")
	}
}

func importEntriesFromObjectMap(values map[string]any) ([]authImportEntry, bool) {
	if len(values) == 0 {
		return nil, false
	}
	entries := make([]authImportEntry, 0, len(values))
	for name, rawPayload := range values {
		payload, okPayload := rawPayload.(map[string]any)
		if !okPayload {
			return nil, false
		}
		entries = append(entries, authImportEntry{
			File:    strings.TrimSpace(name),
			Payload: payload,
		})
	}
	if len(entries) == 0 {
		return nil, false
	}
	return entries, true
}

func importEntriesFromArray(fileName string, values []any) ([]authImportEntry, error) {
	entries := make([]authImportEntry, 0, len(values))
	for idx, rawPayload := range values {
		payload, okPayload := rawPayload.(map[string]any)
		if !okPayload {
			return nil, errors.New("nested auth files must be json objects")
		}
		entryName := strings.TrimSpace(stringValue(payload["id"]))
		if entryName == "" {
			entryName = strings.TrimSpace(stringValue(payload["key"]))
		}
		if entryName == "" {
			entryName = fmt.Sprintf("%s[%d]", fileName, idx)
		}
		entries = append(entries, authImportEntry{
			File:    entryName,
			Payload: payload,
		})
	}
	if len(entries) == 0 {
		return nil, errors.New("no auth files found")
	}
	return entries, nil
}

func isAuthPayloadObject(payload map[string]any) bool {
	if len(payload) == 0 {
		return false
	}
	for _, key := range []string{
		"accessToken",
		"refreshToken",
		"provider",
		"authType",
		"email",
		"type",
		"key",
		"id",
	} {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	return false
}

func ensureAuthPayloadType(payload map[string]any) {
	if payload == nil {
		return
	}
	if strings.TrimSpace(stringValue(payload["type"])) != "" {
		return
	}
	if provider := strings.TrimSpace(stringValue(payload["provider"])); provider != "" {
		payload["type"] = provider
		return
	}
	if metadataValue, okMetadata := payload["metadata"].(map[string]any); okMetadata {
		if typeValue := strings.TrimSpace(stringValue(metadataValue["type"])); typeValue != "" {
			payload["type"] = typeValue
		}
	}
}

func validateKiroAuthPayload(payload map[string]any) error {
	if payload == nil {
		return nil
	}
	provider := strings.ToLower(strings.TrimSpace(stringValue(payload["provider"])))
	if provider == "" {
		provider = strings.ToLower(strings.TrimSpace(stringValue(payload["type"])))
	}
	if provider != cliproxyauth.KiroProvider {
		return nil
	}
	required := []struct {
		key   string
		label string
	}{
		{"label", "label"},
		{"refresh_token", "refresh_token"},
		{"region", "region"},
	}
	for _, field := range required {
		if strings.TrimSpace(stringValue(payload[field.key])) == "" {
			return fmt.Errorf("kiro auth: %s is required", field.label)
		}
	}
	return nil
}

func buildAuthExportPayload(row models.Auth) map[string]any {
	payload := make(map[string]any)
	if len(row.Content) > 0 {
		_ = json.Unmarshal(row.Content, &payload)
	}
	if payload == nil {
		payload = make(map[string]any)
	}

	provider := strings.TrimSpace(stringValue(payload["provider"]))
	if provider == "" {
		provider = strings.TrimSpace(stringValue(payload["type"]))
	}
	if provider != "" {
		payload["provider"] = provider
	}
	delete(payload, "type")
	return payload
}

func bindRequestIDList(c *gin.Context) ([]uint64, bool) {
	var body idListRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return nil, false
	}
	ids := cleanUint64IDs(body.IDs)
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids is required"})
		return nil, false
	}
	return ids, true
}

func cleanUint64IDs(ids []uint64) []uint64 {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uint64]struct{}, len(ids))
	out := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func loadExistingIDs(db *gorm.DB, model any, ids []uint64) ([]uint64, error) {
	existingIDs := make([]uint64, 0, len(ids))
	if len(ids) == 0 {
		return existingIDs, nil
	}
	if errFind := db.Model(model).Where("id IN ?", ids).Pluck("id", &existingIDs).Error; errFind != nil {
		return nil, errFind
	}
	return existingIDs, nil
}

func missingUint64IDs(requested []uint64, existing []uint64) []uint64 {
	existingSet := make(map[uint64]struct{}, len(existing))
	for _, id := range existing {
		existingSet[id] = struct{}{}
	}
	missing := make([]uint64, 0)
	for _, id := range requested {
		if _, ok := existingSet[id]; !ok {
			missing = append(missing, id)
		}
	}
	return missing
}

func (h *AuthFileHandler) loadAuthRowParam(c *gin.Context) (models.Auth, bool) {
	id, errParse := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return models.Auth{}, false
	}

	var auth models.Auth
	if errFind := h.db.WithContext(c.Request.Context()).First(&auth, id).Error; errFind != nil {
		if errors.Is(errFind, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return models.Auth{}, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return models.Auth{}, false
	}
	return auth, true
}

func loadLatestAuthStatusMap(ctx context.Context, db *gorm.DB, rows []models.Auth) (map[uint64]*quotapkg.AuthStatus, error) {
	out := make(map[uint64]*quotapkg.AuthStatus)
	if db == nil || len(rows) == 0 {
		return out, nil
	}
	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		if row.ID != 0 {
			ids = append(ids, row.ID)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}

	var quotas []models.Quota
	if errFind := db.WithContext(ctx).
		Where("auth_id IN ?", ids).
		Order("auth_id ASC, updated_at DESC, id DESC").
		Find(&quotas).Error; errFind != nil {
		return nil, errFind
	}
	for _, quota := range quotas {
		if _, exists := out[quota.AuthID]; exists {
			continue
		}
		_, status := quotapkg.UnwrapStoredQuotaData(quota.Data)
		if status != nil {
			out[quota.AuthID] = status
		}
	}
	return out, nil
}

func loadLatestAuthStatus(ctx context.Context, db *gorm.DB, authID uint64) (*quotapkg.AuthStatus, error) {
	if authID == 0 {
		return nil, nil
	}
	statuses, errStatuses := loadLatestAuthStatusMap(ctx, db, []models.Auth{{ID: authID}})
	if errStatuses != nil {
		return nil, errStatuses
	}
	return statuses[authID], nil
}

func (h *AuthFileHandler) deriveAuthHealth(row models.Auth, persisted *quotapkg.AuthStatus, checkedAt time.Time, source string) authHealthComputation {
	now := time.Now().UTC()
	payload, errPayload := authMetadataFromContent(row.Content)
	provider := authProviderFromPayload(payload)
	hasRefreshToken := hasRefreshCredential(payload)
	hasCredential := hasCredentialMaterial(payload)
	refreshSupported := false
	if hasRefreshToken {
		_, refreshSupported = h.authExecutor(provider)
	}
	runtimeLoaded := false
	if h != nil && h.manager != nil {
		_, runtimeLoaded = h.manager.GetByID(row.Key)
	}

	if source == "" {
		source = "derived"
	}
	if checkedAt.IsZero() && persisted != nil {
		checkedAt = persisted.CheckedAt
	}

	state := authHealthStateUnknown
	message := "Unknown"
	needsRelogin := false
	httpStatus := 0
	if persisted != nil && persisted.HTTPStatus > 0 {
		httpStatus = persisted.HTTPStatus
	}

	var expiresAt string
	var expiry time.Time
	var hasExpiry bool
	var lastRefresh string
	var hasLastRefresh bool
	if errPayload == nil {
		candidates := collectAuthMetadataCandidates(payload)
		expiresAt, expiry, hasExpiry = findFirstTimeCandidate(candidates,
			"expired",
			"expire",
			"expires_at",
			"expiresAt",
			"expiry",
			"expires",
		)
		lastRefresh, _, hasLastRefresh = findFirstTimeCandidate(candidates,
			"last_refresh",
			"lastRefresh",
			"last_refreshed_at",
			"lastRefreshedAt",
		)
	}

	switch {
	case errPayload != nil:
		state = authHealthStateInvalidContent
		message = "Invalid auth content"
		needsRelogin = true
	case provider == "":
		state = authHealthStateUnsupported
		message = "Provider not detected"
	case !hasCredential:
		state = authHealthStateMissingCredentials
		message = "Credential material missing"
		needsRelogin = true
	case hasExpiry && !expiry.IsZero() && !expiry.After(now):
		state = authHealthStateExpired
		message = "Token expired"
		needsRelogin = true
	case persisted != nil && (persisted.NeedsRelogin || strings.EqualFold(persisted.State, authHealthStateNeedsRelogin)):
		state = authHealthStateNeedsRelogin
		message = "Needs re-login"
		needsRelogin = true
	case persisted != nil && strings.EqualFold(persisted.State, authHealthStatePollFailed):
		state = authHealthStatePollFailed
		message = "Last health check failed"
	case persisted != nil && strings.EqualFold(persisted.State, authHealthStateRefreshFailed):
		state = authHealthStateRefreshFailed
		message = "Refresh failed"
	case hasCredential:
		state = authHealthStateHealthy
		message = "Healthy"
	}

	health := gin.H{
		"state":              state,
		"message":            message,
		"has_refresh_token":  hasRefreshToken,
		"refresh_supported":  refreshSupported,
		"liveness_supported": true,
		"runtime_loaded":     runtimeLoaded,
		"source":             source,
	}
	if provider != "" {
		health["provider"] = provider
	}
	if !checkedAt.IsZero() {
		health["checked_at"] = checkedAt.UTC()
	}
	if hasExpiry && expiresAt != "" {
		health["expires_at"] = expiresAt
	}
	if hasLastRefresh && lastRefresh != "" {
		health["last_refresh"] = lastRefresh
	}
	if httpStatus > 0 {
		health["http_status"] = httpStatus
	}
	if needsRelogin {
		health["needs_relogin"] = true
	}

	statusCheckedAt := checkedAt
	if statusCheckedAt.IsZero() {
		statusCheckedAt = now
	}
	status := &quotapkg.AuthStatus{
		State:        state,
		Message:      message,
		CheckedAt:    statusCheckedAt.UTC(),
		HTTPStatus:   httpStatus,
		NeedsRelogin: needsRelogin,
	}
	return authHealthComputation{Health: health, Status: status, Provider: provider}
}

func (h *AuthFileHandler) authHealthWithState(row models.Auth, state, message string, checkedAt time.Time, source string) authHealthComputation {
	computed := h.deriveAuthHealth(row, nil, checkedAt, source)
	computed.Health["state"] = state
	computed.Health["message"] = message
	computed.Status.State = state
	computed.Status.Message = message
	computed.Status.CheckedAt = checkedAt.UTC()
	computed.Status.NeedsRelogin = state == authHealthStateExpired ||
		state == authHealthStateInvalidContent ||
		state == authHealthStateMissingCredentials ||
		state == authHealthStateNeedsRelogin
	if computed.Status.NeedsRelogin {
		computed.Health["needs_relogin"] = true
	} else {
		delete(computed.Health, "needs_relogin")
	}
	return computed
}

func (h *AuthFileHandler) authExecutor(provider string) (cliproxyauth.ProviderExecutor, bool) {
	if h == nil || h.manager == nil {
		return nil, false
	}
	provider = normalizeAuthProvider(provider)
	if provider == "" {
		return nil, false
	}
	return h.manager.Executor(provider)
}

func (h *AuthFileHandler) saveAuthHealthStatus(ctx context.Context, row models.Auth, status *quotapkg.AuthStatus) error {
	if h == nil || h.db == nil || status == nil || row.ID == 0 {
		return nil
	}
	authType := authProviderFromContent(row.Content)
	if authType == "" {
		authType = "unknown"
	}
	now := time.Now().UTC()

	var existing models.Quota
	errFind := h.db.WithContext(ctx).
		Where("auth_id = ? AND type = ?", row.ID, authType).
		First(&existing).Error
	var payload []byte
	switch {
	case errFind == nil:
		unwrapped, _ := quotapkg.UnwrapStoredQuotaData(existing.Data)
		payload = unwrapped
	case errors.Is(errFind, gorm.ErrRecordNotFound):
		payload = nil
	default:
		return errFind
	}

	stored, errMarshal := quotapkg.MarshalStoredQuotaData(payload, status)
	if errMarshal != nil {
		return errMarshal
	}
	if errFind == nil {
		return h.db.WithContext(ctx).
			Model(&models.Quota{}).
			Where("id = ?", existing.ID).
			Updates(map[string]any{
				"data":       datatypes.JSON(stored),
				"updated_at": now,
			}).Error
	}
	return h.db.WithContext(ctx).Create(&models.Quota{
		AuthID:    row.ID,
		Type:      authType,
		Data:      datatypes.JSON(stored),
		CreatedAt: now,
		UpdatedAt: now,
	}).Error
}

func authMetadataFromContent(content datatypes.JSON) (map[string]any, error) {
	if len(content) == 0 {
		return nil, errors.New("empty auth content")
	}
	var payload map[string]any
	if errUnmarshal := json.Unmarshal(content, &payload); errUnmarshal != nil {
		return nil, errUnmarshal
	}
	if payload == nil {
		return nil, errors.New("empty auth content")
	}
	return payload, nil
}

func authProviderFromContent(content datatypes.JSON) string {
	payload, errPayload := authMetadataFromContent(content)
	if errPayload != nil {
		return ""
	}
	return authProviderFromPayload(payload)
}

func authProviderFromPayload(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	provider := strings.TrimSpace(stringValue(payload["provider"]))
	if provider == "" {
		provider = strings.TrimSpace(stringValue(payload["type"]))
	}
	return normalizeAuthProvider(provider)
}

func normalizeAuthProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	provider = strings.ReplaceAll(provider, "_", "-")
	return provider
}

func hasRefreshCredential(payload map[string]any) bool {
	if payload == nil {
		return false
	}
	return findFirstStringCandidate(collectAuthMetadataCandidates(payload), "refresh_token", "refreshToken") != ""
}

func hasCredentialMaterial(payload map[string]any) bool {
	if payload == nil {
		return false
	}
	candidates := collectAuthMetadataCandidates(payload)
	if findFirstStringCandidate(candidates,
		"access_token",
		"accessToken",
		"id_token",
		"idToken",
		"refresh_token",
		"refreshToken",
		"api_key",
		"apiKey",
		"token",
		"cookie",
		"session_id",
		"sessionId",
	) != "" {
		return true
	}
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}
		for _, key := range []string{"cookies", "credentials"} {
			if value, ok := candidate[key]; ok && value != nil {
				return true
			}
		}
	}
	return false
}

func authRowToRuntimeAuth(row models.Auth, metadata map[string]any, provider string) *cliproxyauth.Auth {
	attrs := map[string]string{}
	if email, ok := metadata["email"].(string); ok && strings.TrimSpace(email) != "" {
		attrs["email"] = strings.TrimSpace(email)
	}
	if row.Priority != 0 {
		attrs["priority"] = strconv.Itoa(row.Priority)
	}
	return &cliproxyauth.Auth{
		ID:         row.Key,
		Provider:   provider,
		FileName:   row.Key,
		ProxyURL:   row.ProxyURL,
		Label:      labelForAuthPayload(metadata),
		Status:     cliproxyauth.StatusActive,
		Attributes: attrs,
		Metadata:   cloneStringAnyMap(metadata),
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
	}
}

func mergeRefreshedAuthContent(existing datatypes.JSON, original map[string]any, refreshed *cliproxyauth.Auth, provider string) ([]byte, error) {
	merged := cloneStringAnyMap(original)
	if len(merged) == 0 {
		var err error
		merged, err = authMetadataFromContent(existing)
		if err != nil {
			merged = make(map[string]any)
		}
	}
	if refreshed != nil && refreshed.Metadata != nil {
		for key, value := range refreshed.Metadata {
			merged[key] = value
		}
	}
	if strings.TrimSpace(stringValue(merged["type"])) == "" && provider != "" {
		merged["type"] = provider
	}
	return json.Marshal(merged)
}

func cloneStringAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func labelForAuthPayload(metadata map[string]any) string {
	if metadata == nil {
		return ""
	}
	if value := strings.TrimSpace(stringValue(metadata["label"])); value != "" {
		return value
	}
	if value := strings.TrimSpace(stringValue(metadata["email"])); value != "" {
		return value
	}
	if value := strings.TrimSpace(stringValue(metadata["project_id"])); value != "" {
		return value
	}
	return ""
}

func jsonEqual(a, b []byte) bool {
	var objA, objB map[string]any
	if errA := json.Unmarshal(a, &objA); errA != nil {
		return false
	}
	if errB := json.Unmarshal(b, &objB); errB != nil {
		return false
	}
	if len(objA) != len(objB) {
		return false
	}
	for key, valueA := range objA {
		valueB, ok := objB[key]
		if !ok {
			return false
		}
		jsonA, _ := json.Marshal(valueA)
		jsonB, _ := json.Marshal(valueB)
		if string(jsonA) != string(jsonB) {
			return false
		}
	}
	return true
}

type statusCoder interface {
	StatusCode() int
}

func statusCodeFromError(err error) int {
	if err == nil {
		return 0
	}
	var coder statusCoder
	if errors.As(err, &coder) && coder != nil {
		return coder.StatusCode()
	}
	return 0
}

func authContentForResponse(content datatypes.JSON) any {
	if len(content) == 0 {
		return content
	}
	var payload map[string]any
	if err := json.Unmarshal(content, &payload); err != nil || payload == nil {
		return content
	}
	return redactKiroAuthPayload(payload)
}

func redactKiroAuthPayload(payload map[string]any) map[string]any {
	if payload == nil {
		return nil
	}
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		out[key] = value
	}

	provider := strings.ToLower(strings.TrimSpace(stringValue(out["provider"])))
	if provider == "" {
		provider = strings.ToLower(strings.TrimSpace(stringValue(out["type"])))
	}
	if metadata, ok := out["metadata"].(map[string]any); ok {
		metadataProvider := strings.ToLower(strings.TrimSpace(stringValue(metadata["provider"])))
		if metadataProvider == "" {
			metadataProvider = strings.ToLower(strings.TrimSpace(stringValue(metadata["type"])))
		}
		if metadataProvider == cliproxyauth.KiroProvider {
			out["metadata"] = cliproxyauth.RedactKiroMetadata(metadata)
		}
		if provider == "" {
			provider = metadataProvider
		}
	}
	if provider == cliproxyauth.KiroProvider {
		out = cliproxyauth.RedactKiroMetadata(out)
	}
	return out
}

func exportAuthFileName(key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return "auth.json"
	}
	trimmed = strings.TrimLeft(strings.ReplaceAll(trimmed, "\\", "/"), "/")
	if !strings.HasSuffix(strings.ToLower(trimmed), ".json") {
		trimmed += ".json"
	}
	return trimmed
}

func authGroupIDsFromPayload(payload map[string]any) (models.AuthGroupIDs, bool) {
	for _, key := range []string{"authGroupIds", "auth_group_id"} {
		rawValue, okValue := payload[key]
		if !okValue {
			continue
		}
		ids, okIDs := authGroupIDsFromAny(rawValue)
		return ids, okIDs
	}
	return nil, false
}

func authGroupIDsFromAny(value any) (models.AuthGroupIDs, bool) {
	switch typed := value.(type) {
	case []any:
		values := make([]uint64, 0, len(typed))
		for _, item := range typed {
			if parsed, okParsed := uint64Value(item); okParsed {
				values = append(values, parsed)
			}
		}
		return authGroupIDsFromValues(values), true
	case []uint64:
		return authGroupIDsFromValues(typed), true
	case json.Number:
		parsed, errParse := strconv.ParseUint(typed.String(), 10, 64)
		if errParse != nil {
			return models.AuthGroupIDs{}, false
		}
		return authGroupIDsFromValues([]uint64{parsed}), true
	case float64:
		if typed <= 0 {
			return models.AuthGroupIDs{}, true
		}
		return authGroupIDsFromValues([]uint64{uint64(typed)}), true
	case string:
		ids, errParse := parseAuthGroupIDsInput(typed)
		return ids, errParse == nil
	default:
		return models.AuthGroupIDs{}, false
	}
}

func authGroupIDsFromValues(values []uint64) models.AuthGroupIDs {
	if len(values) == 0 {
		return models.AuthGroupIDs{}
	}
	out := make(models.AuthGroupIDs, 0, len(values))
	for _, value := range values {
		if value == 0 {
			continue
		}
		idCopy := value
		out = append(out, &idCopy)
	}
	if len(out) == 0 {
		return models.AuthGroupIDs{}
	}
	return out
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func boolField(payload map[string]any, keys ...string) (bool, bool) {
	for _, key := range keys {
		rawValue, okValue := payload[key]
		if !okValue {
			continue
		}
		switch typed := rawValue.(type) {
		case bool:
			return typed, true
		case string:
			parsed, errParse := strconv.ParseBool(strings.TrimSpace(typed))
			if errParse == nil {
				return parsed, true
			}
		}
	}
	return false, false
}

func intField(payload map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		rawValue, okValue := payload[key]
		if !okValue {
			continue
		}
		if parsed, okParsed := intValue(rawValue); okParsed {
			return parsed, true
		}
	}
	return 0, false
}

func intValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case uint64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, errParse := strconv.ParseInt(typed.String(), 10, 64)
		if errParse == nil {
			return int(parsed), true
		}
	case string:
		parsed, errParse := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if errParse == nil {
			return int(parsed), true
		}
	}
	return 0, false
}

func uint64Value(value any) (uint64, bool) {
	switch typed := value.(type) {
	case uint64:
		return typed, true
	case int:
		if typed < 0 {
			return 0, false
		}
		return uint64(typed), true
	case int64:
		if typed < 0 {
			return 0, false
		}
		return uint64(typed), true
	case float64:
		if typed < 0 {
			return 0, false
		}
		return uint64(typed), true
	case json.Number:
		parsed, errParse := strconv.ParseUint(typed.String(), 10, 64)
		return parsed, errParse == nil
	case string:
		parsed, errParse := strconv.ParseUint(strings.TrimSpace(typed), 10, 64)
		return parsed, errParse == nil
	default:
		return 0, false
	}
}

func loadAuthGroupMap(ctx context.Context, db *gorm.DB, rows []models.Auth) (map[uint64]models.AuthGroup, error) {
	groupIDs := make([]uint64, 0)
	seen := make(map[uint64]struct{})
	for _, row := range rows {
		for _, id := range row.AuthGroupID.Values() {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			groupIDs = append(groupIDs, id)
		}
	}
	if len(groupIDs) == 0 {
		return map[uint64]models.AuthGroup{}, nil
	}
	var groups []models.AuthGroup
	if errFind := db.WithContext(ctx).Where("id IN ?", groupIDs).Find(&groups).Error; errFind != nil {
		return nil, errFind
	}
	groupMap := make(map[uint64]models.AuthGroup, len(groups))
	for _, group := range groups {
		groupMap[group.ID] = group
	}
	return groupMap, nil
}

func buildAuthGroupSummaries(ids models.AuthGroupIDs, groupMap map[uint64]models.AuthGroup) []gin.H {
	values := ids.Values()
	if len(values) == 0 {
		return []gin.H{}
	}
	out := make([]gin.H, 0, len(values))
	for _, id := range values {
		group, ok := groupMap[id]
		if !ok {
			continue
		}
		out = append(out, gin.H{
			"id":   group.ID,
			"name": group.Name,
		})
	}
	return out
}
