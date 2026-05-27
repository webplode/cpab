package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	dbutil "github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	migrationAppName       = "CLIProxyAPIBusiness"
	migrationSchemaVersion = 1
	migrationBatchSize     = 100
)

// MigrationHandler manages full-state export/import operations for migrations.
type MigrationHandler struct {
	db *gorm.DB
}

// NewMigrationHandler constructs a MigrationHandler.
func NewMigrationHandler(db *gorm.DB) *MigrationHandler {
	return &MigrationHandler{db: db}
}

// migrationBundle is the versioned JSON document used by the migration API.
type migrationBundle struct {
	App        string         `json:"app"`
	Version    int            `json:"version"`
	ExportedAt time.Time      `json:"exported_at"`
	Counts     map[string]int `json:"counts"`
	Data       migrationData  `json:"data"`
}

type migrationData struct {
	Admins                []models.Admin                `json:"admins"`
	UserGroups            []models.UserGroup            `json:"user_groups"`
	AuthGroups            []models.AuthGroup            `json:"auth_groups"`
	Plans                 []models.Plan                 `json:"plans"`
	Users                 []models.User                 `json:"users"`
	Auths                 []models.Auth                 `json:"auths"`
	ProviderAPIKeys       []models.ProviderAPIKey       `json:"provider_api_keys"`
	Proxies               []models.Proxy                `json:"proxies"`
	ModelMappings         []models.ModelMapping         `json:"model_mappings"`
	ModelReferences       []models.ModelReference       `json:"model_references"`
	ModelPayloadRules     []models.ModelPayloadRule     `json:"model_payload_rules"`
	UserModelAuthBindings []models.UserModelAuthBinding `json:"user_model_auth_bindings"`
	APIKeys               []models.APIKey               `json:"api_keys"`
	Bills                 []models.Bill                 `json:"bills"`
	BillingRules          []models.BillingRule          `json:"billing_rules"`
	PrepaidCards          []models.PrepaidCard          `json:"prepaid_cards"`
	Quotas                []models.Quota                `json:"quotas"`
	Usages                []models.Usage                `json:"usages"`
	Settings              []models.Setting              `json:"settings"`
}

type migrationExportOptions struct {
	IncludeUsage bool
}

type migrationImportResponse struct {
	Version  int            `json:"version"`
	Imported map[string]int `json:"imported"`
}

// Export downloads a versioned JSON bundle of CPAB database state.
func (h *MigrationHandler) Export(c *gin.Context) {
	if h == nil || h.db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "migration handler not configured"})
		return
	}

	bundle, errExport := h.exportBundle(c.Request.Context(), migrationExportOptions{
		IncludeUsage: parseMigrationBoolQuery(c, "include_usage", true),
	})
	if errExport != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "export migration data failed"})
		return
	}

	data, errMarshal := json.MarshalIndent(bundle, "", "  ")
	if errMarshal != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal migration export failed"})
		return
	}

	fileName := fmt.Sprintf("cpab-migration-%s.json", time.Now().UTC().Format("20060102T150405Z"))
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}

// Import upserts a previously exported migration bundle.
func (h *MigrationHandler) Import(c *gin.Context) {
	if h == nil || h.db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "migration handler not configured"})
		return
	}

	var bundle migrationBundle
	if errBind := c.ShouldBindJSON(&bundle); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid migration json"})
		return
	}
	if bundle.Version != migrationSchemaVersion {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unsupported migration version: %d", bundle.Version)})
		return
	}
	if app := strings.TrimSpace(bundle.App); app != "" && app != migrationAppName {
		c.JSON(http.StatusBadRequest, gin.H{"error": "migration bundle is for a different application"})
		return
	}

	imported, errImport := h.importBundle(c.Request.Context(), &bundle)
	if errImport != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": errImport.Error()})
		return
	}

	if len(bundle.Data.Settings) > 0 {
		if errRefresh := NewSettingHandler(h.db).refreshDBConfigSnapshot(c.Request.Context()); errRefresh != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "refresh settings snapshot failed"})
			return
		}
	}

	c.JSON(http.StatusOK, migrationImportResponse{
		Version:  migrationSchemaVersion,
		Imported: imported,
	})
}

func (h *MigrationHandler) exportBundle(ctx context.Context, opts migrationExportOptions) (*migrationBundle, error) {
	data := migrationData{}
	db := h.db.WithContext(ctx)

	if err := db.Order("id ASC").Find(&data.Admins).Error; err != nil {
		return nil, fmt.Errorf("export admins: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.UserGroups).Error; err != nil {
		return nil, fmt.Errorf("export user groups: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.AuthGroups).Error; err != nil {
		return nil, fmt.Errorf("export auth groups: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.Plans).Error; err != nil {
		return nil, fmt.Errorf("export plans: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.Users).Error; err != nil {
		return nil, fmt.Errorf("export users: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.Auths).Error; err != nil {
		return nil, fmt.Errorf("export auths: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.ProviderAPIKeys).Error; err != nil {
		return nil, fmt.Errorf("export provider api keys: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.Proxies).Error; err != nil {
		return nil, fmt.Errorf("export proxies: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.ModelMappings).Error; err != nil {
		return nil, fmt.Errorf("export model mappings: %w", err)
	}
	if err := db.Order("provider_name ASC, model_name ASC").Find(&data.ModelReferences).Error; err != nil {
		return nil, fmt.Errorf("export model references: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.ModelPayloadRules).Error; err != nil {
		return nil, fmt.Errorf("export model payload rules: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.UserModelAuthBindings).Error; err != nil {
		return nil, fmt.Errorf("export user model auth bindings: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.APIKeys).Error; err != nil {
		return nil, fmt.Errorf("export api keys: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.Bills).Error; err != nil {
		return nil, fmt.Errorf("export bills: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.BillingRules).Error; err != nil {
		return nil, fmt.Errorf("export billing rules: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.PrepaidCards).Error; err != nil {
		return nil, fmt.Errorf("export prepaid cards: %w", err)
	}
	if err := db.Order("id ASC").Find(&data.Quotas).Error; err != nil {
		return nil, fmt.Errorf("export quotas: %w", err)
	}
	if opts.IncludeUsage {
		if err := db.Order("id ASC").Find(&data.Usages).Error; err != nil {
			return nil, fmt.Errorf("export usages: %w", err)
		}
	}
	if err := db.Order("key ASC").Find(&data.Settings).Error; err != nil {
		return nil, fmt.Errorf("export settings: %w", err)
	}

	return &migrationBundle{
		App:        migrationAppName,
		Version:    migrationSchemaVersion,
		ExportedAt: time.Now().UTC(),
		Counts:     migrationCounts(data),
		Data:       data,
	}, nil
}

func (h *MigrationHandler) importBundle(ctx context.Context, bundle *migrationBundle) (map[string]int, error) {
	imported := make(map[string]int)
	errTx := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		if imported["admins"], err = upsertMigrationRows(tx, bundle.Data.Admins, "id"); err != nil {
			return fmt.Errorf("import admins: %w", err)
		}
		if imported["user_groups"], err = upsertMigrationRows(tx, bundle.Data.UserGroups, "id"); err != nil {
			return fmt.Errorf("import user groups: %w", err)
		}
		if imported["auth_groups"], err = upsertMigrationRows(tx, bundle.Data.AuthGroups, "id"); err != nil {
			return fmt.Errorf("import auth groups: %w", err)
		}
		if imported["plans"], err = upsertMigrationRows(tx, bundle.Data.Plans, "id"); err != nil {
			return fmt.Errorf("import plans: %w", err)
		}
		if imported["users"], err = upsertMigrationRows(tx, bundle.Data.Users, "id"); err != nil {
			return fmt.Errorf("import users: %w", err)
		}
		if imported["auths"], err = upsertMigrationRows(tx, bundle.Data.Auths, "id"); err != nil {
			return fmt.Errorf("import auths: %w", err)
		}
		if imported["provider_api_keys"], err = upsertMigrationRows(tx, bundle.Data.ProviderAPIKeys, "id"); err != nil {
			return fmt.Errorf("import provider api keys: %w", err)
		}
		if imported["proxies"], err = upsertMigrationRows(tx, bundle.Data.Proxies, "id"); err != nil {
			return fmt.Errorf("import proxies: %w", err)
		}
		if imported["model_mappings"], err = upsertMigrationRows(tx, bundle.Data.ModelMappings, "id"); err != nil {
			return fmt.Errorf("import model mappings: %w", err)
		}
		if imported["model_references"], err = upsertMigrationRows(tx, bundle.Data.ModelReferences, "provider_name", "model_name"); err != nil {
			return fmt.Errorf("import model references: %w", err)
		}
		if imported["model_payload_rules"], err = upsertMigrationRows(tx, bundle.Data.ModelPayloadRules, "id"); err != nil {
			return fmt.Errorf("import model payload rules: %w", err)
		}
		if imported["user_model_auth_bindings"], err = upsertMigrationRows(tx, bundle.Data.UserModelAuthBindings, "id"); err != nil {
			return fmt.Errorf("import user model auth bindings: %w", err)
		}
		if imported["api_keys"], err = upsertMigrationRows(tx, bundle.Data.APIKeys, "id"); err != nil {
			return fmt.Errorf("import api keys: %w", err)
		}
		if imported["bills"], err = upsertMigrationRows(tx, bundle.Data.Bills, "id"); err != nil {
			return fmt.Errorf("import bills: %w", err)
		}
		if imported["billing_rules"], err = upsertMigrationRows(tx, bundle.Data.BillingRules, "id"); err != nil {
			return fmt.Errorf("import billing rules: %w", err)
		}
		if imported["prepaid_cards"], err = upsertMigrationRows(tx, bundle.Data.PrepaidCards, "id"); err != nil {
			return fmt.Errorf("import prepaid cards: %w", err)
		}
		if imported["quotas"], err = upsertMigrationRows(tx, bundle.Data.Quotas, "id"); err != nil {
			return fmt.Errorf("import quotas: %w", err)
		}
		if imported["usages"], err = upsertMigrationRows(tx, bundle.Data.Usages, "id"); err != nil {
			return fmt.Errorf("import usages: %w", err)
		}
		if imported["settings"], err = upsertMigrationRows(tx, bundle.Data.Settings, "key"); err != nil {
			return fmt.Errorf("import settings: %w", err)
		}
		if errReset := resetPostgresMigrationSequences(tx); errReset != nil {
			return errReset
		}
		return nil
	})
	if errTx != nil {
		return nil, errTx
	}
	return imported, nil
}

func upsertMigrationRows[T any](tx *gorm.DB, rows []T, conflictColumns ...string) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}
	columns := make([]clause.Column, 0, len(conflictColumns))
	for _, column := range conflictColumns {
		columns = append(columns, clause.Column{Name: column})
	}
	err := tx.Clauses(clause.OnConflict{
		Columns:   columns,
		UpdateAll: true,
	}).CreateInBatches(rows, migrationBatchSize).Error
	if err != nil {
		return 0, err
	}
	return len(rows), nil
}

func migrationCounts(data migrationData) map[string]int {
	return map[string]int{
		"admins":                   len(data.Admins),
		"user_groups":              len(data.UserGroups),
		"auth_groups":              len(data.AuthGroups),
		"plans":                    len(data.Plans),
		"users":                    len(data.Users),
		"auths":                    len(data.Auths),
		"provider_api_keys":        len(data.ProviderAPIKeys),
		"proxies":                  len(data.Proxies),
		"model_mappings":           len(data.ModelMappings),
		"model_references":         len(data.ModelReferences),
		"model_payload_rules":      len(data.ModelPayloadRules),
		"user_model_auth_bindings": len(data.UserModelAuthBindings),
		"api_keys":                 len(data.APIKeys),
		"bills":                    len(data.Bills),
		"billing_rules":            len(data.BillingRules),
		"prepaid_cards":            len(data.PrepaidCards),
		"quotas":                   len(data.Quotas),
		"usages":                   len(data.Usages),
		"settings":                 len(data.Settings),
	}
}

func parseMigrationBoolQuery(c *gin.Context, key string, defaultValue bool) bool {
	raw := strings.TrimSpace(strings.ToLower(c.Query(key)))
	if raw == "" {
		return defaultValue
	}
	switch raw {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return defaultValue
	}
}

var postgresMigrationSequenceTables = []string{
	"admins",
	"plans",
	"user_groups",
	"auth_groups",
	"users",
	"auths",
	"quota",
	"api_keys",
	"usages",
	"bills",
	"billing_rules",
	"model_mappings",
	"user_model_auth_bindings",
	"model_payload_rules",
	"provider_api_keys",
	"proxies",
	"prepaid_cards",
}

func resetPostgresMigrationSequences(tx *gorm.DB) error {
	if dbutil.DialectName(tx) != dbutil.DialectPostgres {
		return nil
	}
	for _, table := range postgresMigrationSequenceTables {
		stmt := fmt.Sprintf(
			"SELECT setval(pg_get_serial_sequence('%s', 'id')::regclass, COALESCE((SELECT MAX(id) FROM %s), 1), COALESCE((SELECT MAX(id) FROM %s), 0) > 0)",
			table,
			table,
			table,
		)
		if err := tx.Exec(stmt).Error; err != nil {
			return fmt.Errorf("reset %s sequence: %w", table, err)
		}
	}
	return nil
}
