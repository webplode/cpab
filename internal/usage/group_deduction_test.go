package usage

import (
	"context"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

func TestDeductBillBalanceRespectsUserGroupID(t *testing.T) {
	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	now := time.Now().UTC()
	ctx := context.Background()

	group1 := models.UserGroup{Name: "g1", CreatedAt: now, UpdatedAt: now}
	group2 := models.UserGroup{Name: "g2", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&group1).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}
	if errCreate := conn.Create(&group2).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}

	plan := models.Plan{Name: "p1", MonthPrice: 1, IsEnabled: true, CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&plan).Error; errCreate != nil {
		t.Fatalf("create plan: %v", errCreate)
	}
	user := models.User{Username: "u1", Password: "x", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	periodStart := now.Add(-time.Hour)
	periodEnd := now.Add(time.Hour)

	bill1 := models.Bill{
		PlanID:      plan.ID,
		UserID:      user.ID,
		UserGroupID: models.UserGroupIDs{&group1.ID},
		PeriodType:  models.BillPeriodTypeMonthly,
		PeriodStart: periodStart,
		PeriodEnd:   periodEnd,
		TotalQuota:  10,
		LeftQuota:   10,
		DailyQuota:  0,
		IsEnabled:   true,
		Status:      models.BillStatusPaid,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	bill2 := bill1
	bill2.UserGroupID = models.UserGroupIDs{&group2.ID}
	if errCreate := conn.Create(&bill1).Error; errCreate != nil {
		t.Fatalf("create bill1: %v", errCreate)
	}
	if errCreate := conn.Create(&bill2).Error; errCreate != nil {
		t.Fatalf("create bill2: %v", errCreate)
	}

	amount := 5.0
	costMicros := int64(amount * 1_000_000)
	if errTx := conn.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		deducted, errDeduct := deductBillBalance(ctx, tx, user.ID, &group1.ID, amount, costMicros)
		if errDeduct != nil {
			return errDeduct
		}
		if !deducted {
			t.Fatalf("expected deducted=true")
		}
		return nil
	}); errTx != nil {
		t.Fatalf("transaction: %v", errTx)
	}

	var updated1 models.Bill
	var updated2 models.Bill
	if errFind := conn.First(&updated1, bill1.ID).Error; errFind != nil {
		t.Fatalf("load bill1: %v", errFind)
	}
	if errFind := conn.First(&updated2, bill2.ID).Error; errFind != nil {
		t.Fatalf("load bill2: %v", errFind)
	}
	if updated1.LeftQuota != 5 {
		t.Fatalf("expected bill1 left_quota=5, got %v", updated1.LeftQuota)
	}
	if updated2.LeftQuota != 10 {
		t.Fatalf("expected bill2 left_quota=10, got %v", updated2.LeftQuota)
	}
}

func TestDeductPrepaidBalanceRespectsUserGroupID(t *testing.T) {
	conn, errOpen := db.Open(":memory:")
	if errOpen != nil {
		t.Fatalf("open db: %v", errOpen)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate db: %v", errMigrate)
	}

	now := time.Now().UTC()
	ctx := context.Background()

	group1 := models.UserGroup{Name: "g1", CreatedAt: now, UpdatedAt: now}
	group2 := models.UserGroup{Name: "g2", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&group1).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}
	if errCreate := conn.Create(&group2).Error; errCreate != nil {
		t.Fatalf("create user group: %v", errCreate)
	}

	user := models.User{Username: "u1", Password: "x", CreatedAt: now, UpdatedAt: now}
	if errCreate := conn.Create(&user).Error; errCreate != nil {
		t.Fatalf("create user: %v", errCreate)
	}

	redeemedAt := now.Add(-time.Minute)
	card1 := models.PrepaidCard{
		Name:           "c1",
		CardSN:         "sn1",
		Password:       "p1",
		Amount:         10,
		Balance:        10,
		IsEnabled:      true,
		RedeemedUserID: &user.ID,
		RedeemedAt:     &redeemedAt,
		UserGroupID:    &group1.ID,
		CreatedAt:      now,
	}
	card2 := card1
	card2.CardSN = "sn2"
	card2.Password = "p2"
	card2.UserGroupID = &group2.ID
	if errCreate := conn.Create(&card1).Error; errCreate != nil {
		t.Fatalf("create card1: %v", errCreate)
	}
	if errCreate := conn.Create(&card2).Error; errCreate != nil {
		t.Fatalf("create card2: %v", errCreate)
	}

	if errTx := conn.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return deductPrepaidBalance(ctx, tx, user.ID, &group1.ID, 5)
	}); errTx != nil {
		t.Fatalf("transaction: %v", errTx)
	}

	var updated1 models.PrepaidCard
	var updated2 models.PrepaidCard
	if errFind := conn.First(&updated1, card1.ID).Error; errFind != nil {
		t.Fatalf("load card1: %v", errFind)
	}
	if errFind := conn.First(&updated2, card2.ID).Error; errFind != nil {
		t.Fatalf("load card2: %v", errFind)
	}
	if updated1.Balance != 5 {
		t.Fatalf("expected card1 balance=5, got %v", updated1.Balance)
	}
	if updated2.Balance != 10 {
		t.Fatalf("expected card2 balance=10, got %v", updated2.Balance)
	}
}
