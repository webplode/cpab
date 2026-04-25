package quota

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"

	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	defaultPollInterval = 3 * time.Minute
	// defaultRequestTimeout bounds a single quota poll HTTP request. Bumped
	// from 20s because chatgpt.com/backend-api/wham/usage and the Gemini
	// quota endpoints occasionally stall past 20s under Cloudflare slow-path
	// routing; the 3-minute poll interval leaves plenty of headroom.
	defaultRequestTimeout  = 45 * time.Second
	maxConcurrentRequests  = 5
	noAuthRetryInterval    = 10 * time.Second
	maxErrorBodyBytes      = 512
	tokenInvalidatedCode   = "token_invalidated"
	authStatusHealthy      = "healthy"
	authStatusNeedsRelogin = "needs_relogin"
)

const (
	antigravityUserAgent = "antigravity/1.11.5 windows/amd64"
	codexUserAgent       = "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal"
)

var (
	antigravityQuotaURLs = []string{
		"https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
		"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
		"https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
	}
	geminiCLIQuotaURL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota"
	codexUsageURL     = "https://chatgpt.com/backend-api/wham/usage"
)

const (
	quotaEnvelopePayloadKey    = "_cpab_quota_payload"
	quotaEnvelopeAuthStatusKey = "_cpab_auth_status"
	authReloginMessage         = "Auth token expired, need re-login"
)

// AuthStatus describes the latest quota poll health for an auth entry.
type AuthStatus struct {
	State        string    `json:"state,omitempty"`
	Message      string    `json:"message,omitempty"`
	Detail       string    `json:"detail,omitempty"`
	CheckedAt    time.Time `json:"checked_at,omitempty"`
	HTTPStatus   int       `json:"http_status,omitempty"`
	NeedsRelogin bool      `json:"needs_relogin,omitempty"`
}

type quotaEnvelope struct {
	Payload    json.RawMessage `json:"_cpab_quota_payload,omitempty"`
	AuthStatus *AuthStatus     `json:"_cpab_auth_status,omitempty"`
}

type authRowInfo struct {
	ID          uint64
	Type        string
	RuntimeOnly bool
	IsAvailable bool
}

// Poller periodically fetches quota data for stored auth entries.
type Poller struct {
	db             *gorm.DB
	manager        *coreauth.Manager
	interval       time.Duration
	requestTimeout time.Duration
	hadAuths       bool
}

// NewPoller constructs a quota poller.
func NewPoller(db *gorm.DB, manager *coreauth.Manager) *Poller {
	if db == nil || manager == nil {
		return nil
	}
	return &Poller{
		db:             db,
		manager:        manager,
		interval:       defaultPollInterval,
		requestTimeout: defaultRequestTimeout,
	}
}

// Start launches the polling loop in a background goroutine.
func (p *Poller) Start(ctx context.Context) {
	if p == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	go p.run(ctx)
	log.Infof("quota poller started (interval=%s)", p.interval)
}

func (p *Poller) run(ctx context.Context) {
	for {
		if ctx != nil && ctx.Err() != nil {
			return
		}
		interval := p.poll(ctx)
		if ctx != nil && ctx.Err() != nil {
			return
		}
		if interval <= 0 {
			interval = p.interval
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
	}
}

func (p *Poller) poll(ctx context.Context) time.Duration {
	if p == nil {
		return 0
	}
	if ctx == nil {
		ctx = context.Background()
	}

	interval, maxConcurrency := p.resolvePollConfig()
	if maxConcurrency <= 0 {
		maxConcurrency = 1
	}

	auths := p.manager.List()
	if len(auths) == 0 {
		if !p.hadAuths {
			return noAuthRetryInterval
		}
		return interval
	}
	p.hadAuths = true

	rowMap, errRows := p.loadAuthRows(ctx)
	if errRows != nil {
		log.WithError(errRows).Warn("quota poller: load auth rows failed")
		return interval
	}

	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	shouldStop := false

	for _, auth := range auths {
		if shouldStop {
			break
		}
		if auth == nil || strings.TrimSpace(auth.ID) == "" {
			continue
		}
		if auth.Disabled {
			continue
		}
		row, ok := rowMap[auth.ID]
		if !ok || row.RuntimeOnly || !row.IsAvailable {
			continue
		}

		provider := strings.ToLower(strings.TrimSpace(auth.Provider))
		if provider == "" {
			provider = strings.ToLower(strings.TrimSpace(row.Type))
		}
		if provider != "antigravity" && provider != "codex" && provider != "gemini-cli" {
			continue
		}

		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			shouldStop = true
			break
		}
		if shouldStop {
			break
		}

		wg.Add(1)
		authCopy := auth
		rowCopy := row
		providerCopy := provider
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			switch providerCopy {
			case "antigravity":
				p.pollAntigravity(ctx, authCopy, rowCopy)
			case "codex":
				p.pollCodex(ctx, authCopy, rowCopy)
			case "gemini-cli":
				p.pollGeminiCLI(ctx, authCopy, rowCopy)
			default:
				return
			}
		}()
	}

	wg.Wait()
	return interval
}

func (p *Poller) loadAuthRows(ctx context.Context) (map[string]authRowInfo, error) {
	if p == nil || p.db == nil {
		return nil, errors.New("quota poller: db not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var rows []models.Auth
	if errFind := p.db.WithContext(ctx).
		Select("id", "key", "content", "is_available").
		Order("id ASC").
		Find(&rows).Error; errFind != nil {
		return nil, errFind
	}

	rowMap := make(map[string]authRowInfo, len(rows))
	for _, row := range rows {
		metadata := parseMetadata(row.Content)
		rowMap[row.Key] = authRowInfo{
			ID:          row.ID,
			Type:        normalizeString(metadata["type"]),
			RuntimeOnly: isRuntimeOnly(metadata),
			IsAvailable: row.IsAvailable,
		}
	}
	return rowMap, nil
}

func (p *Poller) resolvePollConfig() (time.Duration, int) {
	intervalSeconds := internalsettings.DefaultQuotaPollIntervalSeconds
	maxConcurrency := internalsettings.DefaultQuotaPollMaxConcurrency

	if raw, ok := internalsettings.DBConfigValue(internalsettings.QuotaPollIntervalSecondsKey); ok {
		if parsed, okParse := parseDBConfigInt(raw); okParse && parsed > 0 {
			intervalSeconds = parsed
		}
	}
	if raw, ok := internalsettings.DBConfigValue(internalsettings.QuotaPollMaxConcurrencyKey); ok {
		if parsed, okParse := parseDBConfigInt(raw); okParse && parsed > 0 {
			maxConcurrency = parsed
		}
	}
	if maxConcurrency > maxConcurrentRequests {
		maxConcurrency = maxConcurrentRequests
	}
	return time.Duration(intervalSeconds) * time.Second, maxConcurrency
}

func (p *Poller) pollAntigravity(ctx context.Context, auth *coreauth.Auth, row authRowInfo) {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("User-Agent", antigravityUserAgent)
	body := []byte("{}")

	var lastStatus int
	var lastDetail string

	for _, url := range antigravityQuotaURLs {
		status, payload, errReq := p.doRequest(ctx, auth, http.MethodPost, url, body, headers)
		if errReq != nil {
			log.WithError(errReq).Warnf("quota poller: antigravity request failed (auth=%s)", auth.ID)
			lastStatus = 0
			lastDetail = errReq.Error()
			continue
		}
		if status < http.StatusOK || status >= http.StatusMultipleChoices {
			if isTokenInvalidatedResponse(status, payload) {
				p.markAuthNeedsRelogin(ctx, auth, row, "antigravity", status, summarizePayload(payload), true)
				return
			}
			log.Warnf("quota poller: antigravity status=%d (auth=%s body=%s)", status, auth.ID, summarizePayload(payload))
			lastStatus = status
			lastDetail = summarizePayload(payload)
			continue
		}
		if errSave := p.saveQuota(ctx, row.ID, row.Type, payload, healthyAuthStatus(time.Now().UTC())); errSave != nil {
			log.WithError(errSave).Warnf("quota poller: antigravity save failed (auth=%s)", auth.ID)
		}
		return
	}

	p.markAuthNeedsRelogin(ctx, auth, row, "antigravity", lastStatus, lastDetail, false)
}

func (p *Poller) pollCodex(ctx context.Context, auth *coreauth.Auth, row authRowInfo) {
	metadata := auth.Metadata
	accountID := resolveCodexAccountID(metadata)
	if accountID == "" {
		log.Warnf("quota poller: codex missing account id (auth=%s)", auth.ID)
		return
	}

	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("User-Agent", codexUserAgent)
	headers.Set("Chatgpt-Account-Id", accountID)

	status, payload, errReq := p.doRequest(ctx, auth, http.MethodGet, codexUsageURL, nil, headers)
	if errReq != nil {
		log.WithError(errReq).Warnf("quota poller: codex request failed (auth=%s)", auth.ID)
		p.markAuthNeedsRelogin(ctx, auth, row, "codex", 0, errReq.Error(), false)
		return
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		if isTokenInvalidatedResponse(status, payload) {
			p.markAuthNeedsRelogin(ctx, auth, row, "codex", status, summarizePayload(payload), true)
			return
		}
		log.Warnf("quota poller: codex status=%d (auth=%s body=%s)", status, auth.ID, summarizePayload(payload))
		p.markAuthNeedsRelogin(ctx, auth, row, "codex", status, summarizePayload(payload), false)
		return
	}
	if errSave := p.saveQuota(ctx, row.ID, row.Type, payload, healthyAuthStatus(time.Now().UTC())); errSave != nil {
		log.WithError(errSave).Warnf("quota poller: codex save failed (auth=%s)", auth.ID)
	}
}

func (p *Poller) pollGeminiCLI(ctx context.Context, auth *coreauth.Auth, row authRowInfo) {
	metadata := auth.Metadata
	projectID := resolveGeminiProjectID(metadata)
	if projectID == "" {
		log.Warnf("quota poller: gemini-cli missing project id (auth=%s)", auth.ID)
		return
	}

	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	body, errMarshal := json.Marshal(map[string]string{"project": projectID})
	if errMarshal != nil {
		log.WithError(errMarshal).Warnf("quota poller: gemini-cli request body failed (auth=%s)", auth.ID)
		return
	}

	status, payload, errReq := p.doRequest(ctx, auth, http.MethodPost, geminiCLIQuotaURL, body, headers)
	if errReq != nil {
		log.WithError(errReq).Warnf("quota poller: gemini-cli request failed (auth=%s)", auth.ID)
		p.markAuthNeedsRelogin(ctx, auth, row, "gemini-cli", 0, errReq.Error(), false)
		return
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		if isTokenInvalidatedResponse(status, payload) {
			p.markAuthNeedsRelogin(ctx, auth, row, "gemini-cli", status, summarizePayload(payload), true)
			return
		}
		log.Warnf("quota poller: gemini-cli status=%d (auth=%s body=%s)", status, auth.ID, summarizePayload(payload))
		p.markAuthNeedsRelogin(ctx, auth, row, "gemini-cli", status, summarizePayload(payload), false)
		return
	}
	if errSave := p.saveQuota(ctx, row.ID, row.Type, payload, healthyAuthStatus(time.Now().UTC())); errSave != nil {
		log.WithError(errSave).Warnf("quota poller: gemini-cli save failed (auth=%s)", auth.ID)
	}
}

func (p *Poller) doRequest(ctx context.Context, auth *coreauth.Auth, method, targetURL string, body []byte, headers http.Header) (int, []byte, error) {
	if p == nil || p.manager == nil {
		return 0, nil, errors.New("quota poller: manager not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	reqCtx, cancel := context.WithTimeout(ctx, p.requestTimeout)
	defer cancel()

	req, errReq := p.manager.NewHttpRequest(reqCtx, auth, method, targetURL, body, headers)
	if errReq != nil {
		return 0, nil, errReq
	}

	resp, errResp := p.manager.HttpRequest(reqCtx, auth, req)
	if errResp != nil {
		return 0, nil, errResp
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("quota poller: close response body error: %v", errClose)
		}
	}()

	payload, errRead := io.ReadAll(resp.Body)
	if errRead != nil {
		return resp.StatusCode, nil, errRead
	}
	return resp.StatusCode, payload, nil
}

func (p *Poller) saveQuota(ctx context.Context, authID uint64, authType string, payload []byte, status *AuthStatus) error {
	if p == nil || p.db == nil {
		return errors.New("quota poller: db not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	authType = strings.TrimSpace(authType)
	if authType == "" {
		authType = "unknown"
	}

	payload = normalizePayload(payload)
	if len(payload) == 0 {
		return errors.New("quota poller: empty payload")
	}
	storedPayload, errStored := marshalStoredQuota(payload, status)
	if errStored != nil {
		return errStored
	}

	now := time.Now().UTC()
	var existing models.Quota
	errFind := p.db.WithContext(ctx).
		Where("auth_id = ? AND type = ?", authID, authType).
		First(&existing).Error
	if errFind == nil {
		return p.db.WithContext(ctx).
			Model(&models.Quota{}).
			Where("id = ?", existing.ID).
			Updates(map[string]any{
				"data":       datatypes.JSON(storedPayload),
				"updated_at": now,
			}).Error
	}
	if errors.Is(errFind, gorm.ErrRecordNotFound) {
		row := models.Quota{
			AuthID:    authID,
			Type:      authType,
			Data:      datatypes.JSON(storedPayload),
			CreatedAt: now,
			UpdatedAt: now,
		}
		return p.db.WithContext(ctx).Create(&row).Error
	}
	return errFind
}

func (p *Poller) markAuthNeedsRelogin(ctx context.Context, auth *coreauth.Auth, row authRowInfo, provider string, httpStatus int, detail string, disableAuth bool) {
	if p == nil || p.db == nil || auth == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}

	authID := strings.TrimSpace(auth.ID)
	if authID == "" || row.ID == 0 {
		return
	}

	status := needsReloginAuthStatus(time.Now().UTC(), httpStatus, detail)
	if errSave := p.saveQuotaStatus(ctx, row.ID, row.Type, status); errSave != nil {
		log.WithError(errSave).Warnf("quota poller: failed to persist auth status (auth=%s provider=%s)", authID, provider)
	}

	if disableAuth {
		p.disableRuntimeAuth(ctx, authID)
		if errSet := p.setAuthAvailability(ctx, row.ID, false); errSet != nil {
			log.WithError(errSet).Warnf("quota poller: failed to mark auth unavailable (auth=%s provider=%s)", authID, provider)
		}
	}

	log.Warnf("quota poller: auth requires re-login (provider=%s auth=%s db_id=%d disable=%t status=%d detail=%s)", provider, authID, row.ID, disableAuth, httpStatus, detail)
}

func (p *Poller) disableRuntimeAuth(ctx context.Context, authID string) {
	if p == nil || p.manager == nil {
		return
	}
	authID = strings.TrimSpace(authID)
	if authID == "" {
		return
	}

	existing, ok := p.manager.GetByID(authID)
	if !ok || existing == nil {
		return
	}

	next := existing.Clone()
	next.Disabled = true
	next.Status = coreauth.StatusDisabled
	next.UpdatedAt = time.Now().UTC()
	if _, errUpdate := p.manager.Update(coreauth.WithSkipPersist(ctx), next); errUpdate != nil {
		log.WithError(errUpdate).Warnf("quota poller: failed to disable invalidated auth in runtime manager (auth=%s)", authID)
	}
}

func (p *Poller) setAuthAvailability(ctx context.Context, authRowID uint64, isAvailable bool) error {
	if p == nil || p.db == nil {
		return errors.New("quota poller: db not initialized")
	}
	if authRowID == 0 {
		return errors.New("quota poller: missing auth row id")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return p.db.WithContext(ctx).
		Model(&models.Auth{}).
		Where("id = ?", authRowID).
		Updates(map[string]any{
			"is_available": isAvailable,
			"updated_at":   time.Now().UTC(),
		}).Error
}

func isTokenInvalidatedResponse(status int, payload []byte) bool {
	if status != http.StatusUnauthorized {
		return false
	}
	trimmed := bytesTrimSpace(payload)
	if len(trimmed) == 0 || !json.Valid(trimmed) {
		return false
	}

	var response struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
		Status int `json:"status"`
	}
	if errUnmarshal := json.Unmarshal(trimmed, &response); errUnmarshal != nil {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(response.Error.Code), tokenInvalidatedCode) {
		return false
	}
	return response.Status == 0 || response.Status == http.StatusUnauthorized
}

func normalizePayload(payload []byte) []byte {
	trimmed := bytesTrimSpace(payload)
	if len(trimmed) == 0 {
		return nil
	}
	if json.Valid(trimmed) {
		return trimmed
	}
	escaped, errMarshal := json.Marshal(string(trimmed))
	if errMarshal != nil {
		return nil
	}
	return escaped
}

func parseMetadata(content datatypes.JSON) map[string]any {
	if len(content) == 0 {
		return nil
	}
	var metadata map[string]any
	if errUnmarshal := json.Unmarshal(content, &metadata); errUnmarshal != nil {
		return nil
	}
	return metadata
}

func isRuntimeOnly(metadata map[string]any) bool {
	if metadata == nil {
		return false
	}
	if raw := metadata["runtime_only"]; normalizeBool(raw) {
		return true
	}
	return normalizeBool(metadata["runtimeOnly"])
}

func resolveCodexAccountID(metadata map[string]any) string {
	if metadata == nil {
		return ""
	}
	if accountID := normalizeString(metadata["account_id"]); accountID != "" {
		return accountID
	}
	if accountID := normalizeString(metadata["accountId"]); accountID != "" {
		return accountID
	}

	meta := mapFromAny(metadata["metadata"])
	attrs := mapFromAny(metadata["attributes"])
	candidates := []any{
		metadata["id_token"],
		meta["id_token"],
		attrs["id_token"],
	}
	for _, candidate := range candidates {
		accountID := extractCodexChatgptAccountID(candidate)
		if accountID != "" {
			return accountID
		}
	}
	return ""
}

func extractCodexChatgptAccountID(value any) string {
	payload := parseIDTokenPayload(value)
	if payload == nil {
		return ""
	}
	accountID := normalizeString(payload["chatgpt_account_id"])
	if accountID != "" {
		return accountID
	}
	return normalizeString(payload["chatgptAccountId"])
}

func resolveGeminiProjectID(metadata map[string]any) string {
	if metadata == nil {
		return ""
	}
	if projectID := normalizeString(metadata["project_id"]); projectID != "" {
		return projectID
	}
	return ""
}

func parseIDTokenPayload(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	raw := normalizeString(value)
	if raw == "" {
		return nil
	}

	var parsed map[string]any
	if errUnmarshal := json.Unmarshal([]byte(raw), &parsed); errUnmarshal == nil {
		return parsed
	}

	segments := strings.Split(raw, ".")
	if len(segments) < 2 {
		return nil
	}
	payload, errDecode := decodeBase64URL(segments[1])
	if errDecode != nil || payload == "" {
		return nil
	}
	if errUnmarshal := json.Unmarshal([]byte(payload), &parsed); errUnmarshal != nil {
		return nil
	}
	return parsed
}

func decodeBase64URL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	decoded, errDecode := base64.RawURLEncoding.DecodeString(value)
	if errDecode == nil {
		return string(decoded), nil
	}

	padded := value
	if rem := len(value) % 4; rem != 0 {
		padded = value + strings.Repeat("=", 4-rem)
	}
	decoded, errDecode = base64.URLEncoding.DecodeString(padded)
	if errDecode != nil {
		return "", errDecode
	}
	return string(decoded), nil
}

func normalizeString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return strings.TrimSpace(typed.String())
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return ""
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		val := float64(typed)
		if math.IsNaN(val) || math.IsInf(val, 0) {
			return ""
		}
		return strconv.FormatFloat(val, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	default:
		return ""
	}
}

func normalizeBool(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	default:
		return false
	}
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	switch typed := value.(type) {
	case map[string]any:
		return typed
	default:
		return nil
	}
}

func bytesTrimSpace(input []byte) []byte {
	if len(input) == 0 {
		return nil
	}
	start := 0
	end := len(input)
	for start < end {
		if input[start] > ' ' {
			break
		}
		start++
	}
	for end > start {
		if input[end-1] > ' ' {
			break
		}
		end--
	}
	return input[start:end]
}

func parseDBConfigInt(raw json.RawMessage) (int, bool) {
	raw = bytesTrimSpace(raw)
	if len(raw) == 0 {
		return 0, false
	}
	var n int
	if errUnmarshal := json.Unmarshal(raw, &n); errUnmarshal == nil {
		return n, true
	}
	var f float64
	if errUnmarshal := json.Unmarshal(raw, &f); errUnmarshal == nil {
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return int(math.Round(f)), true
	}
	var s string
	if errUnmarshal := json.Unmarshal(raw, &s); errUnmarshal == nil {
		parsed, errParse := strconv.Atoi(strings.TrimSpace(s))
		if errParse == nil {
			return parsed, true
		}
	}
	var wrapper struct {
		Value json.RawMessage `json:"value"`
	}
	if errUnmarshal := json.Unmarshal(raw, &wrapper); errUnmarshal == nil && len(wrapper.Value) > 0 {
		return parseDBConfigInt(wrapper.Value)
	}
	return 0, false
}

func summarizePayload(payload []byte) string {
	trimmed := bytesTrimSpace(payload)
	if len(trimmed) == 0 {
		return ""
	}
	if len(trimmed) > maxErrorBodyBytes {
		return string(trimmed[:maxErrorBodyBytes]) + "...(truncated)"
	}
	return string(trimmed)
}

func healthyAuthStatus(now time.Time) *AuthStatus {
	return &AuthStatus{
		State:        authStatusHealthy,
		CheckedAt:    now.UTC(),
		NeedsRelogin: false,
	}
}

func needsReloginAuthStatus(now time.Time, httpStatus int, detail string) *AuthStatus {
	return &AuthStatus{
		State:        authStatusNeedsRelogin,
		Message:      authReloginMessage,
		Detail:       strings.TrimSpace(detail),
		CheckedAt:    now.UTC(),
		HTTPStatus:   httpStatus,
		NeedsRelogin: true,
	}
}

func (p *Poller) saveQuotaStatus(ctx context.Context, authID uint64, authType string, status *AuthStatus) error {
	if p == nil || p.db == nil {
		return errors.New("quota poller: db not initialized")
	}
	if authID == 0 {
		return errors.New("quota poller: missing auth id")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	authType = strings.TrimSpace(authType)
	if authType == "" {
		authType = "unknown"
	}

	now := time.Now().UTC()
	var existing models.Quota
	errFind := p.db.WithContext(ctx).
		Where("auth_id = ? AND type = ?", authID, authType).
		First(&existing).Error
	switch {
	case errFind == nil:
		storedPayload, errMarshal := mergeStoredQuotaStatus(existing.Data, status)
		if errMarshal != nil {
			return errMarshal
		}
		return p.db.WithContext(ctx).
			Model(&models.Quota{}).
			Where("id = ?", existing.ID).
			Updates(map[string]any{
				"data":       datatypes.JSON(storedPayload),
				"updated_at": now,
			}).Error
	case errors.Is(errFind, gorm.ErrRecordNotFound):
		storedPayload, errMarshal := marshalStoredQuota(nil, status)
		if errMarshal != nil {
			return errMarshal
		}
		row := models.Quota{
			AuthID:    authID,
			Type:      authType,
			Data:      datatypes.JSON(storedPayload),
			CreatedAt: now,
			UpdatedAt: now,
		}
		return p.db.WithContext(ctx).Create(&row).Error
	default:
		return errFind
	}
}

// UnwrapStoredQuotaData returns the provider payload stored in quota.data and any
// CPAB-specific auth status that was attached by the quota poller.
func UnwrapStoredQuotaData(data datatypes.JSON) (datatypes.JSON, *AuthStatus) {
	payload, status, ok := unmarshalStoredQuota(data)
	if !ok {
		return normalizePayload(data), nil
	}
	return datatypes.JSON(normalizePayload(payload)), status
}

// MarshalStoredQuotaData wraps a provider quota payload with CPAB-specific auth
// health metadata so it can be stored in models.Quota.Data.
func MarshalStoredQuotaData(payload []byte, status *AuthStatus) ([]byte, error) {
	return marshalStoredQuota(payload, status)
}

func marshalStoredQuota(payload []byte, status *AuthStatus) ([]byte, error) {
	envelope := quotaEnvelope{
		Payload:    json.RawMessage(normalizePayload(payload)),
		AuthStatus: cloneAuthStatus(status),
	}
	return json.Marshal(envelope)
}

func mergeStoredQuotaStatus(existing datatypes.JSON, status *AuthStatus) ([]byte, error) {
	payload, _, ok := unmarshalStoredQuota(existing)
	if !ok {
		payload = normalizePayload(existing)
	}
	return marshalStoredQuota(payload, status)
}

func unmarshalStoredQuota(data []byte) ([]byte, *AuthStatus, bool) {
	trimmed := bytesTrimSpace(data)
	if len(trimmed) == 0 || !json.Valid(trimmed) {
		return nil, nil, false
	}
	var raw map[string]json.RawMessage
	if errUnmarshal := json.Unmarshal(trimmed, &raw); errUnmarshal != nil {
		return nil, nil, false
	}
	payload, hasPayload := raw[quotaEnvelopePayloadKey]
	statusRaw, hasStatus := raw[quotaEnvelopeAuthStatusKey]
	if !hasPayload && !hasStatus {
		return nil, nil, false
	}

	var status *AuthStatus
	if len(bytesTrimSpace(statusRaw)) > 0 && string(bytesTrimSpace(statusRaw)) != "null" {
		var parsed AuthStatus
		if errUnmarshal := json.Unmarshal(statusRaw, &parsed); errUnmarshal == nil {
			status = &parsed
		}
	}
	return normalizePayload(payload), status, true
}

func cloneAuthStatus(status *AuthStatus) *AuthStatus {
	if status == nil {
		return nil
	}
	cloned := *status
	if cloned.CheckedAt.IsZero() {
		cloned.CheckedAt = time.Now().UTC()
	}
	return &cloned
}
