package modelreference

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"
	"gorm.io/gorm"
)

func TestSyncOnce_FetchesAndStores(t *testing.T) {
	// Disable default provider filters so the fake "Provider X" passes through.
	setModelReferenceSyncTestConfig(t, map[string]json.RawMessage{
		internalsettings.ModelReferenceSyncProviderAllowlistKey:          json.RawMessage(`""`),
		internalsettings.ModelReferenceSyncOnlyConfiguredProvidersKey: json.RawMessage(`false`),
	})

	payload := []byte(`{"provider-x":{"name":"Provider X","models":{"model-a":{"name":"Model A","cost":{"input":0.1},"limit":{"context":123,"output":456}}}}}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if errMigrate := db.AutoMigrate(&models.ModelReference{}); errMigrate != nil {
		t.Fatalf("migrate: %v", errMigrate)
	}

	now := time.Now().UTC().Truncate(time.Second)
	syncer := &Syncer{
		db:       db,
		url:      server.URL,
		interval: time.Minute,
		client:   server.Client(),
		now: func() time.Time {
			return now
		},
	}

	if errSync := syncer.SyncOnce(context.Background()); errSync != nil {
		t.Fatalf("sync once: %v", errSync)
	}

	var row models.ModelReference
	if errFind := db.Where("provider_name = ? AND model_name = ?", "Provider X", "Model A").First(&row).Error; errFind != nil {
		t.Fatalf("find row: %v", errFind)
	}
	if row.ContextLimit != 123 || row.OutputLimit != 456 {
		t.Fatalf("unexpected limits: context=%d output=%d", row.ContextLimit, row.OutputLimit)
	}
	if row.InputPrice == nil || *row.InputPrice != 0.1 {
		t.Fatalf("unexpected input price")
	}
	if !row.LastSeenAt.Equal(now) {
		t.Fatalf("expected last_seen_at to match sync time")
	}
}

func TestSyncOnce_AppliesProviderAllowlist(t *testing.T) {
	setModelReferenceSyncTestConfig(t, map[string]json.RawMessage{
		internalsettings.ModelReferenceSyncProviderAllowlistKey:          json.RawMessage(`"openai,anthropic"`),
		internalsettings.ModelReferenceSyncOnlyConfiguredProvidersKey: json.RawMessage(`false`),
	})

	payload := []byte(`{
		"openai":{"name":"OpenAI","models":{"gpt-4o":{"name":"GPT-4o"}}},
		"anthropic":{"name":"Anthropic","models":{"claude-3-7":{"name":"Claude 3.7"}}},
		"mistral":{"name":"Mistral","models":{"mistral-large":{"name":"Mistral Large"}}}
	}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if errMigrate := db.AutoMigrate(&models.ModelReference{}); errMigrate != nil {
		t.Fatalf("migrate: %v", errMigrate)
	}

	syncer := &Syncer{
		db:     db,
		url:    server.URL,
		client: server.Client(),
	}
	if errSync := syncer.SyncOnce(context.Background()); errSync != nil {
		t.Fatalf("sync once: %v", errSync)
	}

	var providers []string
	if errQuery := db.Model(&models.ModelReference{}).
		Distinct("provider_name").
		Order("provider_name ASC").
		Pluck("provider_name", &providers).Error; errQuery != nil {
		t.Fatalf("query providers: %v", errQuery)
	}

	if len(providers) != 2 {
		t.Fatalf("provider count = %d, want 2 (%v)", len(providers), providers)
	}
	if !slices.Equal(providers, []string{"Anthropic", "OpenAI"}) {
		t.Fatalf("providers = %v, want [Anthropic OpenAI]", providers)
	}
}

func TestSyncOnce_OnlyConfiguredProviders(t *testing.T) {
	setModelReferenceSyncTestConfig(t, map[string]json.RawMessage{
		internalsettings.ModelReferenceSyncOnlyConfiguredProvidersKey: json.RawMessage(`true`),
	})

	payload := []byte(`{
		"openai":{"name":"OpenAI","models":{"gpt-4o":{"name":"GPT-4o"}}},
		"anthropic":{"name":"Anthropic","models":{"claude-3-7":{"name":"Claude 3.7"}}}
	}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if errMigrate := db.AutoMigrate(&models.ModelReference{}, &models.ProviderAPIKey{}, &models.Auth{}); errMigrate != nil {
		t.Fatalf("migrate: %v", errMigrate)
	}
	if errCreate := db.Create(&models.ProviderAPIKey{
		Provider: "claude",
		Name:     "anthropic-key",
		APIKey:   "sk-test",
	}).Error; errCreate != nil {
		t.Fatalf("create provider key: %v", errCreate)
	}

	syncer := &Syncer{
		db:     db,
		url:    server.URL,
		client: server.Client(),
	}
	if errSync := syncer.SyncOnce(context.Background()); errSync != nil {
		t.Fatalf("sync once: %v", errSync)
	}

	var providers []string
	if errQuery := db.Model(&models.ModelReference{}).
		Distinct("provider_name").
		Order("provider_name ASC").
		Pluck("provider_name", &providers).Error; errQuery != nil {
		t.Fatalf("query providers: %v", errQuery)
	}

	if len(providers) != 1 || providers[0] != "Anthropic" {
		t.Fatalf("providers = %v, want [Anthropic]", providers)
	}
}

func setModelReferenceSyncTestConfig(t *testing.T, updates map[string]json.RawMessage) {
	t.Helper()

	previousUpdatedAt := internalsettings.DBConfigUpdatedAt()
	previousValues := make(map[string]json.RawMessage, len(updates))
	for key := range updates {
		if value, ok := internalsettings.DBConfigValue(key); ok {
			previousValues[key] = value
		}
	}

	internalsettings.StoreDBConfig(time.Now().UTC(), updates)
	t.Cleanup(func() {
		internalsettings.StoreDBConfig(previousUpdatedAt, previousValues)
	})
}
