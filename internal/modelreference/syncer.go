package modelreference

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"
	log "github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

const (
	defaultModelsURL      = "https://models.dev/api.json"
	defaultSyncInterval   = 30 * time.Minute
	defaultRequestTimeout = 15 * time.Second
)

// Syncer keeps the models reference table synced with models.dev.
type Syncer struct {
	db       *gorm.DB
	url      string
	interval time.Duration
	client   *http.Client
	now      func() time.Time
}

type syncProviderFilters struct {
	allowlist      map[string]struct{}
	onlyConfigured bool
}

// NewSyncer constructs a models reference syncer.
func NewSyncer(db *gorm.DB) *Syncer {
	if db == nil {
		return nil
	}
	return &Syncer{
		db:       db,
		url:      defaultModelsURL,
		interval: defaultSyncInterval,
		client:   &http.Client{Timeout: defaultRequestTimeout},
		now:      time.Now,
	}
}

// Start runs the sync loop in the background.
func (s *Syncer) Start(ctx context.Context) {
	if s == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	go s.run(ctx)
	log.Infof("models reference syncer started (interval=%s)", s.interval)
}

func (s *Syncer) run(ctx context.Context) {
	if s == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	interval := s.interval
	if interval <= 0 {
		interval = defaultSyncInterval
	}

	if err := s.SyncOnce(ctx); err != nil {
		log.WithError(err).Warn("models syncer: initial sync failed")
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.SyncOnce(ctx); err != nil {
				log.WithError(err).Warn("models syncer: sync failed")
			}
		}
	}
}

// SyncOnce fetches and persists the latest models payload.
func (s *Syncer) SyncOnce(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("models syncer: nil db")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	url := strings.TrimSpace(s.url)
	if url == "" {
		return fmt.Errorf("models syncer: empty url")
	}
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: defaultRequestTimeout}
	}
	clock := s.now
	if clock == nil {
		clock = time.Now
	}

	requestCtx, cancel := context.WithTimeout(ctx, defaultRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("models syncer: build request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("models syncer: request failed: %w", err)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.WithError(errClose).Warn("models syncer: close response body failed")
		}
	}()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("models syncer: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("models syncer: read response: %w", err)
	}

	refs, err := ParseModelsPayload(body)
	if err != nil {
		return err
	}
	if len(refs) == 0 {
		return fmt.Errorf("models syncer: empty payload")
	}

	filters := loadSyncProviderFilters()
	if len(filters.allowlist) > 0 || filters.onlyConfigured {
		configuredProviders := map[string]struct{}{}
		if filters.onlyConfigured {
			var errConfigured error
			configuredProviders, errConfigured = s.loadConfiguredProviderSet(ctx)
			if errConfigured != nil {
				return fmt.Errorf("models syncer: load configured providers: %w", errConfigured)
			}
			if len(configuredProviders) == 0 {
				log.Warn("models syncer: configured-provider filtering enabled but no configured providers found; skipping update")
				return nil
			}
		}
		filtered := filterReferencesByProvider(refs, filters.allowlist, configuredProviders, filters.onlyConfigured)
		if len(filtered) == 0 {
			log.Warn("models syncer: provider filters matched no models; skipping update")
			return nil
		}
		log.WithFields(log.Fields{
			"before": len(refs),
			"after":  len(filtered),
		}).Info("models syncer: applied provider filters")
		refs = filtered
	}

	syncTime := clock().UTC()
	if err := StoreReferences(ctx, s.db, refs, syncTime); err != nil {
		return err
	}

	return nil
}

func loadSyncProviderFilters() syncProviderFilters {
	filters := syncProviderFilters{
		allowlist:      make(map[string]struct{}),
		onlyConfigured: internalsettings.DefaultModelReferenceSyncOnlyConfiguredProviders,
	}

	if raw, ok := internalsettings.DBConfigValue(internalsettings.ModelReferenceSyncOnlyConfiguredProvidersKey); ok {
		if parsed, okParse := parseDBConfigBool(raw); okParse {
			filters.onlyConfigured = parsed
		}
	}

	allowlistRaw := internalsettings.DefaultModelReferenceSyncProviderAllowlist
	if raw, ok := internalsettings.DBConfigValue(internalsettings.ModelReferenceSyncProviderAllowlistKey); ok {
		allowlistRaw = decodeDBConfigString(raw)
	}
	for _, value := range splitProviderList(allowlistRaw) {
		if token := canonicalProviderToken(value); token != "" {
			filters.allowlist[token] = struct{}{}
		}
	}

	return filters
}

func (s *Syncer) loadConfiguredProviderSet(ctx context.Context) (map[string]struct{}, error) {
	if s == nil || s.db == nil {
		return map[string]struct{}{}, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	configured := make(map[string]struct{})

	var providerRows []string
	if err := s.db.WithContext(ctx).
		Model(&models.ProviderAPIKey{}).
		Distinct("provider").
		Pluck("provider", &providerRows).Error; err != nil {
		return nil, err
	}
	for _, provider := range providerRows {
		if token := canonicalProviderToken(provider); token != "" {
			configured[token] = struct{}{}
		}
	}

	var authRows []models.Auth
	if err := s.db.WithContext(ctx).
		Select("content").
		Find(&authRows).Error; err != nil {
		return nil, err
	}
	for _, row := range authRows {
		provider := extractProviderFromAuthContent(row.Content)
		if token := canonicalProviderToken(provider); token != "" {
			configured[token] = struct{}{}
		}
	}

	return configured, nil
}

func filterReferencesByProvider(
	refs []models.ModelReference,
	allowlist map[string]struct{},
	configuredProviders map[string]struct{},
	onlyConfigured bool,
) []models.ModelReference {
	if len(refs) == 0 {
		return nil
	}
	if len(allowlist) == 0 && !onlyConfigured {
		return refs
	}

	filtered := make([]models.ModelReference, 0, len(refs))
	for _, ref := range refs {
		token := canonicalProviderToken(ref.ProviderName)
		if token == "" {
			continue
		}
		if len(allowlist) > 0 {
			if _, ok := allowlist[token]; !ok {
				continue
			}
		}
		if onlyConfigured {
			if _, ok := configuredProviders[token]; !ok {
				continue
			}
		}
		filtered = append(filtered, ref)
	}

	return filtered
}

func extractProviderFromAuthContent(content []byte) string {
	content = bytes.TrimSpace(content)
	if len(content) == 0 {
		return ""
	}

	var payload map[string]any
	if err := json.Unmarshal(content, &payload); err != nil {
		return ""
	}

	typeValue := strings.TrimSpace(asString(payload["type"]))
	if typeValue != "" {
		return typeValue
	}

	providerValue := strings.TrimSpace(asString(payload["provider"]))
	if providerValue != "" {
		return providerValue
	}

	metadata, ok := payload["metadata"].(map[string]any)
	if ok {
		typeValue = strings.TrimSpace(asString(metadata["type"]))
		if typeValue != "" {
			return typeValue
		}
		providerValue = strings.TrimSpace(asString(metadata["provider"]))
		if providerValue != "" {
			return providerValue
		}
	}

	return ""
}

func asString(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func parseDBConfigBool(raw json.RawMessage) (bool, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return false, false
	}

	var parsedBool bool
	if err := json.Unmarshal(raw, &parsedBool); err == nil {
		return parsedBool, true
	}

	trimmed := strings.TrimSpace(string(raw))
	trimmed = strings.Trim(trimmed, "\"")
	switch strings.ToLower(trimmed) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

func decodeDBConfigString(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}

	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(strings.Trim(string(raw), "\""))
}

func splitProviderList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == ';'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func canonicalProviderToken(value string) string {
	normalized := normalizeProviderToken(value)
	if normalized == "" {
		return ""
	}

	switch {
	case strings.Contains(normalized, "vertex"):
		return "vertex"
	case strings.Contains(normalized, "google"), strings.Contains(normalized, "gemini"):
		return "google"
	case strings.Contains(normalized, "anthropic"), strings.Contains(normalized, "claude"):
		return "anthropic"
	case strings.Contains(normalized, "openai"), strings.Contains(normalized, "codex"):
		return "openai"
	case strings.Contains(normalized, "amazon"), strings.Contains(normalized, "bedrock"), strings.Contains(normalized, "aws"):
		return "amazon"
	}

	switch normalized {
	case "openaicompatibility":
		return "openai"
	case "claudecode":
		return "anthropic"
	}

	return normalized
}

func normalizeProviderToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}

	builder := strings.Builder{}
	builder.Grow(len(value))
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}
