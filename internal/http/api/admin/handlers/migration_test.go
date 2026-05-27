package handlers

import (
	"bytes"
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
	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func openMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_migration_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.AutoMigrate(
		&models.Admin{},
		&models.Plan{},
		&models.UserGroup{},
		&models.AuthGroup{},
		&models.User{},
		&models.Auth{},
		&models.Quota{},
		&models.APIKey{},
		&models.Usage{},
		&models.Bill{},
		&models.BillingRule{},
		&models.ModelMapping{},
		&models.ModelReference{},
		&models.UserModelAuthBinding{},
		&models.ModelPayloadRule{},
		&models.ProviderAPIKey{},
		&models.Proxy{},
		&models.PrepaidCard{},
		&models.Setting{},
	); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func TestMigrationExportImportRoundTripPreservesOperationalData(t *testing.T) {
	gin.SetMode(gin.TestMode)
	source := openMigrationTestDB(t)
	seedMigrationTestData(t, source)

	exportHandler := NewMigrationHandler(source)
	exportReq := httptest.NewRequest(http.MethodGet, "/v0/admin/migration/export", nil)
	exportRecorder := httptest.NewRecorder()
	exportCtx, _ := gin.CreateTestContext(exportRecorder)
	exportCtx.Request = exportReq

	exportHandler.Export(exportCtx)
	if exportRecorder.Code != http.StatusOK {
		t.Fatalf("export status = %d, want %d: %s", exportRecorder.Code, http.StatusOK, exportRecorder.Body.String())
	}
	if got := exportRecorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	var bundle migrationBundle
	if errDecode := json.Unmarshal(exportRecorder.Body.Bytes(), &bundle); errDecode != nil {
		t.Fatalf("decode export: %v", errDecode)
	}
	if bundle.Version != migrationSchemaVersion {
		t.Fatalf("version = %d, want %d", bundle.Version, migrationSchemaVersion)
	}
	if bundle.Counts["users"] != 1 || bundle.Counts["api_keys"] != 1 || bundle.Counts["usages"] != 1 {
		t.Fatalf("unexpected counts: %+v", bundle.Counts)
	}

	target := openMigrationTestDB(t)
	importHandler := NewMigrationHandler(target)
	importReq := httptest.NewRequest(http.MethodPost, "/v0/admin/migration/import", bytes.NewReader(exportRecorder.Body.Bytes()))
	importReq.Header.Set("Content-Type", "application/json")
	importRecorder := httptest.NewRecorder()
	importCtx, _ := gin.CreateTestContext(importRecorder)
	importCtx.Request = importReq

	importHandler.Import(importCtx)
	if importRecorder.Code != http.StatusOK {
		t.Fatalf("import status = %d, want %d: %s", importRecorder.Code, http.StatusOK, importRecorder.Body.String())
	}

	var response migrationImportResponse
	if errDecode := json.Unmarshal(importRecorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode import response: %v", errDecode)
	}
	if response.Imported["users"] != 1 || response.Imported["auths"] != 1 || response.Imported["settings"] != 1 {
		t.Fatalf("unexpected imported counts: %+v", response.Imported)
	}

	var user models.User
	if errFind := target.First(&user, 40).Error; errFind != nil {
		t.Fatalf("find imported user: %v", errFind)
	}
	if user.Username != "alice" || user.PlanID == nil || *user.PlanID != 30 {
		t.Fatalf("imported user mismatch: %+v", user)
	}
	if len(user.UserGroupID.Values()) != 1 || user.UserGroupID.Values()[0] != 10 {
		t.Fatalf("user group ids = %+v, want [10]", user.UserGroupID.Values())
	}

	var apiKey models.APIKey
	if errFind := target.First(&apiKey, 50).Error; errFind != nil {
		t.Fatalf("find imported api key: %v", errFind)
	}
	if apiKey.APIKey != "cpab-key-alice" || apiKey.UserID == nil || *apiKey.UserID != user.ID {
		t.Fatalf("imported api key mismatch: %+v", apiKey)
	}

	var auth models.Auth
	if errFind := target.First(&auth, 60).Error; errFind != nil {
		t.Fatalf("find imported auth: %v", errFind)
	}
	if auth.Key != "auth-codex" || !json.Valid(auth.Content) {
		t.Fatalf("imported auth mismatch: %+v", auth)
	}

	var usageCount int64
	if errCount := target.Model(&models.Usage{}).Count(&usageCount).Error; errCount != nil {
		t.Fatalf("count usage: %v", errCount)
	}
	if usageCount != 1 {
		t.Fatalf("usage count = %d, want 1", usageCount)
	}

	var setting models.Setting
	if errFind := target.Where("key = ?", internalsettings.SiteNameKey).First(&setting).Error; errFind != nil {
		t.Fatalf("find imported setting: %v", errFind)
	}
	if string(setting.Value) != `"Migrated CPAB"` {
		t.Fatalf("setting value = %s, want migrated site name", string(setting.Value))
	}
}

func TestMigrationExportCanSkipUsageRows(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openMigrationTestDB(t)
	seedMigrationTestData(t, db)

	handler := NewMigrationHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/v0/admin/migration/export?include_usage=false", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Export(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var bundle migrationBundle
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &bundle); errDecode != nil {
		t.Fatalf("decode export: %v", errDecode)
	}
	if len(bundle.Data.Usages) != 0 || bundle.Counts["usages"] != 0 {
		t.Fatalf("usage was exported despite include_usage=false: counts=%+v len=%d", bundle.Counts, len(bundle.Data.Usages))
	}
	if len(bundle.Data.Users) != 1 || len(bundle.Data.Auths) != 1 {
		t.Fatalf("operational data missing when skipping usage: users=%d auths=%d", len(bundle.Data.Users), len(bundle.Data.Auths))
	}
}

func TestMigrationImportRejectsUnsupportedVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openMigrationTestDB(t)
	handler := NewMigrationHandler(db)

	req := httptest.NewRequest(http.MethodPost, "/v0/admin/migration/import", strings.NewReader(`{"app":"CLIProxyAPIBusiness","version":999,"data":{}}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.Import(ctx)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "unsupported migration version") {
		t.Fatalf("response missing version error: %s", recorder.Body.String())
	}
}

func seedMigrationTestData(t *testing.T, db *gorm.DB) {
	t.Helper()

	now := time.Date(2026, 5, 27, 10, 0, 0, 0, time.UTC)
	userGroupID := uint64(10)
	authGroupID := uint64(20)
	planID := uint64(30)
	userID := uint64(40)
	apiKeyID := uint64(50)
	authID := uint64(60)
	modelMappingID := uint64(90)
	zero := float64(0)

	rows := []any{
		&models.Admin{
			ID:           1,
			Username:     "root",
			Password:     "hashed-admin-password",
			Active:       true,
			IsSuperAdmin: true,
			Permissions:  datatypes.JSON([]byte(`[]`)),
			CreatedAt:    now,
			UpdatedAt:    now,
		},
		&models.UserGroup{
			ID:        userGroupID,
			Name:      "Enterprise",
			IsDefault: true,
			RateLimit: 25,
			CreatedAt: now,
			UpdatedAt: now,
		},
		&models.AuthGroup{
			ID:          authGroupID,
			Name:        "Default Auth",
			IsDefault:   true,
			RateLimit:   15,
			UserGroupID: models.UserGroupIDs{&userGroupID},
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		&models.Plan{
			ID:            planID,
			Name:          "Business",
			MonthPrice:    99,
			Description:   "Business plan",
			SupportModels: datatypes.JSON([]byte(`["gpt-4.1"]`)),
			UserGroupID:   models.UserGroupIDs{&userGroupID},
			TotalQuota:    1000,
			DailyQuota:    100,
			RateLimit:     20,
			IsEnabled:     true,
			CreatedAt:     now,
			UpdatedAt:     now,
		},
		&models.User{
			ID:              userID,
			Username:        "alice",
			Name:            "Alice",
			Email:           "alice@example.com",
			Password:        "hashed-user-password",
			UserGroupID:     models.UserGroupIDs{&userGroupID},
			BillUserGroupID: models.UserGroupIDs{&userGroupID},
			PlanID:          &planID,
			DailyMaxUsage:   100,
			RateLimit:       10,
			Active:          true,
			Disabled:        false,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		&models.Auth{
			ID:          authID,
			Key:         "auth-codex",
			ProxyURL:    "http://127.0.0.1:8080/",
			AuthGroupID: models.AuthGroupIDs{&authGroupID},
			Content:     datatypes.JSON([]byte(`{"type":"codex","accessToken":"secret"}`)),
			IsAvailable: true,
			RateLimit:   11,
			Priority:    3,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		&models.ProviderAPIKey{
			ID:        70,
			Provider:  "openai",
			Priority:  5,
			Name:      "OpenAI main",
			APIKey:    "sk-secret",
			BaseURL:   "https://api.openai.com/v1",
			Headers:   datatypes.JSON([]byte(`{"X-Test":"yes"}`)),
			Models:    datatypes.JSON([]byte(`["gpt-4.1"]`)),
			CreatedAt: now,
			UpdatedAt: now,
		},
		&models.Proxy{
			ID:         80,
			ProxyURL:   "http://127.0.0.1:8080/",
			IsActive:   true,
			TestStatus: "ok",
			CreatedAt:  now,
			UpdatedAt:  now,
		},
		&models.ModelMapping{
			ID:           modelMappingID,
			Provider:     "openai",
			ModelName:    "gpt-4.1",
			NewModelName: "gpt-4.1-business",
			Selector:     2,
			RateLimit:    9,
			UserGroupID:  models.UserGroupIDs{&userGroupID},
			IsEnabled:    true,
			CreatedAt:    now,
			UpdatedAt:    now,
		},
		&models.ModelReference{
			ProviderName: "openai",
			ModelName:    "gpt-4.1",
			ModelID:      "gpt-4.1",
			ContextLimit: 128000,
			OutputLimit:  4096,
			InputPrice:   &zero,
			OutputPrice:  &zero,
			Extra:        datatypes.JSON([]byte(`{}`)),
			LastSeenAt:   now,
			CreatedAt:    now,
			UpdatedAt:    now,
		},
		&models.ModelPayloadRule{
			ID:             100,
			ModelMappingID: modelMappingID,
			Protocol:       "openai",
			Params:         datatypes.JSON([]byte(`{"temperature":0.2}`)),
			IsEnabled:      true,
			Description:    "Default payload",
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		&models.UserModelAuthBinding{
			ID:             110,
			UserID:         userID,
			ModelMappingID: modelMappingID,
			AuthIndex:      "auth-codex",
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		&models.APIKey{
			ID:        apiKeyID,
			UserID:    &userID,
			Name:      "Alice key",
			APIKey:    "cpab-key-alice",
			Active:    true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		&models.Bill{
			ID:          130,
			PlanID:      planID,
			UserID:      userID,
			UserGroupID: models.UserGroupIDs{&userGroupID},
			PeriodType:  models.BillPeriodTypeMonthly,
			Amount:      99,
			PeriodStart: now,
			PeriodEnd:   now.AddDate(0, 1, 0),
			TotalQuota:  1000,
			DailyQuota:  100,
			LeftQuota:   900,
			RateLimit:   10,
			IsEnabled:   true,
			Status:      models.BillStatusPaid,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		&models.BillingRule{
			ID:                    120,
			AuthGroupID:           authGroupID,
			UserGroupID:           userGroupID,
			Provider:              "openai",
			Model:                 "gpt-4.1-business",
			BillingType:           models.BillingTypePerToken,
			PriceInputToken:       &zero,
			PriceOutputToken:      &zero,
			PriceCacheCreateToken: &zero,
			PriceCacheReadToken:   &zero,
			IsEnabled:             true,
			CreatedAt:             now,
			UpdatedAt:             now,
		},
		&models.PrepaidCard{
			ID:             140,
			Name:           "Migration card",
			CardSN:         "CARD-001",
			Password:       "card-secret",
			Amount:         50,
			Balance:        25,
			ValidDays:      30,
			IsEnabled:      true,
			RedeemedUserID: &userID,
			UserGroupID:    &userGroupID,
			CreatedAt:      now,
			RedeemedAt:     &now,
		},
		&models.Quota{
			ID:        150,
			AuthID:    authID,
			Type:      "codex",
			Data:      datatypes.JSON([]byte(`{"left":123}`)),
			CreatedAt: now,
			UpdatedAt: now,
		},
		&models.Usage{
			ID:             160,
			Provider:       "openai",
			Model:          "gpt-4.1-business",
			RequestedModel: "gpt-4.1-business",
			UpstreamModel:  "gpt-4.1",
			UserID:         &userID,
			UserGroupID:    &userGroupID,
			APIKeyID:       &apiKeyID,
			AuthID:         &authID,
			AuthKey:        "auth-codex",
			AuthIndex:      "auth-codex",
			Source:         "test",
			RequestedAt:    now,
			InputTokens:    12,
			OutputTokens:   34,
			TotalTokens:    46,
			CostMicros:     100,
			CreatedAt:      now,
		},
		&models.Setting{
			Key:       internalsettings.SiteNameKey,
			Value:     json.RawMessage(`"Migrated CPAB"`),
			UpdatedAt: now,
		},
	}

	for _, row := range rows {
		if errCreate := db.Create(row).Error; errCreate != nil {
			t.Fatalf("create %T: %v", row, errCreate)
		}
	}
}
