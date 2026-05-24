package auth

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
)

type refreshRetryMemoryStore struct {
	mu    sync.Mutex
	items map[string]*Auth
}

func (s *refreshRetryMemoryStore) List(context.Context) ([]*Auth, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Auth, 0, len(s.items))
	for _, item := range s.items {
		out = append(out, item.Clone())
	}
	return out, nil
}

func (s *refreshRetryMemoryStore) Save(_ context.Context, auth *Auth) (string, error) {
	if auth == nil {
		return "", errors.New("nil auth")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.items == nil {
		s.items = make(map[string]*Auth)
	}
	s.items[auth.ID] = auth.Clone()
	return auth.ID, nil
}

func (s *refreshRetryMemoryStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, id)
	return nil
}

type refreshRetryStatusErr struct {
	status int
	msg    string
}

func (e refreshRetryStatusErr) Error() string {
	if e.msg != "" {
		return e.msg
	}
	return http.StatusText(e.status)
}

func (e refreshRetryStatusErr) StatusCode() int { return e.status }

type refreshRetryExecutor struct {
	executeCalls int
	refreshCalls int
}

func (e *refreshRetryExecutor) Identifier() string { return KiroProvider }

func (e *refreshRetryExecutor) Execute(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	e.executeCalls++
	if auth.Metadata["access_token"] != "access-new" {
		return cliproxyexecutor.Response{}, refreshRetryStatusErr{status: http.StatusUnauthorized, msg: "invalid bearer token"}
	}
	return cliproxyexecutor.Response{Payload: []byte(`{"ok":true}`)}, nil
}

func (e *refreshRetryExecutor) ExecuteStream(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *refreshRetryExecutor) Refresh(_ context.Context, auth *Auth) (*Auth, error) {
	e.refreshCalls++
	updated := auth.Clone()
	updated.Metadata["access_token"] = "access-new"
	updated.Metadata["refresh_token"] = "refresh-new"
	return updated, nil
}

func (e *refreshRetryExecutor) CountTokens(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *refreshRetryExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *refreshRetryExecutor) ShouldRefreshAfterError(err error) bool {
	statusErr, ok := err.(cliproxyexecutor.StatusError)
	return ok && statusErr.StatusCode() == http.StatusUnauthorized
}

func TestManagerExecuteRefreshesAndPersistsOnTokenAuthError(t *testing.T) {
	store := &refreshRetryMemoryStore{}
	manager := NewManager(store, nil, nil)
	executor := &refreshRetryExecutor{}
	manager.RegisterExecutor(executor)

	auth := &Auth{
		ID:        "kiro-1",
		Provider:  KiroProvider,
		Status:    StatusActive,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
		Metadata: map[string]any{
			"type":          KiroProvider,
			"refresh_token": "refresh-old",
			"access_token":  "access-old",
		},
	}
	registry.GetGlobalRegistry().RegisterClient(auth.ID, KiroProvider, []*registry.ModelInfo{{ID: "claude-sonnet-4.5"}})
	t.Cleanup(func() {
		registry.GetGlobalRegistry().UnregisterClient(auth.ID)
	})
	if _, err := manager.Register(context.Background(), auth); err != nil {
		t.Fatalf("Register: %v", err)
	}

	resp, err := manager.Execute(context.Background(), []string{KiroProvider}, cliproxyexecutor.Request{Model: "claude-sonnet-4.5"}, cliproxyexecutor.Options{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if string(resp.Payload) != `{"ok":true}` {
		t.Fatalf("payload = %s", resp.Payload)
	}
	if executor.refreshCalls != 1 {
		t.Fatalf("refreshCalls = %d, want 1", executor.refreshCalls)
	}
	if executor.executeCalls != 2 {
		t.Fatalf("executeCalls = %d, want 2", executor.executeCalls)
	}

	store.mu.Lock()
	persisted := store.items["kiro-1"].Clone()
	store.mu.Unlock()
	if persisted.Metadata["access_token"] != "access-new" || persisted.Metadata["refresh_token"] != "refresh-new" {
		t.Fatalf("persisted metadata = %+v", persisted.Metadata)
	}
}

type streamRefreshRetryExecutor struct {
	status       int
	msg          string
	streamCalls  int
	refreshCalls int
	accessTokens []string
}

func (e *streamRefreshRetryExecutor) Identifier() string { return KiroProvider }

func (e *streamRefreshRetryExecutor) Execute(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *streamRefreshRetryExecutor) ExecuteStream(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	e.streamCalls++
	accessToken := ""
	if auth != nil && auth.Metadata != nil {
		accessToken, _ = auth.Metadata["access_token"].(string)
	}
	e.accessTokens = append(e.accessTokens, accessToken)
	if accessToken != "access-new" {
		return nil, refreshRetryStatusErr{status: e.status, msg: e.msg}
	}
	ch := make(chan cliproxyexecutor.StreamChunk, 1)
	ch <- cliproxyexecutor.StreamChunk{Payload: []byte("stream-ok")}
	close(ch)
	return &cliproxyexecutor.StreamResult{Chunks: ch}, nil
}

func (e *streamRefreshRetryExecutor) Refresh(_ context.Context, auth *Auth) (*Auth, error) {
	e.refreshCalls++
	updated := auth.Clone()
	updated.Metadata["access_token"] = "access-new"
	updated.Metadata["refresh_token"] = "refresh-new"
	return updated, nil
}

func (e *streamRefreshRetryExecutor) CountTokens(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *streamRefreshRetryExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *streamRefreshRetryExecutor) ShouldRefreshAfterError(err error) bool {
	statusErr, ok := err.(cliproxyexecutor.StatusError)
	return ok && IsKiroTokenAuthError(statusErr.StatusCode(), err.Error())
}

func TestManagerExecuteStreamRefreshesAndPersistsOnKiroTokenAuthError(t *testing.T) {
	cases := []struct {
		name   string
		status int
		msg    string
	}{
		{name: "401", status: http.StatusUnauthorized, msg: "unauthorized"},
		{name: "403-token", status: http.StatusForbidden, msg: "invalid bearer token"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			const model = "claude-sonnet-4.5"
			authID := "kiro-stream-refresh-" + tc.name
			store := &refreshRetryMemoryStore{}
			manager := NewManager(store, nil, nil)
			executor := &streamRefreshRetryExecutor{status: tc.status, msg: tc.msg}
			manager.RegisterExecutor(executor)
			registry.GetGlobalRegistry().RegisterClient(authID, KiroProvider, []*registry.ModelInfo{{ID: model}})
			t.Cleanup(func() { registry.GetGlobalRegistry().UnregisterClient(authID) })

			if _, err := manager.Register(context.Background(), &Auth{
				ID:        authID,
				Provider:  KiroProvider,
				Status:    StatusActive,
				CreatedAt: time.Now().UTC(),
				UpdatedAt: time.Now().UTC(),
				Metadata: map[string]any{
					"type":          KiroProvider,
					"refresh_token": "refresh-old",
					"access_token":  "access-old",
				},
			}); err != nil {
				t.Fatalf("Register: %v", err)
			}

			streamResult, err := manager.ExecuteStream(context.Background(), []string{KiroProvider}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
			if err != nil {
				t.Fatalf("ExecuteStream: %v", err)
			}
			payload := collectStreamPayload(t, streamResult)
			if string(payload) != "stream-ok" {
				t.Fatalf("payload = %q, want stream-ok", string(payload))
			}
			if executor.refreshCalls != 1 {
				t.Fatalf("refreshCalls = %d, want 1", executor.refreshCalls)
			}
			if executor.streamCalls != 2 {
				t.Fatalf("streamCalls = %d, want 2", executor.streamCalls)
			}
			if len(executor.accessTokens) != 2 || executor.accessTokens[0] != "access-old" || executor.accessTokens[1] != "access-new" {
				t.Fatalf("access tokens = %v, want [access-old access-new]", executor.accessTokens)
			}

			store.mu.Lock()
			persisted := store.items[authID].Clone()
			store.mu.Unlock()
			if persisted.Metadata["access_token"] != "access-new" || persisted.Metadata["refresh_token"] != "refresh-new" {
				t.Fatalf("persisted metadata = %+v", persisted.Metadata)
			}
		})
	}
}

type streamBoundaryExecutor struct {
	calls []string
}

func (e *streamBoundaryExecutor) Identifier() string { return KiroProvider }

func (e *streamBoundaryExecutor) Execute(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *streamBoundaryExecutor) ExecuteStream(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	authID := ""
	if auth != nil {
		authID = auth.ID
	}
	e.calls = append(e.calls, authID)
	ch := make(chan cliproxyexecutor.StreamChunk, 2)
	switch authID {
	case "kiro-a-close":
		close(ch)
	case "kiro-a-error":
		ch <- cliproxyexecutor.StreamChunk{Err: errors.New("upstream closed before payload")}
		close(ch)
	case "kiro-a-after-payload":
		ch <- cliproxyexecutor.StreamChunk{Payload: []byte("first-payload")}
		ch <- cliproxyexecutor.StreamChunk{Err: errors.New("upstream reset after payload")}
		close(ch)
	default:
		ch <- cliproxyexecutor.StreamChunk{Payload: []byte("fallback-payload")}
		close(ch)
	}
	return &cliproxyexecutor.StreamResult{Chunks: ch}, nil
}

func (e *streamBoundaryExecutor) Refresh(_ context.Context, auth *Auth) (*Auth, error) {
	return auth, nil
}

func (e *streamBoundaryExecutor) CountTokens(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func (e *streamBoundaryExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, refreshRetryStatusErr{status: http.StatusNotImplemented}
}

func TestManagerExecuteStreamFallsBackBeforeFirstPayload(t *testing.T) {
	cases := []struct {
		name        string
		firstAuthID string
	}{
		{name: "close", firstAuthID: "kiro-a-close"},
		{name: "error", firstAuthID: "kiro-a-error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			const model = "claude-sonnet-4.5"
			manager := NewManager(nil, nil, nil)
			executor := &streamBoundaryExecutor{}
			manager.RegisterExecutor(executor)
			registerKiroStreamTestAuth(t, manager, tc.firstAuthID, model, "10")
			registerKiroStreamTestAuth(t, manager, "kiro-b-"+tc.name, model, "0")

			streamResult, err := manager.ExecuteStream(context.Background(), []string{KiroProvider}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
			if err != nil {
				t.Fatalf("ExecuteStream: %v", err)
			}
			payload := collectStreamPayload(t, streamResult)
			if string(payload) != "fallback-payload" {
				t.Fatalf("payload = %q, want fallback-payload", string(payload))
			}
			if len(executor.calls) != 2 || executor.calls[0] != tc.firstAuthID {
				t.Fatalf("stream calls = %v, want first auth then fallback", executor.calls)
			}
		})
	}
}

func TestManagerExecuteStreamDoesNotFallbackAfterFirstPayload(t *testing.T) {
	const model = "claude-sonnet-4.5"
	manager := NewManager(nil, nil, nil)
	executor := &streamBoundaryExecutor{}
	manager.RegisterExecutor(executor)
	registerKiroStreamTestAuth(t, manager, "kiro-a-after-payload", model, "10")
	registerKiroStreamTestAuth(t, manager, "kiro-b-after-payload", model, "0")

	streamResult, err := manager.ExecuteStream(context.Background(), []string{KiroProvider}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	if err != nil {
		t.Fatalf("ExecuteStream: %v", err)
	}
	var payload []byte
	var sawErr bool
	for chunk := range streamResult.Chunks {
		if chunk.Err != nil {
			sawErr = true
			continue
		}
		payload = append(payload, chunk.Payload...)
	}
	if string(payload) != "first-payload" {
		t.Fatalf("payload = %q, want first-payload", string(payload))
	}
	if !sawErr {
		t.Fatal("expected post-payload stream error to be forwarded")
	}
	if len(executor.calls) != 1 || executor.calls[0] != "kiro-a-after-payload" {
		t.Fatalf("stream calls = %v, want only first auth", executor.calls)
	}
}

func registerKiroStreamTestAuth(t *testing.T, manager *Manager, authID, model, priority string) {
	t.Helper()
	registry.GetGlobalRegistry().RegisterClient(authID, KiroProvider, []*registry.ModelInfo{{ID: model}})
	t.Cleanup(func() { registry.GetGlobalRegistry().UnregisterClient(authID) })
	if _, err := manager.Register(context.Background(), &Auth{
		ID:         authID,
		Provider:   KiroProvider,
		Status:     StatusActive,
		Attributes: map[string]string{"priority": priority},
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
		Metadata: map[string]any{
			"type":          KiroProvider,
			"refresh_token": "refresh",
			"access_token":  "access",
		},
	}); err != nil {
		t.Fatalf("Register %s: %v", authID, err)
	}
}

func collectStreamPayload(t *testing.T, streamResult *cliproxyexecutor.StreamResult) []byte {
	t.Helper()
	if streamResult == nil {
		t.Fatal("stream result is nil")
	}
	var payload []byte
	for chunk := range streamResult.Chunks {
		if chunk.Err != nil {
			t.Fatalf("unexpected stream error: %v", chunk.Err)
		}
		payload = append(payload, chunk.Payload...)
	}
	return payload
}
