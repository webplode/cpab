package usage

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	coreusage "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/usage"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/datatypes"
)

func TestUsageErrorDetailCaptured(t *testing.T) {
	gin.SetMode(gin.TestMode)

	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ginCtx.Status(http.StatusBadGateway)
	ginCtx.Set("API_RESPONSE", []byte(`{"error":{"message":"upstream failed"}}`))

	ctx := context.WithValue(context.Background(), "gin", ginCtx)

	plugin := NewGormUsagePlugin(conn)
	plugin.HandleUsage(ctx, coreusage.Record{
		Provider:    "openai",
		Model:       "gpt-4",
		RequestedAt: time.Now().UTC(),
		Failed:      true,
	})

	var row struct {
		ErrorStatusCode sql.NullInt64 `gorm:"column:error_status_code"`
		ErrorDetail     []byte        `gorm:"column:error_detail"`
	}
	if errFind := conn.Table("usages").
		Select("error_status_code, error_detail").
		Order("id DESC").
		Take(&row).Error; errFind != nil {
		t.Fatalf("query error detail: %v", errFind)
	}

	if !row.ErrorStatusCode.Valid || row.ErrorStatusCode.Int64 != http.StatusBadGateway {
		t.Fatalf("expected error_status_code=502, got %v", row.ErrorStatusCode.Int64)
	}

	var payload map[string]any
	if errUnmarshal := json.Unmarshal(row.ErrorDetail, &payload); errUnmarshal != nil {
		t.Fatalf("unmarshal error detail: %v", errUnmarshal)
	}
	if payload["status_code"] != float64(http.StatusBadGateway) {
		t.Fatalf("expected status_code=502")
	}
	if payload["message"] != "upstream failed" {
		t.Fatalf("expected message 'upstream failed'")
	}
}

func TestUsagePersistsRequestedAndUpstreamModels(t *testing.T) {
	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	plugin := NewGormUsagePlugin(conn)
	plugin.HandleUsage(context.Background(), coreusage.Record{
		Provider:    "kiro",
		Model:       "claude-sonnet-4.5",
		Alias:       "claude-sonnet-4.5-thinking-agentic",
		AuthID:      "kiro-auth",
		AuthIndex:   "kiro-auth#1",
		RequestedAt: time.Now().UTC(),
		Detail: coreusage.Detail{
			InputTokens:     10,
			OutputTokens:    5,
			ReasoningTokens: 3,
		},
	})

	var row struct {
		Model           string `gorm:"column:model"`
		RequestedModel  string `gorm:"column:requested_model"`
		UpstreamModel   string `gorm:"column:upstream_model"`
		AuthKey         string `gorm:"column:auth_key"`
		AuthIndex       string `gorm:"column:auth_index"`
		InputTokens     int64  `gorm:"column:input_tokens"`
		OutputTokens    int64  `gorm:"column:output_tokens"`
		ReasoningTokens int64  `gorm:"column:reasoning_tokens"`
		TotalTokens     int64  `gorm:"column:total_tokens"`
	}
	if errFind := conn.Table("usages").
		Select("model, requested_model, upstream_model, auth_key, auth_index, input_tokens, output_tokens, reasoning_tokens, total_tokens").
		Order("id DESC").
		Take(&row).Error; errFind != nil {
		t.Fatalf("query usage row: %v", errFind)
	}

	if row.Model != "claude-sonnet-4.5-thinking-agentic" {
		t.Fatalf("model = %q, want requested model", row.Model)
	}
	if row.RequestedModel != "claude-sonnet-4.5-thinking-agentic" {
		t.Fatalf("requested_model = %q", row.RequestedModel)
	}
	if row.UpstreamModel != "claude-sonnet-4.5" {
		t.Fatalf("upstream_model = %q", row.UpstreamModel)
	}
	if row.AuthKey != "kiro-auth" || row.AuthIndex != "kiro-auth#1" {
		t.Fatalf("auth attribution = %q/%q", row.AuthKey, row.AuthIndex)
	}
	if row.InputTokens != 10 || row.OutputTokens != 5 || row.ReasoningTokens != 3 || row.TotalTokens != 18 {
		t.Fatalf("token detail = input %d output %d reasoning %d total %d", row.InputTokens, row.OutputTokens, row.ReasoningTokens, row.TotalTokens)
	}
}

func TestUsageAppliesKiroBillingRuleAndUserGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	now := time.Now().UTC()
	userGroup := models.UserGroup{Name: "kiro-billing-users", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&userGroup).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}
	authGroup := models.AuthGroup{Name: "kiro-billing-auths", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&authGroup).Error; errCreate != nil {
		t.Fatalf("create auth group: %v", errCreate)
	}
	user := models.User{
		Username:    "kiro-billing-user",
		Password:    "hashed",
		UserGroupID: models.UserGroupIDs{&userGroup.ID},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := conn.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}
	authRow := models.Auth{
		Key:         "kiro-billing-auth",
		AuthGroupID: models.AuthGroupIDs{&authGroup.ID},
		Content:     datatypes.JSON([]byte(`{"type":"kiro","label":"Kiro","refresh_token":"refresh","region":"us-east-1"}`)),
		IsAvailable: true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := conn.Create(&authRow).Error; errCreate != nil {
		t.Fatalf("create auth: %v", errCreate)
	}

	inputPrice := 100.0
	outputPrice := 200.0
	rule := models.BillingRule{
		AuthGroupID:      authGroup.ID,
		UserGroupID:      userGroup.ID,
		Provider:         "kiro",
		Model:            "claude-sonnet-4.5-thinking-agentic",
		BillingType:      models.BillingTypePerToken,
		PriceInputToken:  &inputPrice,
		PriceOutputToken: &outputPrice,
		IsEnabled:        true,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if errCreate := conn.Create(&rule).Error; errCreate != nil {
		t.Fatalf("create billing rule: %v", errCreate)
	}

	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ginCtx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ginCtx.Set("accessMetadata", map[string]string{
		"user_id":               strconv.FormatUint(user.ID, 10),
		"billing_user_group_id": strconv.FormatUint(userGroup.ID, 10),
	})
	ctx := context.WithValue(context.Background(), "gin", ginCtx)

	plugin := NewGormUsagePlugin(conn)
	plugin.HandleUsage(ctx, coreusage.Record{
		Provider:    "kiro",
		Model:       "claude-sonnet-4.5",
		Alias:       "claude-sonnet-4.5-thinking-agentic",
		AuthID:      authRow.Key,
		RequestedAt: now,
		Detail: coreusage.Detail{
			InputTokens:  10,
			OutputTokens: 5,
		},
	})

	var row struct {
		CostMicros  int64         `gorm:"column:cost_micros"`
		UserGroupID sql.NullInt64 `gorm:"column:user_group_id"`
		AuthID      sql.NullInt64 `gorm:"column:auth_id"`
		Model       string        `gorm:"column:model"`
	}
	if errFind := conn.Table("usages").
		Select("cost_micros, user_group_id, auth_id, model").
		Order("id DESC").
		Take(&row).Error; errFind != nil {
		t.Fatalf("query usage row: %v", errFind)
	}

	if row.CostMicros != 2000 {
		t.Fatalf("cost_micros = %d, want 2000", row.CostMicros)
	}
	if !row.UserGroupID.Valid || uint64(row.UserGroupID.Int64) != userGroup.ID {
		t.Fatalf("user_group_id = %v, want %d", row.UserGroupID, userGroup.ID)
	}
	if !row.AuthID.Valid || uint64(row.AuthID.Int64) != authRow.ID {
		t.Fatalf("auth_id = %v, want %d", row.AuthID, authRow.ID)
	}
	if row.Model != "claude-sonnet-4.5-thinking-agentic" {
		t.Fatalf("model = %q", row.Model)
	}
}
