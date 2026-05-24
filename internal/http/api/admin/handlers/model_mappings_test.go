package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestModelTestUsesProxyRouteAndRedactsAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	var gotAuth string
	router.POST("/v1/chat/completions", func(c *gin.Context) {
		gotAuth = c.GetHeader("Authorization")
		c.JSON(http.StatusBadGateway, gin.H{"error": "proxy failed with sk-secret-test"})
	})

	handler := NewModelMappingHandler(nil, router)
	req := httptest.NewRequest(http.MethodPost, "/v0/admin/model-tests", strings.NewReader(`{
		"model": "claude-sonnet-4.5-thinking",
		"api_key": "sk-secret-test"
	}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.TestModel(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if gotAuth != "Bearer sk-secret-test" {
		t.Fatalf("Authorization = %q, want bearer api key", gotAuth)
	}
	var result modelTestResult
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &result); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if result.OK {
		t.Fatalf("ok = true, want failed result")
	}
	if result.ErrorType != "proxy_failure" {
		t.Fatalf("error_type = %q, want proxy_failure", result.ErrorType)
	}
	if strings.Contains(result.Error, "sk-secret-test") {
		t.Fatalf("error leaked api key: %s", result.Error)
	}
}

func TestBatchTestModelsWarmsFirstModelBeforeParallelTests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	var (
		mu    sync.Mutex
		order []string
	)
	router.POST("/v1/chat/completions", func(c *gin.Context) {
		var payload struct {
			Model string `json:"model"`
		}
		if errBind := c.ShouldBindJSON(&payload); errBind != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
			return
		}
		mu.Lock()
		order = append(order, payload.Model)
		mu.Unlock()
		c.JSON(http.StatusOK, gin.H{"id": "chatcmpl-test", "choices": []gin.H{{"message": gin.H{"content": "OK"}}}})
	})

	handler := NewModelMappingHandler(nil, router)
	req := httptest.NewRequest(http.MethodPost, "/v0/admin/model-tests/batch", strings.NewReader(`{
		"models": ["first-model", "second-model", "third-model"],
		"api_key": "sk-test",
		"max_concurrency": 2
	}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.BatchTestModels(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response struct {
		Results []modelTestResult `json:"results"`
		Summary struct {
			OK int `json:"ok"`
		} `json:"summary"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if len(response.Results) != 3 {
		t.Fatalf("results len = %d, want 3", len(response.Results))
	}
	if response.Summary.OK != 3 {
		t.Fatalf("ok summary = %d, want 3", response.Summary.OK)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(order) != 3 {
		t.Fatalf("call order len = %d, want 3", len(order))
	}
	if order[0] != "first-model" {
		t.Fatalf("first tested model = %q, want first-model; order=%v", order[0], order)
	}
}
