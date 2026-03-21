package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/config"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/security"
	"gorm.io/gorm"
)

// AuthHandler handles admin authentication endpoints.
type AuthHandler struct {
	db       *gorm.DB
	jwtCfg   config.JWTConfig
	webAuthn *webauthn.WebAuthn
}

// NewAuthHandler constructs an AuthHandler.
func NewAuthHandler(db *gorm.DB, jwtCfg config.JWTConfig, webAuthn *webauthn.WebAuthn) *AuthHandler {
	return &AuthHandler{db: db, jwtCfg: jwtCfg, webAuthn: webAuthn}
}

// loginRequest defines the request body for admin login.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Login authenticates an admin and issues a JWT if MFA is not required.
func (h *AuthHandler) Login(c *gin.Context) {
	var body loginRequest
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	username := strings.TrimSpace(body.Username)
	password := strings.TrimSpace(body.Password)
	if username == "" || password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	var admin models.Admin
	if errFind := h.db.WithContext(c.Request.Context()).Where("username = ?", username).First(&admin).Error; errFind != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if !admin.Active {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin account is disabled"})
		return
	}

	if !security.CheckPassword(admin.Password, password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if methods := adminMFAMethods(admin); len(methods) > 0 {
		pendingToken, errToken := security.GeneratePendingMFAToken(h.jwtCfg.Secret, admin.ID, admin.Username)
		if errToken != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate mfa token"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"mfa_required": true,
			"mfa_token":    pendingToken,
			"mfa_methods":  methods,
		})
		return
	}

	h.respondWithAdminToken(c, admin)
}

func adminMFAMethods(admin models.Admin) []string {
	methods := make([]string, 0, 2)
	if strings.TrimSpace(admin.TOTPSecret) != "" {
		methods = append(methods, "totp")
	}
	if len(admin.PasskeyID) > 0 && len(admin.PasskeyPublicKey) > 0 {
		methods = append(methods, "passkey")
	}
	return methods
}
