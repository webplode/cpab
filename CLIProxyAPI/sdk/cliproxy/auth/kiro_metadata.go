package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	KiroProvider = "kiro"

	kiroDefaultRegion = "us-east-1"
)

var ErrKiroRefreshTokenMissing = errors.New("kiro auth: refresh token is required")

// KiroMetadata is the typed view of provider-specific Kiro auth state stored
// in Auth.Metadata. Token fields are secrets and must be redacted before they
// are logged or returned through admin APIs.
type KiroMetadata struct {
	Type                 string
	Label                string
	Email                string
	RefreshToken         string
	AccessToken          string
	ExpiresAt            time.Time
	ExpiresIn            int64
	Region               string
	ProfileARN           string
	ClientID             string
	ClientSecret         string
	AuthMethod           string
	StartURL             string
	ModelCatalogCachedAt time.Time
}

// ParseKiroMetadata extracts Kiro metadata from an auth record and validates
// the minimum refresh-token import shape used by CPAB.
func ParseKiroMetadata(auth *Auth) (KiroMetadata, error) {
	if auth == nil {
		return KiroMetadata{}, fmt.Errorf("kiro auth: auth is nil")
	}
	meta := auth.Metadata
	if meta == nil {
		meta = map[string]any{}
	}

	out := KiroMetadata{
		Type:         coalesceString(meta, "type", "provider"),
		Label:        strings.TrimSpace(auth.Label),
		RefreshToken: coalesceString(meta, "refresh_token", "refreshToken"),
		AccessToken:  coalesceString(meta, "access_token", "accessToken"),
		Region:       coalesceString(meta, "region"),
		ProfileARN:   coalesceString(meta, "profile_arn", "profileArn"),
		ClientID:     coalesceString(meta, "client_id", "clientId"),
		ClientSecret: coalesceString(meta, "client_secret", "clientSecret"),
		AuthMethod:   coalesceString(meta, "auth_method", "authMethod"),
		StartURL:     coalesceString(meta, "start_url", "startUrl"),
	}
	if out.Type == "" {
		out.Type = strings.TrimSpace(auth.Provider)
	}
	if out.Label == "" {
		out.Label = coalesceString(meta, "label")
	}
	out.Email = coalesceString(meta, "email")
	if out.Region == "" {
		out.Region = kiroDefaultRegion
	}
	if exp, ok := lookupMetadataTime(meta, "expires_at", "expiresAt", "expired", "expire", "expiry", "expires"); ok {
		out.ExpiresAt = exp.UTC()
	}
	if cachedAt, ok := lookupMetadataTime(meta, "model_catalog_cached_at", "modelCatalogCachedAt"); ok {
		out.ModelCatalogCachedAt = cachedAt.UTC()
	}
	out.ExpiresIn = coalesceInt64(meta, "expires_in", "expiresIn")

	if strings.TrimSpace(out.RefreshToken) == "" {
		return out, ErrKiroRefreshTokenMissing
	}
	return out, nil
}

func (m KiroMetadata) AccessTokenFresh(now time.Time, lead time.Duration) bool {
	if strings.TrimSpace(m.AccessToken) == "" {
		return false
	}
	if m.ExpiresAt.IsZero() {
		return true
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if lead < 0 {
		lead = 0
	}
	return now.UTC().Add(lead).Before(m.ExpiresAt.UTC())
}

func (m KiroMetadata) ShouldRefresh(now time.Time, lead time.Duration) bool {
	return !m.AccessTokenFresh(now, lead)
}

// ApplyKiroMetadata writes typed Kiro metadata back onto the auth record using
// the snake_case keys used by CPAB auth rows.
func ApplyKiroMetadata(auth *Auth, metadata KiroMetadata) *Auth {
	if auth == nil {
		return nil
	}
	if auth.Metadata == nil {
		auth.Metadata = make(map[string]any)
	}
	auth.Provider = KiroProvider
	auth.Metadata["type"] = KiroProvider
	setNonEmpty(auth.Metadata, "label", metadata.Label)
	setNonEmpty(auth.Metadata, "email", metadata.Email)
	setNonEmpty(auth.Metadata, "refresh_token", metadata.RefreshToken)
	setNonEmpty(auth.Metadata, "access_token", metadata.AccessToken)
	setNonEmpty(auth.Metadata, "region", metadata.Region)
	setNonEmpty(auth.Metadata, "profile_arn", metadata.ProfileARN)
	setNonEmpty(auth.Metadata, "client_id", metadata.ClientID)
	setNonEmpty(auth.Metadata, "client_secret", metadata.ClientSecret)
	setNonEmpty(auth.Metadata, "auth_method", metadata.AuthMethod)
	setNonEmpty(auth.Metadata, "start_url", metadata.StartURL)
	if metadata.ExpiresIn > 0 {
		auth.Metadata["expires_in"] = metadata.ExpiresIn
	}
	if !metadata.ExpiresAt.IsZero() {
		auth.Metadata["expires_at"] = metadata.ExpiresAt.UTC().Format(time.RFC3339)
		auth.Metadata["expired"] = metadata.ExpiresAt.UTC().Format(time.RFC3339)
	}
	if !metadata.ModelCatalogCachedAt.IsZero() {
		auth.Metadata["model_catalog_cached_at"] = metadata.ModelCatalogCachedAt.UTC().Format(time.RFC3339)
	}
	return auth
}

func RedactKiroMetadata(meta map[string]any) map[string]any {
	if meta == nil {
		return nil
	}
	out := make(map[string]any, len(meta))
	for k, v := range meta {
		out[k] = v
	}
	for _, key := range []string{
		"refresh_token",
		"refreshToken",
		"access_token",
		"accessToken",
		"client_secret",
		"clientSecret",
	} {
		if _, ok := out[key]; ok {
			out[key] = "[redacted]"
		}
	}
	return out
}

func IsKiroTokenAuthError(statusCode int, body string) bool {
	if statusCode == 401 {
		return true
	}
	if statusCode != 403 {
		return false
	}
	lower := strings.ToLower(body)
	if strings.Contains(lower, "bearer") {
		return true
	}
	if strings.Contains(lower, "token") && (strings.Contains(lower, "invalid") || strings.Contains(lower, "expired") || strings.Contains(lower, "unauthorized")) {
		return true
	}
	return false
}

func coalesceString(meta map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, ok := meta[key]; ok {
			switch v := raw.(type) {
			case string:
				if trimmed := strings.TrimSpace(v); trimmed != "" {
					return trimmed
				}
			case fmt.Stringer:
				if trimmed := strings.TrimSpace(v.String()); trimmed != "" {
					return trimmed
				}
			}
		}
	}
	return ""
}

func coalesceInt64(meta map[string]any, keys ...string) int64 {
	for _, key := range keys {
		raw, ok := meta[key]
		if !ok {
			continue
		}
		switch v := raw.(type) {
		case int:
			return int64(v)
		case int32:
			return int64(v)
		case int64:
			return v
		case float64:
			return int64(v)
		case json.Number:
			if i, err := v.Int64(); err == nil {
				return i
			}
		case string:
			if i, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
				return i
			}
		}
	}
	return 0
}

func setNonEmpty(meta map[string]any, key, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	meta[key] = value
}
