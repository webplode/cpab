package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func openUsersTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:admin_users_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, errOpen := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	sqlDB, errDB := db.DB()
	if errDB != nil {
		t.Fatalf("db handle: %v", errDB)
	}
	sqlDB.SetMaxOpenConns(1)
	if errPragma := db.Exec("PRAGMA foreign_keys = ON").Error; errPragma != nil {
		t.Fatalf("enable foreign keys: %v", errPragma)
	}
	if errMigrate := db.AutoMigrate(
		&models.Plan{},
		&models.User{},
		&models.APIKey{},
		&models.Usage{},
		&models.Bill{},
		&models.PrepaidCard{},
		&models.UserModelAuthBinding{},
	); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}
	return db
}

func createUserDeletionFixture(t *testing.T, db *gorm.DB, username string) (models.User, models.APIKey) {
	t.Helper()

	now := time.Now().UTC()
	plan := models.Plan{
		Name:          "Plan " + username,
		SupportModels: datatypes.JSON([]byte("[]")),
		IsEnabled:     true,
	}
	if errCreate := db.Create(&plan).Error; errCreate != nil {
		t.Fatalf("create plan: %v", errCreate)
	}

	user := models.User{
		Username: username,
		Email:    username + "@example.com",
		Password: "hashed-password",
		Active:   true,
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	apiKey := models.APIKey{
		UserID: &user.ID,
		Name:   "Key " + username,
		APIKey: "sk-" + username,
		Active: true,
	}
	if errCreate := db.Create(&apiKey).Error; errCreate != nil {
		t.Fatalf("create api key: %v", errCreate)
	}

	if errCreate := db.Create(&models.Usage{
		Provider:    "openai",
		Model:       "gpt-test",
		UserID:      &user.ID,
		APIKeyID:    &apiKey.ID,
		RequestedAt: now,
	}).Error; errCreate != nil {
		t.Fatalf("create usage: %v", errCreate)
	}

	if errCreate := db.Create(&models.Bill{
		PlanID:      plan.ID,
		UserID:      user.ID,
		PeriodType:  models.BillPeriodTypeMonthly,
		PeriodStart: now.Add(-time.Hour),
		PeriodEnd:   now.Add(time.Hour),
		LeftQuota:   10,
		IsEnabled:   true,
		Status:      models.BillStatusPaid,
	}).Error; errCreate != nil {
		t.Fatalf("create bill: %v", errCreate)
	}

	if errCreate := db.Create(&models.PrepaidCard{
		Name:           "Card " + username,
		CardSN:         "card-" + username,
		Password:       "secret",
		Amount:         10,
		Balance:        5,
		IsEnabled:      true,
		RedeemedUserID: &user.ID,
		RedeemedAt:     &now,
	}).Error; errCreate != nil {
		t.Fatalf("create prepaid card: %v", errCreate)
	}

	if errCreate := db.Create(&models.UserModelAuthBinding{
		UserID:         user.ID,
		ModelMappingID: 1,
		AuthIndex:      "auth-1",
	}).Error; errCreate != nil {
		t.Fatalf("create user model auth binding: %v", errCreate)
	}

	return user, apiKey
}

func TestDeleteUserRemovesDependencies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openUsersTestDB(t)
	user, apiKey := createUserDeletionFixture(t, db, "delete-one")
	handler := NewUserHandler(db)

	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v0/admin/users/%d", user.ID), nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", user.ID)}}

	handler.Delete(ctx)
	if ctx.Writer.Status() != http.StatusNoContent {
		t.Fatalf("status = %d, want %d: %s", ctx.Writer.Status(), http.StatusNoContent, recorder.Body.String())
	}

	var deletedUser models.User
	if errFind := db.First(&deletedUser, user.ID).Error; !errors.Is(errFind, gorm.ErrRecordNotFound) {
		t.Fatalf("deleted user lookup error = %v, want record not found", errFind)
	}

	var keyCount int64
	if errCount := db.Model(&models.APIKey{}).Where("id = ?", apiKey.ID).Count(&keyCount).Error; errCount != nil {
		t.Fatalf("count api keys: %v", errCount)
	}
	if keyCount != 0 {
		t.Fatalf("api key count = %d, want 0", keyCount)
	}

	var billCount int64
	if errCount := db.Model(&models.Bill{}).Where("user_id = ?", user.ID).Count(&billCount).Error; errCount != nil {
		t.Fatalf("count bills: %v", errCount)
	}
	if billCount != 0 {
		t.Fatalf("bill count = %d, want 0", billCount)
	}

	var bindingCount int64
	if errCount := db.Model(&models.UserModelAuthBinding{}).Where("user_id = ?", user.ID).Count(&bindingCount).Error; errCount != nil {
		t.Fatalf("count bindings: %v", errCount)
	}
	if bindingCount != 0 {
		t.Fatalf("binding count = %d, want 0", bindingCount)
	}

	var usage models.Usage
	if errFind := db.First(&usage).Error; errFind != nil {
		t.Fatalf("find usage: %v", errFind)
	}
	if usage.UserID != nil {
		t.Fatalf("usage user_id = %v, want nil", *usage.UserID)
	}
	if usage.APIKeyID != nil {
		t.Fatalf("usage api_key_id = %v, want nil", *usage.APIKeyID)
	}

	var card models.PrepaidCard
	if errFind := db.First(&card).Error; errFind != nil {
		t.Fatalf("find prepaid card: %v", errFind)
	}
	if card.RedeemedUserID != nil {
		t.Fatalf("prepaid redeemed_user_id = %v, want nil", *card.RedeemedUserID)
	}
	if card.RedeemedAt == nil {
		t.Fatal("prepaid redeemed_at was cleared; want audit timestamp retained")
	}
}

func TestBatchDeleteUsersReportsMissingIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openUsersTestDB(t)
	userA, apiKeyA := createUserDeletionFixture(t, db, "batch-a")
	userB, apiKeyB := createUserDeletionFixture(t, db, "batch-b")
	handler := NewUserHandler(db)

	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/admin/users/batch-delete",
		strings.NewReader(fmt.Sprintf(`{"ids":[%d,%d,999999]}`, userA.ID, userB.ID)),
	)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler.BatchDelete(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response struct {
		Deleted    int64    `json:"deleted"`
		MissingIDs []uint64 `json:"missing_ids"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if response.Deleted != 2 {
		t.Fatalf("deleted = %d, want 2", response.Deleted)
	}
	if len(response.MissingIDs) != 1 || response.MissingIDs[0] != 999999 {
		t.Fatalf("missing_ids = %v, want [999999]", response.MissingIDs)
	}

	var userCount int64
	if errCount := db.Model(&models.User{}).Where("id IN ?", []uint64{userA.ID, userB.ID}).Count(&userCount).Error; errCount != nil {
		t.Fatalf("count users: %v", errCount)
	}
	if userCount != 0 {
		t.Fatalf("user count = %d, want 0", userCount)
	}

	var keyCount int64
	if errCount := db.Model(&models.APIKey{}).Where("id IN ?", []uint64{apiKeyA.ID, apiKeyB.ID}).Count(&keyCount).Error; errCount != nil {
		t.Fatalf("count api keys: %v", errCount)
	}
	if keyCount != 0 {
		t.Fatalf("api key count = %d, want 0", keyCount)
	}
}
