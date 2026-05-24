package auth

import (
	"errors"
	"testing"
	"time"
)

func TestParseKiroMetadataRequiresRefreshToken(t *testing.T) {
	auth := &Auth{
		ID:       "kiro-1",
		Provider: KiroProvider,
		Metadata: map[string]any{"type": KiroProvider},
	}

	_, err := ParseKiroMetadata(auth)
	if !errors.Is(err, ErrKiroRefreshTokenMissing) {
		t.Fatalf("err = %v, want ErrKiroRefreshTokenMissing", err)
	}
}

func TestParseKiroMetadataAcceptsSnakeAndCamelKeys(t *testing.T) {
	expiresAt := time.Date(2026, 5, 19, 6, 0, 0, 0, time.UTC)
	auth := &Auth{
		ID:       "kiro-1",
		Provider: KiroProvider,
		Label:    "Kiro Account",
		Metadata: map[string]any{
			"type":         KiroProvider,
			"refreshToken": "refresh",
			"accessToken":  "access",
			"expiresAt":    expiresAt.Format(time.RFC3339),
			"profileArn":   "arn:aws:codewhisperer:us-east-1:123:profile/test",
			"clientId":     "client-id",
			"clientSecret": "client-secret",
			"authMethod":   "builder_id",
		},
	}

	meta, err := ParseKiroMetadata(auth)
	if err != nil {
		t.Fatalf("ParseKiroMetadata: %v", err)
	}
	if meta.RefreshToken != "refresh" || meta.AccessToken != "access" {
		t.Fatalf("tokens = %q/%q", meta.RefreshToken, meta.AccessToken)
	}
	if meta.Region != "us-east-1" {
		t.Fatalf("region = %q, want us-east-1", meta.Region)
	}
	if !meta.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("expires_at = %s, want %s", meta.ExpiresAt, expiresAt)
	}
	if meta.ClientID != "client-id" || meta.ClientSecret != "client-secret" || meta.AuthMethod != "builder_id" {
		t.Fatalf("client metadata not parsed: %+v", meta)
	}
}

func TestKiroMetadataFreshness(t *testing.T) {
	now := time.Date(2026, 5, 19, 6, 0, 0, 0, time.UTC)
	meta := KiroMetadata{
		AccessToken: "access",
		ExpiresAt:   now.Add(10 * time.Minute),
	}
	if !meta.AccessTokenFresh(now, time.Minute) {
		t.Fatal("expected token to be fresh")
	}
	if meta.AccessTokenFresh(now, 15*time.Minute) {
		t.Fatal("expected token to need refresh within lead window")
	}
}

func TestRedactKiroMetadata(t *testing.T) {
	redacted := RedactKiroMetadata(map[string]any{
		"type":          KiroProvider,
		"refresh_token": "refresh",
		"accessToken":   "access",
		"client_secret": "secret",
		"label":         "safe",
	})
	if redacted["refresh_token"] != "[redacted]" || redacted["accessToken"] != "[redacted]" || redacted["client_secret"] != "[redacted]" {
		t.Fatalf("secrets were not redacted: %+v", redacted)
	}
	if redacted["label"] != "safe" {
		t.Fatalf("label = %v, want safe", redacted["label"])
	}
}

func TestIsKiroTokenAuthError(t *testing.T) {
	cases := []struct {
		status int
		body   string
		want   bool
	}{
		{status: 401, body: "", want: true},
		{status: 403, body: "invalid bearer token", want: true},
		{status: 403, body: "quota exceeded", want: false},
		{status: 500, body: "invalid bearer token", want: false},
	}
	for _, tc := range cases {
		if got := IsKiroTokenAuthError(tc.status, tc.body); got != tc.want {
			t.Fatalf("IsKiroTokenAuthError(%d, %q) = %v, want %v", tc.status, tc.body, got, tc.want)
		}
	}
}
