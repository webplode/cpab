package watcher

import (
	"testing"
	"time"
)

func TestSynthesizeAuthFromDBRowUsesTopLevelProxyURL(t *testing.T) {
	auth := synthesizeAuthFromDBRow(
		"/tmp/auth",
		"kiro-auth",
		"socks5://127.0.0.1:1080",
		[]byte(`{"type":"kiro","label":"Kiro","refresh_token":"refresh","region":"us-east-1","proxy_url":"http://metadata-proxy:8080"}`),
		0,
		time.Now().UTC(),
		time.Now().UTC(),
	)
	if auth == nil {
		t.Fatal("expected auth")
	}
	if auth.ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("proxy url = %q, want top-level proxy", auth.ProxyURL)
	}
	if auth.Label != "Kiro" {
		t.Fatalf("label = %q, want content label", auth.Label)
	}
}

func TestSynthesizeAuthFromDBRowFallsBackToMetadataProxyURL(t *testing.T) {
	auth := synthesizeAuthFromDBRow(
		"/tmp/auth",
		"kiro-auth",
		"",
		[]byte(`{"type":"kiro","label":"Kiro","refresh_token":"refresh","region":"us-east-1","proxy_url":"http://metadata-proxy:8080"}`),
		0,
		time.Now().UTC(),
		time.Now().UTC(),
	)
	if auth == nil {
		t.Fatal("expected auth")
	}
	if auth.ProxyURL != "http://metadata-proxy:8080" {
		t.Fatalf("proxy url = %q, want metadata proxy", auth.ProxyURL)
	}
}
