package ratelimit

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"
)

func TestManagerAllowWindowBlocksWithinMinuteWindow(t *testing.T) {
	now := time.Date(2025, 1, 1, 12, 0, 5, 0, time.UTC)
	manager := NewManager(func() SettingsConfig {
		return SettingsConfig{}
	}, func() time.Time {
		return now
	}, nil)

	first, errAllow := manager.AllowWindow(context.Background(), "auth:127.0.0.1", 1, time.Minute)
	if errAllow != nil {
		t.Fatalf("expected nil err, got %v", errAllow)
	}
	if !first.Allowed {
		t.Fatalf("expected first request to be allowed")
	}

	second, errAllow := manager.AllowWindow(context.Background(), "auth:127.0.0.1", 1, time.Minute)
	if errAllow != nil {
		t.Fatalf("expected nil err, got %v", errAllow)
	}
	if second.Allowed {
		t.Fatalf("expected second request to be blocked")
	}
	expectedReset := time.Date(2025, 1, 1, 12, 1, 0, 0, time.UTC)
	if !second.Reset.Equal(expectedReset) {
		t.Fatalf("expected reset at %s, got %s", expectedReset, second.Reset)
	}
}

func TestManagerAllowAuthUsesConfiguredAuthLimit(t *testing.T) {
	now := time.Date(2025, 1, 1, 12, 0, 5, 0, time.UTC)
	manager := NewManager(func() SettingsConfig {
		return SettingsConfig{AuthLimit: 1}
	}, func() time.Time {
		return now
	}, nil)

	if _, errAllow := manager.AllowAuth(context.Background(), "auth:127.0.0.1"); errAllow != nil {
		t.Fatalf("expected nil err, got %v", errAllow)
	}
	result, errAllow := manager.AllowAuth(context.Background(), "auth:127.0.0.1")
	if errAllow != nil {
		t.Fatalf("expected nil err, got %v", errAllow)
	}
	if result.Allowed {
		t.Fatalf("expected auth limiter to block after configured limit")
	}
}

func TestLoadSettingsConfigReadsAuthRateLimit(t *testing.T) {
	previousUpdatedAt := internalsettings.DBConfigUpdatedAt()
	previousValue, hadPrevious := internalsettings.DBConfigValue(internalsettings.AuthRateLimitKey)
	defer func() {
		values := map[string]json.RawMessage{}
		if hadPrevious {
			values[internalsettings.AuthRateLimitKey] = previousValue
		}
		internalsettings.StoreDBConfig(previousUpdatedAt, values)
	}()

	internalsettings.StoreDBConfig(time.Now().UTC(), map[string]json.RawMessage{
		internalsettings.AuthRateLimitKey: json.RawMessage("7"),
	})

	cfg := LoadSettingsConfig()
	if cfg.AuthLimit != 7 {
		t.Fatalf("expected auth limit 7, got %d", cfg.AuthLimit)
	}
}
