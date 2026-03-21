package security

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWT validation errors.
var (
	// ErrInvalidToken indicates a token is malformed or fails validation.
	ErrInvalidToken = errors.New("invalid token")
	// ErrExpiredToken indicates a token has expired.
	ErrExpiredToken = errors.New("token expired")
)

const (
	pendingMFAPurpose = "pending_mfa"
	pendingMFAIssuer  = "cpab:pending_mfa"
	pendingMFATTL     = 5 * time.Minute
)

// UserClaims defines JWT claims for end users.
type UserClaims struct {
	UserID   uint64 `json:"user_id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	jwt.RegisteredClaims
}

// AdminClaims defines JWT claims for administrators.
type AdminClaims struct {
	AdminID  uint64 `json:"admin_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// PendingMFAClaims defines short-lived JWT claims used between password and MFA verification.
type PendingMFAClaims struct {
	UserID   uint64 `json:"user_id"`
	Username string `json:"username"`
	Purpose  string `json:"purpose"`
	jwt.RegisteredClaims
}

// GenerateToken signs a user JWT with the configured expiry.
func GenerateToken(secret string, userID uint64, username, name, email string, expiry time.Duration) (string, error) {
	now := time.Now().UTC()
	claims := UserClaims{
		UserID:   userID,
		Username: username,
		Name:     name,
		Email:    email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken validates a user JWT and returns its claims.
func ParseToken(secret string, tokenString string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*UserClaims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// GenerateAdminToken signs an admin JWT with the configured expiry.
func GenerateAdminToken(secret string, adminID uint64, username string, expiry time.Duration) (string, error) {
	now := time.Now().UTC()
	claims := AdminClaims{
		AdminID:  adminID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseAdminToken validates an admin JWT and returns its claims.
func ParseAdminToken(secret string, tokenString string) (*AdminClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &AdminClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*AdminClaims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// GeneratePendingMFAToken signs a short-lived JWT used to continue an MFA login flow.
func GeneratePendingMFAToken(secret string, userID uint64, username string) (string, error) {
	now := time.Now().UTC()
	claims := PendingMFAClaims{
		UserID:   userID,
		Username: username,
		Purpose:  pendingMFAPurpose,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    pendingMFAIssuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(pendingMFATTL)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParsePendingMFAToken validates a pending MFA JWT and returns its claims.
func ParsePendingMFAToken(secret string, tokenString string) (*PendingMFAClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &PendingMFAClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*PendingMFAClaims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}
	if claims.Purpose != pendingMFAPurpose || claims.Issuer != pendingMFAIssuer {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
