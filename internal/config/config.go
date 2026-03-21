package config

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	EnvConfigPath   = "CONFIG_PATH"
	EnvDBConnection = "DB_CONNECTION"
	EnvCORSOrigins  = "CORS_ORIGINS"
	EnvJWTSecret    = "JWT_SECRET"
	EnvJWTExpiry    = "JWT_EXPIRY"
)

// AppConfig holds resolved application configuration values.
type AppConfig struct {
	ConfigPath  string
	CORSOrigins []string
}

// LoadFromEnv loads app config from environment variables.
func LoadFromEnv() (AppConfig, error) {
	return AppConfig{
		ConfigPath:  ResolveConfigPath(os.Getenv(EnvConfigPath)),
		CORSOrigins: splitAndTrimCSV(os.Getenv(EnvCORSOrigins)),
	}, nil
}

// ResolveConfigPath normalizes the config path and applies defaults.
func ResolveConfigPath(p string) string {
	trimmed := strings.TrimSpace(p)
	if trimmed == "" {
		trimmed = "./config.yaml"
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		return abs
	}
	return trimmed
}

// ErrMissingDatabaseDSN indicates no database DSN is present in the config file.
var ErrMissingDatabaseDSN = errors.New("missing database dsn (set `database-dsn` or `database.dsn` in config file)")

// JWTConfig holds JWT secret and expiry settings.
type JWTConfig struct {
	Secret string        `yaml:"secret"`
	Expiry time.Duration `yaml:"expiry"`
}

// LoadCORSOrigins loads allowed CORS origins from config, with env override precedence.
func LoadCORSOrigins(configPath string, envOverride []string) ([]string, error) {
	if len(envOverride) > 0 {
		return envOverride, nil
	}

	type fileConfig struct {
		CORSOrigins []string `yaml:"cors_origins"`
	}

	data, errRead := os.ReadFile(configPath)
	if errRead != nil {
		if errors.Is(errRead, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read config file: %w", errRead)
	}

	var cfg fileConfig
	if errUnmarshal := yaml.Unmarshal(data, &cfg); errUnmarshal != nil {
		return nil, fmt.Errorf("parse config file: %w", errUnmarshal)
	}
	return normalizeOrigins(cfg.CORSOrigins), nil
}

// LoadDatabaseDSN reads the database DSN from the YAML config file.
func LoadDatabaseDSN(configPath string) (string, error) {
	if dsn := strings.TrimSpace(os.Getenv(EnvDBConnection)); dsn != "" {
		return dsn, nil
	}

	// fileConfig maps the YAML fields needed for DSN resolution.
	type fileConfig struct {
		DatabaseDSN string `yaml:"database-dsn"`
		Database    struct {
			DSN string `yaml:"dsn"`
		} `yaml:"database"`
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("read config file: %w", err)
	}

	var cfg fileConfig
	if errUnmarshal := yaml.Unmarshal(data, &cfg); errUnmarshal != nil {
		return "", fmt.Errorf("parse config file: %w", errUnmarshal)
	}

	if dsn := strings.TrimSpace(cfg.DatabaseDSN); dsn != "" {
		return dsn, nil
	}
	if dsn := strings.TrimSpace(cfg.Database.DSN); dsn != "" {
		return dsn, nil
	}
	return "", ErrMissingDatabaseDSN
}

// defaultJWTExpiry is used when the config omits or invalidates JWT expiry.
const defaultJWTExpiry = 30 * 24 * time.Hour

var weakJWTSecrets = map[string]struct{}{
	"":                                    {},
	"change-me-to-a-secure-random-string": {},
	"insecure-jwt-secret-change-me":       {},
	"secret":                              {},
	"jwt-secret":                          {},
}

// LoadJWTConfig loads JWT settings from the YAML config file.
func LoadJWTConfig(configPath string) (JWTConfig, error) {
	// fileConfig maps the YAML fields needed for JWT settings.
	type fileConfig struct {
		JWT JWTConfig `yaml:"jwt"`
	}

	result := JWTConfig{Expiry: defaultJWTExpiry}

	data, errRead := os.ReadFile(configPath)
	if errRead == nil {
		var cfg fileConfig
		if errUnmarshal := yaml.Unmarshal(data, &cfg); errUnmarshal == nil {
			result = cfg.JWT
		}
	}

	if secret := strings.TrimSpace(os.Getenv(EnvJWTSecret)); secret != "" {
		result.Secret = secret
	}
	if expiryRaw := strings.TrimSpace(os.Getenv(EnvJWTExpiry)); expiryRaw != "" {
		if expiry, errParse := time.ParseDuration(expiryRaw); errParse == nil && expiry > 0 {
			result.Expiry = expiry
		}
	}

	if result.Expiry <= 0 {
		result.Expiry = defaultJWTExpiry
	}
	if errValidate := validateJWTSecret(result.Secret); errValidate != nil {
		return JWTConfig{}, errValidate
	}
	return result, nil
}

func validateJWTSecret(secret string) error {
	trimmed := strings.TrimSpace(secret)
	if _, ok := weakJWTSecrets[trimmed]; ok {
		return fmt.Errorf(
			"FATAL: JWT_SECRET is weak or unset. Set a strong random value (min 32 chars).\n" +
				"Generate one with: openssl rand -hex 32\n" +
				"Set via environment: JWT_SECRET=<value> or in config.yaml: jwt.secret: <value>",
		)
	}
	if len(trimmed) < 32 {
		log.Printf("WARNING: JWT_SECRET is shorter than the recommended 32 characters")
	}
	return nil
}

func splitAndTrimCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return normalizeOrigins(strings.Split(raw, ","))
}

func normalizeOrigins(origins []string) []string {
	if len(origins) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(origins))
	seen := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		trimmed := strings.TrimSpace(origin)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}
