package security

import (
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateAndParsePendingMFAToken(t *testing.T) {
	token, err := GeneratePendingMFAToken("secret", 42, "alice")
	if err != nil {
		t.Fatalf("GeneratePendingMFAToken() error = %v", err)
	}

	claims, err := ParsePendingMFAToken("secret", token)
	if err != nil {
		t.Fatalf("ParsePendingMFAToken() error = %v", err)
	}

	if claims.UserID != 42 {
		t.Fatalf("UserID = %d, want 42", claims.UserID)
	}
	if claims.Username != "alice" {
		t.Fatalf("Username = %q, want %q", claims.Username, "alice")
	}
	if claims.Purpose != pendingMFAPurpose {
		t.Fatalf("Purpose = %q, want %q", claims.Purpose, pendingMFAPurpose)
	}
	if claims.Issuer != pendingMFAIssuer {
		t.Fatalf("Issuer = %q, want %q", claims.Issuer, pendingMFAIssuer)
	}
	if claims.ExpiresAt == nil {
		t.Fatal("ExpiresAt = nil, want set")
	}
	ttl := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if ttl < pendingMFATTL-time.Second || ttl > pendingMFATTL+time.Second {
		t.Fatalf("TTL = %s, want about %s", ttl, pendingMFATTL)
	}
}

func TestParsePendingMFATokenRejectsRegularUserToken(t *testing.T) {
	token, err := GenerateToken("secret", 7, "alice", "Alice", "alice@example.com", time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	_, err = ParsePendingMFAToken("secret", token)
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("ParsePendingMFAToken() error = %v, want %v", err, ErrInvalidToken)
	}
}

func TestParsePendingMFATokenRejectsWrongPurpose(t *testing.T) {
	now := time.Now().UTC()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, PendingMFAClaims{
		UserID:   9,
		Username: "alice",
		Purpose:  "user_session",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    pendingMFAIssuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(pendingMFATTL)),
		},
	})
	tokenString, err := token.SignedString([]byte("secret"))
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}

	_, err = ParsePendingMFAToken("secret", tokenString)
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("ParsePendingMFAToken() error = %v, want %v", err, ErrInvalidToken)
	}
}

func TestParsePendingMFATokenRejectsExpiredToken(t *testing.T) {
	now := time.Now().UTC()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, PendingMFAClaims{
		UserID:   9,
		Username: "alice",
		Purpose:  pendingMFAPurpose,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    pendingMFAIssuer,
			IssuedAt:  jwt.NewNumericDate(now.Add(-10 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(-5 * time.Minute)),
		},
	})
	tokenString, err := token.SignedString([]byte("secret"))
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}

	_, err = ParsePendingMFAToken("secret", tokenString)
	if !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("ParsePendingMFAToken() error = %v, want %v", err, ErrExpiredToken)
	}
}

func TestParsePendingMFATokenRejectsInvalidSignature(t *testing.T) {
	token, err := GeneratePendingMFAToken("secret", 42, "alice")
	if err != nil {
		t.Fatalf("GeneratePendingMFAToken() error = %v", err)
	}

	_, err = ParsePendingMFAToken("different-secret", token)
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("ParsePendingMFAToken() error = %v, want %v", err, ErrInvalidToken)
	}
}
