package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDatabaseDSN_EnvOverride(t *testing.T) {
	t.Setenv("DB_CONNECTION", "postgres://cpab:pass@localhost:5432/cpab?sslmode=disable")

	missingPath := filepath.Join(t.TempDir(), "missing.yaml")
	dsn, err := LoadDatabaseDSN(missingPath)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if dsn != os.Getenv("DB_CONNECTION") {
		t.Fatalf("expected dsn=%q, got %q", os.Getenv("DB_CONNECTION"), dsn)
	}
}

func TestLoadJWTConfig_EnvOverride(t *testing.T) {
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("JWT_EXPIRY", "2h")

	configPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(configPath, []byte("jwt:\n  secret: abcdef0123456789abcdef0123456789\n  expiry: 1h\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := LoadJWTConfig(configPath)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.Secret != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("expected secret=%q, got %q", "0123456789abcdef0123456789abcdef", cfg.Secret)
	}
	if cfg.Expiry != 2*time.Hour {
		t.Fatalf("expected expiry=%s, got %s", (2 * time.Hour).String(), cfg.Expiry.String())
	}
}

func TestLoadJWTConfig_RejectsWeakSecrets(t *testing.T) {
	testCases := []struct {
		name      string
		envSecret string
		fileBody  string
	}{
		{
			name:      "empty secret",
			envSecret: "",
			fileBody:  "jwt:\n  secret: \"\"\n  expiry: 1h\n",
		},
		{
			name:      "known weak env secret",
			envSecret: "insecure-jwt-secret-change-me",
			fileBody:  "jwt:\n  secret: file-secret\n  expiry: 1h\n",
		},
		{
			name:      "known weak file secret",
			envSecret: "",
			fileBody:  "jwt:\n  secret: jwt-secret\n  expiry: 1h\n",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("JWT_SECRET", tc.envSecret)
			configPath := filepath.Join(t.TempDir(), "config.yaml")
			if err := os.WriteFile(configPath, []byte(tc.fileBody), 0600); err != nil {
				t.Fatalf("write config: %v", err)
			}

			_, err := LoadJWTConfig(configPath)
			if err == nil {
				t.Fatal("expected weak JWT secret error")
			}
		})
	}
}

func TestLoadFromEnv_CORSOrigins(t *testing.T) {
	t.Setenv("CONFIG_PATH", "./custom.yaml")
	t.Setenv("CORS_ORIGINS", " https://admin.example.com,https://portal.example.com ,https://admin.example.com ")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv: %v", err)
	}
	if got, want := len(cfg.CORSOrigins), 2; got != want {
		t.Fatalf("expected %d origins, got %d", want, got)
	}
	if cfg.CORSOrigins[0] != "https://admin.example.com" {
		t.Fatalf("unexpected first origin: %q", cfg.CORSOrigins[0])
	}
	if cfg.CORSOrigins[1] != "https://portal.example.com" {
		t.Fatalf("unexpected second origin: %q", cfg.CORSOrigins[1])
	}
}

func TestLoadCORSOrigins(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(configPath, []byte("cors_origins:\n  - https://admin.example.com\n  - https://portal.example.com\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	origins, err := LoadCORSOrigins(configPath, nil)
	if err != nil {
		t.Fatalf("LoadCORSOrigins: %v", err)
	}
	if got, want := len(origins), 2; got != want {
		t.Fatalf("expected %d origins, got %d", want, got)
	}
	if origins[0] != "https://admin.example.com" || origins[1] != "https://portal.example.com" {
		t.Fatalf("unexpected origins: %#v", origins)
	}
}

func TestLoadCORSOrigins_EnvOverrideWins(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(configPath, []byte("cors_origins:\n  - https://admin.example.com\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	origins, err := LoadCORSOrigins(configPath, []string{"https://override.example.com"})
	if err != nil {
		t.Fatalf("LoadCORSOrigins: %v", err)
	}
	if got, want := len(origins), 1; got != want {
		t.Fatalf("expected %d origin, got %d", want, got)
	}
	if origins[0] != "https://override.example.com" {
		t.Fatalf("unexpected origin: %q", origins[0])
	}
}
