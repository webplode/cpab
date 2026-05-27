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
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

func openProxiesTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_proxies_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(&models.Proxy{}); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func TestBatchDeleteProxiesDeletesExistingAndReportsMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openProxiesTestDB(t)
	now := time.Now().UTC()
	rows := []models.Proxy{
		{
			ProxyURL:   "http://127.0.0.1:8080/",
			IsActive:   true,
			TestStatus: proxyTestStatusNew,
			CreatedAt:  now,
			UpdatedAt:  now,
		},
		{
			ProxyURL:   "http://127.0.0.1:8081/",
			IsActive:   true,
			TestStatus: proxyTestStatusNew,
			CreatedAt:  now,
			UpdatedAt:  now,
		},
	}
	if errCreate := db.Create(&rows).Error; errCreate != nil {
		t.Fatalf("create proxy rows: %v", errCreate)
	}

	missingID := rows[1].ID + 1000
	reqBody := fmt.Sprintf(`{"ids":[%d,%d,%d]}`, rows[0].ID, missingID, rows[0].ID)
	req := httptest.NewRequest(http.MethodPost, "/v0/admin/proxies/batch-delete", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	handler := NewProxyHandler(db)

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
	if errCount := db.Model(&models.Proxy{}).Where("id = ?", rows[0].ID).Count(&deletedCount).Error; errCount != nil {
		t.Fatalf("count deleted row: %v", errCount)
	}
	if deletedCount != 0 {
		t.Fatalf("deleted row count = %d, want 0", deletedCount)
	}
	var keptCount int64
	if errCount := db.Model(&models.Proxy{}).Where("id = ?", rows[1].ID).Count(&keptCount).Error; errCount != nil {
		t.Fatalf("count kept row: %v", errCount)
	}
	if keptCount != 1 {
		t.Fatalf("kept row count = %d, want 1", keptCount)
	}
}

func TestDefaultProxyCheckUsesDualStackLivenessTarget(t *testing.T) {
	services, ok := selectProxyCheckServices("")
	if !ok {
		t.Fatal("selectProxyCheckServices returned not ok")
	}
	if len(services) != 1 {
		t.Fatalf("default services length = %d, want 1", len(services))
	}
	service := normalizeProxyCheckService(services[0])
	if service.URL != "https://google.com/" {
		t.Fatalf("default service URL = %q, want https://google.com/", service.URL)
	}
	if service.Method != http.MethodHead {
		t.Fatalf("default service method = %q, want %q", service.Method, http.MethodHead)
	}
	if service.ExpectsIP {
		t.Fatal("default service should not require an IP response body")
	}
}

func TestCheckProxyLivenessAllowsHeadWithoutIPBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	ip, statusCode, statusText, errCheck := checkProxyLiveness(
		context.Background(),
		"direct",
		proxyCheckService{
			Name:   "test",
			URL:    server.URL,
			Method: http.MethodHead,
		},
	)
	if errCheck != nil {
		t.Fatalf("checkProxyLiveness returned error: %v", errCheck)
	}
	if ip != "" {
		t.Fatalf("ip = %q, want empty for HEAD liveness check", ip)
	}
	if statusCode != http.StatusNoContent {
		t.Fatalf("statusCode = %d, want %d", statusCode, http.StatusNoContent)
	}
	if !strings.Contains(statusText, "204") {
		t.Fatalf("statusText = %q, want 204 status", statusText)
	}
}

func TestParseProxyCheckIPAcceptsIPv6(t *testing.T) {
	ip, errParse := parseProxyCheckIP([]byte(`{"ip":"2001:db8::1"}`))
	if errParse != nil {
		t.Fatalf("parseProxyCheckIP returned error: %v", errParse)
	}
	if ip != "2001:db8::1" {
		t.Fatalf("ip = %q, want 2001:db8::1", ip)
	}
}
