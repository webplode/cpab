package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	internalsettings "github.com/router-for-me/CLIProxyAPIBusiness/internal/settings"
)

// publicConfigResponse is the response payload for public config.
type publicConfigResponse struct {
	SiteName                  string `json:"site_name"`
	PortalRegistrationEnabled bool   `json:"portal_registration_enabled"`
}

// GetPublicConfig returns public configuration for the front UI.
func GetPublicConfig(c *gin.Context) {
	siteName := dbConfigString(internalsettings.SiteNameKey)
	if siteName == "" {
		siteName = internalsettings.DefaultSiteName
	}
	c.JSON(http.StatusOK, publicConfigResponse{
		SiteName:                  siteName,
		PortalRegistrationEnabled: portalRegistrationEnabled(),
	})
}

func portalRegistrationEnabled() bool {
	return dbConfigBool(
		internalsettings.PortalRegistrationEnabledKey,
		internalsettings.DefaultPortalRegistrationEnabled,
	)
}

// dbConfigString reads a string value from the DB config snapshot.
func dbConfigString(key string) string {
	raw, ok := internalsettings.DBConfigValue(key)
	if !ok {
		return ""
	}
	return parseDBConfigString(raw)
}

// parseDBConfigString extracts a string from JSON config payloads.
func parseDBConfigString(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	var s string
	if errUnmarshal := json.Unmarshal(raw, &s); errUnmarshal == nil {
		return strings.TrimSpace(s)
	}
	// wrapper allows parsing values wrapped in a { "value": ... } object.
	var wrapper struct {
		Value json.RawMessage `json:"value"`
	}
	if errUnmarshal := json.Unmarshal(raw, &wrapper); errUnmarshal == nil {
		if len(wrapper.Value) > 0 {
			return parseDBConfigString(wrapper.Value)
		}
	}
	return ""
}

// dbConfigBool reads a boolean value from the DB config snapshot.
func dbConfigBool(key string, fallback bool) bool {
	raw, ok := internalsettings.DBConfigValue(key)
	if !ok {
		return fallback
	}
	return parseDBConfigBoolWithDefault(raw, fallback)
}

// parseDBConfigBoolWithDefault extracts a boolean from JSON config payloads.
func parseDBConfigBoolWithDefault(raw json.RawMessage, fallback bool) bool {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return fallback
	}
	var b bool
	if errUnmarshal := json.Unmarshal(raw, &b); errUnmarshal == nil {
		return b
	}
	var s string
	if errUnmarshal := json.Unmarshal(raw, &s); errUnmarshal == nil {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "1", "yes", "on", "enabled":
			return true
		case "false", "0", "no", "off", "disabled":
			return false
		default:
			return fallback
		}
	}
	var wrapper struct {
		Value json.RawMessage `json:"value"`
	}
	if errUnmarshal := json.Unmarshal(raw, &wrapper); errUnmarshal == nil {
		if len(wrapper.Value) > 0 {
			return parseDBConfigBoolWithDefault(wrapper.Value, fallback)
		}
	}
	return fallback
}
