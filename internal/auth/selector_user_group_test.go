package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/modelmapping"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/datatypes"
)

func TestSelectorEnforcesModelMappingUserGroupRestriction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	now := time.Now().UTC()

	groupAllowed := models.UserGroup{Name: "allowed", CreatedAt: now, UpdatedAt: now}
	groupDenied := models.UserGroup{Name: "denied", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&groupAllowed).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}
	if errCreate := conn.Create(&groupDenied).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}

	user := models.User{
		Username:    "user1",
		Password:    "hashed",
		UserGroupID: models.UserGroupIDs{&groupAllowed.ID},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := conn.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	authGroup := models.AuthGroup{Name: "ag", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&authGroup).Error; errCreate != nil {
		t.Fatalf("create auth group: %v", errCreate)
	}
	authRecord := models.Auth{
		Key:         "auth-1",
		AuthGroupID: models.AuthGroupIDs{&authGroup.ID},
		Content:     datatypes.JSON([]byte(`{"type":"openai"}`)),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := conn.Create(&authRecord).Error; errCreate != nil {
		t.Fatalf("create auth record: %v", errCreate)
	}

	mapping := models.ModelMapping{
		Provider:     "openai",
		ModelName:    "gpt-4",
		NewModelName: "gpt-4",
		Selector:     0,
		RateLimit:    0,
		IsEnabled:    true,
		UserGroupID:  models.UserGroupIDs{&groupDenied.ID},
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if errCreate := conn.Create(&mapping).Error; errCreate != nil {
		t.Fatalf("create model mapping: %v", errCreate)
	}
	modelmapping.StoreModelMappings(now, []models.ModelMapping{mapping})

	selector := NewSelector(conn)
	selector.rateLimiter = nil
	selector.resolveRateLimit = nil

	ctx, ginCtx := buildTestGinContext("/v1/chat/completions", user.ID)
	auths := []*coreauth.Auth{{ID: authRecord.Key, Status: coreauth.StatusActive}}
	if _, errPick := selector.Pick(ctx, "openai", "gpt-4", cliproxyexecutor.Options{}, auths); errPick == nil {
		t.Fatalf("expected pick blocked by model mapping restriction, got nil")
	}

	_, _ = ginCtx, conn
}

func TestSelectorFiltersAuthsByAuthGroupUserGroupRestriction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	now := time.Now().UTC()

	group1 := models.UserGroup{Name: "g1", CreatedAt: now, UpdatedAt: now}
	group2 := models.UserGroup{Name: "g2", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&group1).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}
	if errCreate := conn.Create(&group2).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}

	user := models.User{
		Username:    "user1",
		Password:    "hashed",
		UserGroupID: models.UserGroupIDs{&group1.ID},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if errCreate := conn.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	agAllowed := models.AuthGroup{Name: "ag-allowed", UserGroupID: models.UserGroupIDs{&group1.ID}, CreatedAt: now, UpdatedAt: now}
	agDenied := models.AuthGroup{Name: "ag-denied", UserGroupID: models.UserGroupIDs{&group2.ID}, CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&agAllowed).Error; errCreate != nil {
		t.Fatalf("create auth group: %v", errCreate)
	}
	if errCreate := conn.Create(&agDenied).Error; errCreate != nil {
		t.Fatalf("create auth group: %v", errCreate)
	}

	authDenied := models.Auth{Key: "auth-denied", AuthGroupID: models.AuthGroupIDs{&agDenied.ID}, Content: datatypes.JSON([]byte(`{"type":"openai"}`)), CreatedAt: now, UpdatedAt: now}
	authAllowed := models.Auth{Key: "auth-allowed", AuthGroupID: models.AuthGroupIDs{&agAllowed.ID}, Content: datatypes.JSON([]byte(`{"type":"openai"}`)), CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&authDenied).Error; errCreate != nil {
		t.Fatalf("create auth record: %v", errCreate)
	}
	if errCreate := conn.Create(&authAllowed).Error; errCreate != nil {
		t.Fatalf("create auth record: %v", errCreate)
	}

	mapping := models.ModelMapping{
		Provider:     "openai",
		ModelName:    "gpt-4",
		NewModelName: "gpt-4",
		IsEnabled:    true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if errCreate := conn.Create(&mapping).Error; errCreate != nil {
		t.Fatalf("create model mapping: %v", errCreate)
	}
	modelmapping.StoreModelMappings(now, []models.ModelMapping{mapping})

	selector := NewSelector(conn)
	selector.rateLimiter = nil
	selector.resolveRateLimit = nil

	ctx, ginCtx := buildTestGinContext("/v1/chat/completions", user.ID)
	auths := []*coreauth.Auth{
		{ID: authDenied.Key, Status: coreauth.StatusActive},
		{ID: authAllowed.Key, Status: coreauth.StatusActive},
	}
	selected, errPick := selector.Pick(ctx, "openai", "gpt-4", cliproxyexecutor.Options{}, auths)
	if errPick != nil {
		t.Fatalf("expected pick ok, got %v", errPick)
	}
	if selected == nil || selected.ID != authAllowed.Key {
		t.Fatalf("expected auth %s selected, got %+v", authAllowed.Key, selected)
	}

	metaAny, exists := ginCtx.Get("accessMetadata")
	if !exists {
		t.Fatalf("expected accessMetadata to exist")
	}
	meta, ok := metaAny.(map[string]string)
	if !ok {
		t.Fatalf("expected accessMetadata map[string]string, got %T", metaAny)
	}
	if meta["billing_user_group_id"] != strconv.FormatUint(group1.ID, 10) {
		t.Fatalf("expected billing_user_group_id=%d, got %q", group1.ID, meta["billing_user_group_id"])
	}
}

func buildTestGinContext(path string, userID uint64) (context.Context, *gin.Context) {
	w := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(w)
	ginCtx.Request = httptest.NewRequest(http.MethodPost, path, nil)
	if userID != 0 {
		ginCtx.Set("accessMetadata", map[string]string{"user_id": strconv.FormatUint(userID, 10)})
	}
	return context.WithValue(context.Background(), "gin", ginCtx), ginCtx
}
