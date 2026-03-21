package app

import (
	"errors"
	"os"
	"path/filepath"
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
