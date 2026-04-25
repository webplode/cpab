package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

func openAdminUsageTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_usage_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Usage{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func seedUsageRows(t *testing.T, db *gorm.DB) {
	t.Helper()

	now := time.Now().UTC()
	rows := []models.Usage{
		{
			Provider:     "openai",
			Model:        "gpt-4.1",
			RequestedAt:  now.Add(-2 * time.Hour),
			CreatedAt:    now.Add(-2*time.Hour + 200*time.Millisecond),
			Failed:       false,
			InputTokens:  120,
			OutputTokens: 80,
			TotalTokens:  200,
			CostMicros:   2500000,
		},
		{
			Provider:     "anthropic",
			Model:        "claude-sonnet-4.6",
			RequestedAt:  now.Add(-90 * time.Minute),
			CreatedAt:    now.Add(-90*time.Minute + 400*time.Millisecond),
			Failed:       true,
			InputTokens:  90,
			OutputTokens: 10,
			TotalTokens:  100,
			CostMicros:   1750000,
		},
		{
			Provider:     "openai",
			Model:        "gpt-4.1",
			RequestedAt:  now.AddDate(0, 0, -1),
			CreatedAt:    now.AddDate(0, 0, -1).Add(250 * time.Millisecond),
			Failed:       false,
			InputTokens:  50,
			OutputTokens: 25,
			TotalTokens:  75,
			CostMicros:   500000,
		},
	}
	if errCreate := db.Create(&rows).Error; errCreate != nil {
		t.Fatalf("create usage rows: %v", errCreate)
	}
}

func TestAdminUsageOverviewFiltersByProviderAndModel(t *testing.T) {
	db := openAdminUsageTestDB(t)
	seedUsageRows(t, db)

	handler := NewAdminUsageHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/usage?range=today&provider=openai&model=gpt-4.1", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Overview(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		Summary struct {
			Requests         int64   `json:"requests"`
			TotalTokens      int64   `json:"total_tokens"`
			CostMicros       int64   `json:"cost_micros"`
			AvgRequestTimeMs int64   `json:"avg_request_time_ms"`
			ErrorRate        float64 `json:"error_rate"`
		} `json:"summary"`
		TopProviders []struct {
			Name string `json:"name"`
		} `json:"top_providers"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}

	if response.Summary.Requests != 1 {
		t.Fatalf("requests = %d, want 1", response.Summary.Requests)
	}
	if response.Summary.TotalTokens != 200 {
		t.Fatalf("total_tokens = %d, want 200", response.Summary.TotalTokens)
	}
	if response.Summary.CostMicros != 2500000 {
		t.Fatalf("cost_micros = %d, want 2500000", response.Summary.CostMicros)
	}
	if response.Summary.ErrorRate != 0 {
		t.Fatalf("error_rate = %v, want 0", response.Summary.ErrorRate)
	}
	if response.Summary.AvgRequestTimeMs <= 0 {
		t.Fatalf("avg_request_time_ms = %d, want positive", response.Summary.AvgRequestTimeMs)
	}
	if len(response.TopProviders) != 1 || response.TopProviders[0].Name != "openai" {
		t.Fatalf("top_providers = %+v, want only openai", response.TopProviders)
	}
}

func TestAdminLogsStatsRespectFilters(t *testing.T) {
	db := openAdminUsageTestDB(t)
	seedUsageRows(t, db)

	handler := NewAdminLogsHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/logs/stats?range=today&provider=anthropic&model=claude-sonnet-4.6", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Stats(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response struct {
		RequestsToday      int64   `json:"requests_today"`
		TokensConsumed     int64   `json:"tokens_consumed"`
		AvgRequestTimeMs   int64   `json:"avg_request_time_ms"`
		ErrorRate          float64 `json:"error_rate"`
		RequestsTodayLabel string  `json:"requests_today_display"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}

	if response.RequestsToday != 1 {
		t.Fatalf("requests_today = %d, want 1", response.RequestsToday)
	}
	if response.TokensConsumed != 100 {
		t.Fatalf("tokens_consumed = %d, want 100", response.TokensConsumed)
	}
	if response.ErrorRate != 100 {
		t.Fatalf("error_rate = %v, want 100", response.ErrorRate)
	}
	if response.AvgRequestTimeMs <= 0 {
		t.Fatalf("avg_request_time_ms = %d, want positive", response.AvgRequestTimeMs)
	}
	if response.RequestsTodayLabel == "" {
		t.Fatal("requests_today_display should not be empty")
	}
}
