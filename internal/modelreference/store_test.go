package modelreference

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

func openModelReferenceStoreTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:model_reference_store_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if errMigrate := db.AutoMigrate(&models.ModelReference{}); errMigrate != nil {
		t.Fatalf("migrate: %v", errMigrate)
	}
	return db
}

func TestStoreReferences_UpsertAndDelete(t *testing.T) {
	db := openModelReferenceStoreTestDB(t)

	now := time.Now().UTC()
	refs := []models.ModelReference{
		{ProviderName: "Provider X", ModelName: "Model A", LastSeenAt: now},
		{ProviderName: "Provider X", ModelName: "Model B", LastSeenAt: now},
	}

	if errStore := StoreReferences(context.Background(), db, refs, now); errStore != nil {
		t.Fatalf("store: %v", errStore)
	}

	later := now.Add(1 * time.Minute)
	if errStore := StoreReferences(context.Background(), db, refs[:1], later); errStore != nil {
		t.Fatalf("store: %v", errStore)
	}

	var count int64
	if errCount := db.Model(&models.ModelReference{}).Count(&count).Error; errCount != nil {
		t.Fatalf("count: %v", errCount)
	}
	if count != 1 {
		t.Fatalf("expected 1 row after prune, got %d", count)
	}

	var row models.ModelReference
	if errFind := db.Where("provider_name = ? AND model_name = ?", "Provider X", "Model A").First(&row).Error; errFind != nil {
		t.Fatalf("find row: %v", errFind)
	}
	if !row.LastSeenAt.Equal(later) {
		t.Fatalf("expected last_seen_at to be updated")
	}
}

func TestStoreReferences_UpsertInBatches(t *testing.T) {
	db := openModelReferenceStoreTestDB(t)

	now := time.Now().UTC()
	refs := make([]models.ModelReference, 0, modelReferenceUpsertBatchSize*3)
	for i := 0; i < modelReferenceUpsertBatchSize*3; i++ {
		refs = append(refs, models.ModelReference{
			ProviderName: "Provider X",
			ModelName:    fmt.Sprintf("Model %d", i),
			ModelID:      fmt.Sprintf("model-%d", i),
			LastSeenAt:   now,
		})
	}

	if errStore := StoreReferences(context.Background(), db, refs, now); errStore != nil {
		t.Fatalf("store: %v", errStore)
	}

	var count int64
	if errCount := db.Model(&models.ModelReference{}).Count(&count).Error; errCount != nil {
		t.Fatalf("count: %v", errCount)
	}
	if count != int64(len(refs)) {
		t.Fatalf("expected %d rows after batch upsert, got %d", len(refs), count)
	}
}
