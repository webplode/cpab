package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/security"
)

func TestCreateAdminUserWithConn_SetsSuperAdmin(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "cpab-test.db")
	conn, err := db.Open(dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate: %v", errMigrate)
	}

	if errCreate := CreateAdminUserWithConn(conn, "admin", "password1", "CLIProxyAPI"); errCreate != nil {
		t.Fatalf("CreateAdminUserWithConn: %v", errCreate)
	}

	var admin models.Admin
	if errFind := conn.First(&admin).Error; errFind != nil {
		t.Fatalf("find admin: %v", errFind)
	}
	if !admin.IsSuperAdmin {
		t.Fatalf("expected first admin to be super admin")
	}
}

func TestCreateAdminUserWithConn_RejectsWeakPassword(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "cpab-test.db")
	conn, err := db.Open(dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if errMigrate := db.Migrate(conn); errMigrate != nil {
		t.Fatalf("migrate: %v", errMigrate)
	}

	err = CreateAdminUserWithConn(conn, "admin", "password", "CLIProxyAPI")
	wantErr := security.ValidatePassword("password")
	if err == nil {
		t.Fatal("CreateAdminUserWithConn() error = nil, want password validation error")
	}
	if err.Error() != wantErr.Error() {
		t.Fatalf("CreateAdminUserWithConn() error = %q, want %q", err.Error(), wantErr.Error())
	}

	var count int64
	if errCount := conn.Model(&models.Admin{}).Count(&count).Error; errCount != nil {
		t.Fatalf("count admins: %v", errCount)
	}
	if count != 0 {
		t.Fatalf("admin count = %d, want 0", count)
	}
}

func TestWriteConfigFile_FailsWhenJWTSecretGenerationFails(t *testing.T) {
	originalGenerateRandomString := generateRandomString
	t.Cleanup(func() {
		generateRandomString = originalGenerateRandomString
	})
	generateRandomString = func(int) (string, error) {
		return "", errors.New("entropy unavailable")
	}

	configPath := filepath.Join(t.TempDir(), "config.yaml")
	err := WriteConfigFile(configPath, "postgres://cpab:pass@localhost:5432/cpab?sslmode=require", 8318)
	if err == nil {
		t.Fatal("expected error")
	}

	if _, errStat := os.Stat(configPath); !errors.Is(errStat, os.ErrNotExist) {
		t.Fatalf("expected config file to be absent, got stat err=%v", errStat)
	}
}

func TestEnsureJWTConfig_GeneratesSecretWhenMissing(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	configPath := filepath.Join(t.TempDir(), "config.yaml")

	cfg, err := EnsureJWTConfig(configPath)
	if err != nil {
		t.Fatalf("EnsureJWTConfig: %v", err)
	}
	if len(cfg.Secret) < 32 {
		t.Fatalf("expected secret >= 32 chars, got %d", len(cfg.Secret))
	}
	if cfg.Expiry <= 0 {
		t.Fatalf("expected positive expiry, got %s", cfg.Expiry)
	}

	// Config file should now exist with the secret
	if _, errStat := os.Stat(configPath); errStat != nil {
		t.Fatalf("expected config file to exist: %v", errStat)
	}

	// Second call should return the same secret (loaded from file)
	cfg2, err := EnsureJWTConfig(configPath)
	if err != nil {
		t.Fatalf("second EnsureJWTConfig: %v", err)
	}
	if cfg2.Secret != cfg.Secret {
		t.Fatalf("expected same secret on reload, got %q vs %q", cfg.Secret, cfg2.Secret)
	}
}

func TestEnsureJWTConfig_PreservesExistingConfig(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	configPath := filepath.Join(t.TempDir(), "config.yaml")

	// Write a config with DSN but no JWT section
	existing := "host: \"\"\nport: 8318\ndatabase-dsn: postgres://localhost/test\n"
	if err := os.WriteFile(configPath, []byte(existing), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := EnsureJWTConfig(configPath)
	if err != nil {
		t.Fatalf("EnsureJWTConfig: %v", err)
	}
	if len(cfg.Secret) < 32 {
		t.Fatalf("expected secret >= 32 chars, got %d", len(cfg.Secret))
	}

	// Verify existing fields are preserved
	data, errRead := os.ReadFile(configPath)
	if errRead != nil {
		t.Fatalf("read config: %v", errRead)
	}
	content := string(data)
	if !strings.Contains(content, "database-dsn") {
		t.Fatalf("expected database-dsn to be preserved, got:\n%s", content)
	}
	if !strings.Contains(content, "port") {
		t.Fatalf("expected port to be preserved, got:\n%s", content)
	}
}

func TestEnsureJWTConfig_UsesExistingValidSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	configPath := filepath.Join(t.TempDir(), "config.yaml")

	knownSecret := "abcdef0123456789abcdef0123456789"
	content := "jwt:\n  secret: " + knownSecret + "\n  expiry: 1h\n"
	if err := os.WriteFile(configPath, []byte(content), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := EnsureJWTConfig(configPath)
	if err != nil {
		t.Fatalf("EnsureJWTConfig: %v", err)
	}
	if cfg.Secret != knownSecret {
		t.Fatalf("expected existing secret %q, got %q", knownSecret, cfg.Secret)
	}
}

func TestEnsureJWTConfig_FailsWhenGenerationFails(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	originalGenerateRandomString := generateRandomString
	t.Cleanup(func() {
		generateRandomString = originalGenerateRandomString
	})
	generateRandomString = func(int) (string, error) {
		return "", errors.New("entropy unavailable")
	}

	configPath := filepath.Join(t.TempDir(), "config.yaml")
	_, err := EnsureJWTConfig(configPath)
	if err == nil {
		t.Fatal("expected error when secret generation fails")
	}
}
