package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	quotapkg "github.com/router-for-me/CLIProxyAPIBusiness/internal/quota"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func openAuthFilesTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_auth_files_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Auth{}, &models.AuthGroup{}, &models.Quota{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func TestCreateKiroAuthFileValidatesRequiredFieldsAndStoresProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openAuthFilesTestDB(t)
	handler := NewAuthFileHandler(db)

	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "missing label",
			body: `{"key":"kiro-missing-label","content":{"type":"kiro","refresh_token":"refresh","region":"us-east-1"}}`,
			want: "label is required",
		},
		{
			name: "missing refresh token",
			body: `{"key":"kiro-missing-refresh","content":{"type":"kiro","label":"Kiro Account","region":"us-east-1"}}`,
			want: "refresh_token is required",
		},
		{
			name: "missing region",
			body: `{"key":"kiro-missing-region","content":{"type":"kiro","label":"Kiro Account","refresh_token":"refresh"}}`,
			want: "region is required",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v0/admin/auth-files", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = req

			handler.Create(ctx)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), tc.want) {
				t.Fatalf("response %s missing %q", recorder.Body.String(), tc.want)
			}
		})
	}

	req := httptest.NewRequest(http.MethodPost, "/v0/admin/auth-files", strings.NewReader(`{
		"key":"kiro-valid",
		"proxy_url":"socks5://127.0.0.1:1080",
		"content":{"provider":"kiro","label":"Kiro Account","refresh_token":"refresh-secret","region":"us-east-1"}
	}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Create(ctx)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	var response struct {
		ProxyURL string         `json:"proxy_url"`
		Content  map[string]any `json:"content"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if response.ProxyURL != "socks5://127.0.0.1:1080/" {
		t.Fatalf("proxy_url = %q", response.ProxyURL)
	}
	if response.Content["type"] != "kiro" {
		t.Fatalf("type = %v, want kiro", response.Content["type"])
	}
	if response.Content["refresh_token"] != "[redacted]" {
		t.Fatalf("refresh token was not redacted: %+v", response.Content)
	}
}

func TestCreateKiroAuthFileRejectsInvalidProxyURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openAuthFilesTestDB(t)
	handler := NewAuthFileHandler(db)

	req := httptest.NewRequest(http.MethodPost, "/v0/admin/auth-files", strings.NewReader(`{
		"key":"kiro-invalid-proxy",
		"proxy_url":"not-a-proxy",
		"content":{"type":"kiro","label":"Kiro Account","refresh_token":"refresh-secret","region":"us-east-1"}
	}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Create(ctx)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "invalid proxy_url") {
		t.Fatalf("response %s missing invalid proxy_url", recorder.Body.String())
	}
}

func TestParseAuthImportEntriesAcceptsNestedBundle(t *testing.T) {
	data := []byte(`{
		"authFiles": {
			"codex/a.json": {
				"id": "a",
				"provider": "codex",
				"accessToken": "access-a"
			},
			"codex/b.json": {
				"id": "b",
				"provider": "codex",
				"accessToken": "access-b"
			}
		}
	}`)

	entries, errParse := parseAuthImportEntries("bundle.json", data)
	if errParse != nil {
		t.Fatalf("parse entries: %v", errParse)
	}
	if len(entries) != 2 {
		t.Fatalf("entries len = %d, want 2", len(entries))
	}

	byID := make(map[string]authImportEntry, len(entries))
	for _, entry := range entries {
		id, _ := entry.Payload["id"].(string)
		byID[id] = entry
	}
	if byID["a"].File != "codex/a.json" {
		t.Fatalf("entry a file = %q, want codex/a.json", byID["a"].File)
	}
	if byID["b"].File != "codex/b.json" {
		t.Fatalf("entry b file = %q, want codex/b.json", byID["b"].File)
	}
}

func TestImportAndUpdateKiroAuthPayloadValidatesFieldsAndProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openAuthFilesTestDB(t)
	handler := NewAuthFileHandler(db)

	missingRefresh := map[string]any{
		"id":     "kiro-import-missing-refresh",
		"type":   "kiro",
		"label":  "Kiro",
		"region": "us-east-1",
	}
	if errImport := handler.importAuthPayload(context.Background(), "kiro.json", missingRefresh, models.AuthGroupIDs{}, false); errImport == nil {
		t.Fatal("expected missing refresh token import to fail")
	}

	valid := map[string]any{
		"id":            "kiro-import-valid",
		"provider":      "kiro",
		"label":         "Kiro",
		"refresh_token": "refresh",
		"region":        "us-east-1",
		"proxy_url":     "http://127.0.0.1:8080",
	}
	if errImport := handler.importAuthPayload(context.Background(), "kiro.json", valid, models.AuthGroupIDs{}, false); errImport != nil {
		t.Fatalf("import valid Kiro payload: %v", errImport)
	}
	var row models.Auth
	if errFind := db.Where("key = ?", "kiro-import-valid").First(&row).Error; errFind != nil {
		t.Fatalf("find imported Kiro auth: %v", errFind)
	}
	if row.ProxyURL != "http://127.0.0.1:8080/" {
		t.Fatalf("proxy_url = %q, want normalized URL", row.ProxyURL)
	}

	updateReq := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/v0/admin/auth-files/%d", row.ID), strings.NewReader(`{
		"content":{"type":"kiro","label":"Kiro","region":"us-east-1"}
	}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateRecorder := httptest.NewRecorder()
	updateCtx, _ := gin.CreateTestContext(updateRecorder)
	updateCtx.Request = updateReq
	updateCtx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", row.ID)}}

	handler.Update(updateCtx)
	if updateRecorder.Code != http.StatusBadRequest {
		t.Fatalf("update status = %d, want %d: %s", updateRecorder.Code, http.StatusBadRequest, updateRecorder.Body.String())
	}
	if !strings.Contains(updateRecorder.Body.String(), "refresh_token is required") {
		t.Fatalf("update response = %s", updateRecorder.Body.String())
	}
}

func TestImportAuthPayloadStoresCLIProxyAPIShape(t *testing.T) {
	db := openAuthFilesTestDB(t)
	handler := NewAuthFileHandler(db)
	payload := map[string]any{
		"id":          "16639dca-4807-4d76-8445-5c0642fde6bb",
		"provider":    "codex",
		"authType":    "oauth",
		"accessToken": "access-token",
		"email":       "user@example.com",
		"priority":    json.Number("1"),
		"isActive":    true,
	}

	if errImport := handler.importAuthPayload(context.Background(), "bundle.json", payload, models.AuthGroupIDs{}, false); errImport != nil {
		t.Fatalf("import payload: %v", errImport)
	}

	var row models.Auth
	if errFind := db.Where("key = ?", "16639dca-4807-4d76-8445-5c0642fde6bb").First(&row).Error; errFind != nil {
		t.Fatalf("find auth row: %v", errFind)
	}
	if !row.IsAvailable {
		t.Fatalf("is_available = false, want true")
	}
	if row.Priority != 1 {
		t.Fatalf("priority = %d, want 1", row.Priority)
	}

	var content map[string]any
	if errUnmarshal := json.Unmarshal(row.Content, &content); errUnmarshal != nil {
		t.Fatalf("unmarshal content: %v", errUnmarshal)
	}
	if content["provider"] != "codex" {
		t.Fatalf("provider = %v, want codex", content["provider"])
	}
	if content["type"] != "codex" {
		t.Fatalf("type = %v, want codex", content["type"])
	}
}

func TestExportAuthFilesUsesNestedCLIProxyAPIShape(t *testing.T) {
	db := openAuthFilesTestDB(t)
	now := time.Date(2026, 5, 18, 15, 20, 5, 46_000_000, time.UTC)
	row := models.Auth{
		Key:         "16639dca-4807-4d76-8445-5c0642fde6bb",
		ProxyURL:    "http://127.0.0.1:8080/",
		Content:     datatypes.JSON([]byte(`{"type":"codex","accessToken":"access-token","refreshToken":"refresh-token","email":"user@example.com","priority":7}`)),
		IsAvailable: true,
		Priority:    1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/auth-files/export", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Export(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response struct {
		AuthFiles map[string]map[string]any `json:"authFiles"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	payload := response.AuthFiles["16639dca-4807-4d76-8445-5c0642fde6bb.json"]
	if payload == nil {
		t.Fatalf("exported auth file not found: %+v", response.AuthFiles)
	}
	if payload["provider"] != "codex" {
		t.Fatalf("provider = %v, want codex", payload["provider"])
	}
	if _, ok := payload["type"]; ok {
		t.Fatalf("export payload included internal type: %+v", payload)
	}
	if _, ok := payload["id"]; ok {
		t.Fatalf("export payload included row-derived id: %+v", payload)
	}
	if payload["priority"] != float64(7) {
		t.Fatalf("priority = %v, want stored content value 7", payload["priority"])
	}
	for _, key := range []string{"proxy_url", "auth_group_id", "rate_limit", "isActive", "createdAt", "updatedAt", "created_at", "updated_at"} {
		if _, ok := payload[key]; ok {
			t.Fatalf("export payload included row metadata %q: %+v", key, payload)
		}
	}
}

func TestExportSelectedAuthFilesExportsOnlyRequestedIDs(t *testing.T) {
	db := openAuthFilesTestDB(t)
	rows := []models.Auth{
		{
			Key:         "auth-a",
			Content:     datatypes.JSON([]byte(`{"provider":"codex","accessToken":"access-a","refreshToken":"refresh-a"}`)),
			IsAvailable: true,
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		},
		{
			Key:         "auth-b",
			Content:     datatypes.JSON([]byte(`{"provider":"anthropic","accessToken":"access-b","refreshToken":"refresh-b"}`)),
			IsAvailable: true,
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		},
	}
	if errCreate := db.Create(&rows).Error; errCreate != nil {
		t.Fatalf("create auth rows: %v", errCreate)
	}

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db)
	reqBody := fmt.Sprintf(`{"ids":[%d]}`, rows[1].ID)
	req := httptest.NewRequest(http.MethodPost, "/v0/admin/auth-files/export", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.ExportSelected(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response struct {
		AuthFiles map[string]map[string]any `json:"authFiles"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.AuthFiles) != 1 {
		t.Fatalf("auth files len = %d, want 1: %+v", len(response.AuthFiles), response.AuthFiles)
	}
	if response.AuthFiles["auth-b.json"] == nil {
		t.Fatalf("selected auth-b export missing: %+v", response.AuthFiles)
	}
	if response.AuthFiles["auth-a.json"] != nil {
		t.Fatalf("unselected auth-a was exported: %+v", response.AuthFiles)
	}
}

func TestBatchDeleteAuthFilesDeletesExistingAndReportsMissing(t *testing.T) {
	db := openAuthFilesTestDB(t)
	rows := []models.Auth{
		{
			Key:         "auth-delete",
			Content:     datatypes.JSON([]byte(`{"provider":"codex","accessToken":"access"}`)),
			IsAvailable: true,
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		},
		{
			Key:         "auth-keep",
			Content:     datatypes.JSON([]byte(`{"provider":"codex","accessToken":"access"}`)),
			IsAvailable: true,
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		},
	}
	if errCreate := db.Create(&rows).Error; errCreate != nil {
		t.Fatalf("create auth rows: %v", errCreate)
	}

	missingID := rows[1].ID + 1000
	reqBody := fmt.Sprintf(`{"ids":[%d,%d,%d]}`, rows[0].ID, missingID, rows[0].ID)
	req := httptest.NewRequest(http.MethodPost, "/v0/admin/auth-files/batch-delete", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	handler := NewAuthFileHandler(db)

	handler.BatchDelete(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response struct {
		Deleted    int      `json:"deleted"`
		MissingIDs []uint64 `json:"missing_ids"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if response.Deleted != 1 {
		t.Fatalf("deleted = %d, want 1", response.Deleted)
	}
	if len(response.MissingIDs) != 1 || response.MissingIDs[0] != missingID {
		t.Fatalf("missing_ids = %+v, want [%d]", response.MissingIDs, missingID)
	}
	var deletedCount int64
	if errCount := db.Model(&models.Auth{}).Where("id = ?", rows[0].ID).Count(&deletedCount).Error; errCount != nil {
		t.Fatalf("count deleted row: %v", errCount)
	}
	if deletedCount != 0 {
		t.Fatalf("deleted row count = %d, want 0", deletedCount)
	}
	var keptCount int64
	if errCount := db.Model(&models.Auth{}).Where("id = ?", rows[1].ID).Count(&keptCount).Error; errCount != nil {
		t.Fatalf("count kept row: %v", errCount)
	}
	if keptCount != 1 {
		t.Fatalf("kept row count = %d, want 1", keptCount)
	}
}

func TestAuthFileResponsesRedactKiroMetadata(t *testing.T) {
	db := openAuthFilesTestDB(t)
	row := models.Auth{
		Key: "kiro-auth",
		Content: datatypes.JSON([]byte(`{
			"type": "kiro",
			"refresh_token": "refresh-secret",
			"access_token": "access-secret",
			"client_secret": "client-secret",
			"region": "us-east-1",
			"metadata": {
				"type": "kiro",
				"refresh_token": "nested-refresh",
				"access_token": "nested-access"
			}
		}`)),
		IsAvailable: true,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db)

	listReq := httptest.NewRequest(http.MethodGet, "/v0/admin/auth-files", nil)
	listRecorder := httptest.NewRecorder()
	listCtx, _ := gin.CreateTestContext(listRecorder)
	listCtx.Request = listReq
	handler.List(listCtx)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list status = %d: %s", listRecorder.Code, listRecorder.Body.String())
	}
	var listResponse struct {
		AuthFiles []struct {
			Content map[string]any `json:"content"`
		} `json:"auth_files"`
	}
	if errDecode := json.Unmarshal(listRecorder.Body.Bytes(), &listResponse); errDecode != nil {
		t.Fatalf("decode list response: %v", errDecode)
	}
	if len(listResponse.AuthFiles) != 1 {
		t.Fatalf("auth_files length = %d, want 1", len(listResponse.AuthFiles))
	}
	assertKiroContentRedacted(t, listResponse.AuthFiles[0].Content)

	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v0/admin/auth-files/%d", row.ID), nil)
	getRecorder := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRecorder)
	getCtx.Request = getReq
	getCtx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", row.ID)}}
	handler.Get(getCtx)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("get status = %d: %s", getRecorder.Code, getRecorder.Body.String())
	}
	var getResponse struct {
		Content map[string]any `json:"content"`
	}
	if errDecode := json.Unmarshal(getRecorder.Body.Bytes(), &getResponse); errDecode != nil {
		t.Fatalf("decode get response: %v", errDecode)
	}
	assertKiroContentRedacted(t, getResponse.Content)
}

func assertKiroContentRedacted(t *testing.T, content map[string]any) {
	t.Helper()
	for _, key := range []string{"refresh_token", "access_token", "client_secret"} {
		if content[key] != "[redacted]" {
			t.Fatalf("%s = %v, want [redacted] in %+v", key, content[key], content)
		}
	}
	if content["region"] != "us-east-1" {
		t.Fatalf("region = %v, want us-east-1", content["region"])
	}
	metadata, _ := content["metadata"].(map[string]any)
	if metadata == nil {
		t.Fatalf("metadata missing in %+v", content)
	}
	if metadata["refresh_token"] != "[redacted]" || metadata["access_token"] != "[redacted]" {
		t.Fatalf("nested metadata was not redacted: %+v", metadata)
	}
}

type authFilesRefreshTestExecutor struct {
	calls   int
	err     error
	updates map[string]any
}

func (e *authFilesRefreshTestExecutor) Identifier() string { return "kiro" }

func (e *authFilesRefreshTestExecutor) Execute(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *authFilesRefreshTestExecutor) ExecuteStream(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}

func (e *authFilesRefreshTestExecutor) Refresh(_ context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	e.calls++
	if e.err != nil {
		return nil, e.err
	}
	updated := auth.Clone()
	if updated.Metadata == nil {
		updated.Metadata = make(map[string]any)
	}
	for key, value := range e.updates {
		updated.Metadata[key] = value
	}
	return updated, nil
}

func (e *authFilesRefreshTestExecutor) CountTokens(context.Context, *coreauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *authFilesRefreshTestExecutor) HttpRequest(context.Context, *coreauth.Auth, *http.Request) (*http.Response, error) {
	return nil, nil
}

func TestAuthFileListAndGetIncludeDerivedHealth(t *testing.T) {
	db := openAuthFilesTestDB(t)
	row := models.Auth{
		Key: "health-list-auth",
		Content: datatypes.JSON([]byte(`{
			"type":"kiro",
			"refresh_token":"refresh-secret",
			"access_token":"access-secret",
			"expires_at":"2999-01-01T00:00:00Z"
		}`)),
		IsAvailable: true,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db)

	listReq := httptest.NewRequest(http.MethodGet, "/v0/admin/auth-files", nil)
	listRecorder := httptest.NewRecorder()
	listCtx, _ := gin.CreateTestContext(listRecorder)
	listCtx.Request = listReq
	handler.List(listCtx)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list status = %d: %s", listRecorder.Code, listRecorder.Body.String())
	}
	var listResponse struct {
		AuthFiles []struct {
			AuthHealth map[string]any `json:"auth_health"`
		} `json:"auth_files"`
	}
	if errDecode := json.Unmarshal(listRecorder.Body.Bytes(), &listResponse); errDecode != nil {
		t.Fatalf("decode list response: %v", errDecode)
	}
	if len(listResponse.AuthFiles) != 1 {
		t.Fatalf("auth_files length = %d, want 1", len(listResponse.AuthFiles))
	}
	if got := listResponse.AuthFiles[0].AuthHealth["state"]; got != authHealthStateHealthy {
		t.Fatalf("list auth_health.state = %v, want %s: %+v", got, authHealthStateHealthy, listResponse.AuthFiles[0].AuthHealth)
	}

	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v0/admin/auth-files/%d", row.ID), nil)
	getRecorder := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRecorder)
	getCtx.Request = getReq
	getCtx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", row.ID)}}
	handler.Get(getCtx)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("get status = %d: %s", getRecorder.Code, getRecorder.Body.String())
	}
	var getResponse struct {
		AuthHealth map[string]any `json:"auth_health"`
	}
	if errDecode := json.Unmarshal(getRecorder.Body.Bytes(), &getResponse); errDecode != nil {
		t.Fatalf("decode get response: %v", errDecode)
	}
	if got := getResponse.AuthHealth["state"]; got != authHealthStateHealthy {
		t.Fatalf("get auth_health.state = %v, want %s: %+v", got, authHealthStateHealthy, getResponse.AuthHealth)
	}
}

func TestLivenessCheckDoesNotMutateAuthContent(t *testing.T) {
	db := openAuthFilesTestDB(t)
	originalContent := datatypes.JSON([]byte(`{
		"type":"kiro",
		"refresh_token":"refresh-old",
		"access_token":"access-old",
		"expires_at":"2999-01-01T00:00:00Z"
	}`))
	row := models.Auth{
		Key:         "liveness-auth",
		Content:     originalContent,
		IsAvailable: false,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}
	if errUpdate := db.Model(&models.Auth{}).Where("id = ?", row.ID).Update("is_available", false).Error; errUpdate != nil {
		t.Fatalf("mark auth unavailable: %v", errUpdate)
	}
	manager := coreauth.NewManager(nil, nil, nil)
	executor := &authFilesRefreshTestExecutor{}
	manager.RegisterExecutor(executor)

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db, manager)
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v0/admin/auth-files/%d/liveness-check", row.ID), nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", row.ID)}}

	handler.LivenessCheck(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if executor.calls != 0 {
		t.Fatalf("liveness called refresh %d times", executor.calls)
	}
	var updated models.Auth
	if errFind := db.First(&updated, row.ID).Error; errFind != nil {
		t.Fatalf("find auth row: %v", errFind)
	}
	if !jsonEqual(updated.Content, originalContent) {
		t.Fatalf("auth content changed: got %s want %s", string(updated.Content), string(originalContent))
	}
	if updated.IsAvailable {
		t.Fatalf("liveness marked unavailable auth available")
	}
	var response struct {
		AuthHealth map[string]any `json:"auth_health"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if got := response.AuthHealth["state"]; got != authHealthStateHealthy {
		t.Fatalf("auth_health.state = %v, want %s: %+v", got, authHealthStateHealthy, response.AuthHealth)
	}
}

func TestRefreshPersistsTokensRecordsHealthAndPreservesAvailability(t *testing.T) {
	db := openAuthFilesTestDB(t)
	row := models.Auth{
		Key: "refresh-auth",
		Content: datatypes.JSON([]byte(`{
			"type":"kiro",
			"refresh_token":"refresh-old",
			"access_token":"access-old",
			"expires_at":"2000-01-01T00:00:00Z"
		}`)),
		IsAvailable: false,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}
	if errUpdate := db.Model(&models.Auth{}).Where("id = ?", row.ID).Update("is_available", false).Error; errUpdate != nil {
		t.Fatalf("mark auth unavailable: %v", errUpdate)
	}
	manager := coreauth.NewManager(nil, nil, nil)
	executor := &authFilesRefreshTestExecutor{updates: map[string]any{
		"access_token":  "access-new",
		"refresh_token": "refresh-new",
		"expires_at":    "2999-01-01T00:00:00Z",
	}}
	manager.RegisterExecutor(executor)

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db, manager)
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v0/admin/auth-files/%d/refresh", row.ID), nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", row.ID)}}

	handler.Refresh(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if executor.calls != 1 {
		t.Fatalf("refresh calls = %d, want 1", executor.calls)
	}
	var updated models.Auth
	if errFind := db.First(&updated, row.ID).Error; errFind != nil {
		t.Fatalf("find auth row: %v", errFind)
	}
	if updated.IsAvailable {
		t.Fatalf("refresh marked unavailable auth available")
	}
	var content map[string]any
	if errUnmarshal := json.Unmarshal(updated.Content, &content); errUnmarshal != nil {
		t.Fatalf("unmarshal content: %v", errUnmarshal)
	}
	if content["access_token"] != "access-new" || content["refresh_token"] != "refresh-new" {
		t.Fatalf("content tokens not refreshed: %+v", content)
	}
	if auth, ok := manager.GetByID(row.Key); ok || auth != nil {
		t.Fatalf("unavailable auth was loaded into runtime: %+v", auth)
	}
	var quotaRow models.Quota
	if errFind := db.Where("auth_id = ? AND type = ?", row.ID, "kiro").First(&quotaRow).Error; errFind != nil {
		t.Fatalf("find quota health: %v", errFind)
	}
	_, status := quotapkg.UnwrapStoredQuotaData(quotaRow.Data)
	if status == nil || status.State != authHealthStateHealthy || status.NeedsRelogin {
		t.Fatalf("quota auth status = %+v, want healthy", status)
	}
}

func TestRefreshFailureDoesNotMutateAuthContent(t *testing.T) {
	db := openAuthFilesTestDB(t)
	originalContent := datatypes.JSON([]byte(`{"type":"kiro","refresh_token":"refresh-old","access_token":"access-old"}`))
	row := models.Auth{
		Key:         "refresh-fail-auth",
		Content:     originalContent,
		IsAvailable: true,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if errCreate := db.Create(&row).Error; errCreate != nil {
		t.Fatalf("create auth row: %v", errCreate)
	}
	manager := coreauth.NewManager(nil, nil, nil)
	manager.RegisterExecutor(&authFilesRefreshTestExecutor{err: fmt.Errorf("upstream rejected refresh")})

	gin.SetMode(gin.TestMode)
	handler := NewAuthFileHandler(db, manager)
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v0/admin/auth-files/%d/refresh", row.ID), nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", row.ID)}}

	handler.Refresh(ctx)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusBadGateway, recorder.Body.String())
	}
	var updated models.Auth
	if errFind := db.First(&updated, row.ID).Error; errFind != nil {
		t.Fatalf("find auth row: %v", errFind)
	}
	if !jsonEqual(updated.Content, originalContent) {
		t.Fatalf("auth content changed after failed refresh: got %s want %s", string(updated.Content), string(originalContent))
	}
	var quotaRow models.Quota
	if errFind := db.Where("auth_id = ? AND type = ?", row.ID, "kiro").First(&quotaRow).Error; errFind != nil {
		t.Fatalf("find quota health: %v", errFind)
	}
	_, status := quotapkg.UnwrapStoredQuotaData(quotaRow.Data)
	if status == nil || status.State != authHealthStateRefreshFailed {
		t.Fatalf("quota auth status = %+v, want refresh_failed", status)
	}
}
