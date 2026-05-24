package executor

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
)

func TestKiroExecutorRefreshRejectsMissingRefreshToken(t *testing.T) {
	executor := NewKiroExecutor(nil)
	_, err := executor.Refresh(context.Background(), &cliproxyauth.Auth{
		ID:       "kiro-1",
		Provider: "kiro",
		Metadata: map[string]any{"type": "kiro"},
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestKiroExecutorRefreshPersistsTokenMetadata(t *testing.T) {
	now := time.Date(2026, 5, 19, 7, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["refreshToken"] != "refresh-old" {
			t.Fatalf("refreshToken = %v, want refresh-old", body["refreshToken"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"accessToken":"access-new","refreshToken":"refresh-new","expiresIn":3600,"profileArn":"arn:aws:codewhisperer:us-east-1:123:profile/test"}`))
	}))
	defer server.Close()

	executor := NewKiroExecutor(nil)
	executor.refreshEndpoint = server.URL
	executor.now = func() time.Time { return now }

	auth := &cliproxyauth.Auth{
		ID:       "kiro-1",
		Provider: "kiro",
		Metadata: map[string]any{
			"type":          "kiro",
			"refresh_token": "refresh-old",
			"region":        "us-east-1",
		},
	}
	updated, err := executor.Refresh(context.Background(), auth)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if updated.Metadata["access_token"] != "access-new" {
		t.Fatalf("access_token = %v, want access-new", updated.Metadata["access_token"])
	}
	if updated.Metadata["refresh_token"] != "refresh-new" {
		t.Fatalf("refresh_token = %v, want refresh-new", updated.Metadata["refresh_token"])
	}
	if updated.Metadata["profile_arn"] == "" {
		t.Fatalf("profile_arn was not persisted")
	}
	if updated.Metadata["expires_at"] != now.Add(time.Hour).Format(time.RFC3339) {
		t.Fatalf("expires_at = %v", updated.Metadata["expires_at"])
	}
}

func TestKiroExecutorRefreshUsesOIDCWhenClientMetadataPresent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["clientId"] != "client-id" || body["clientSecret"] != "client-secret" || body["grantType"] != "refresh_token" {
			t.Fatalf("unexpected body: %+v", body)
		}
		_, _ = w.Write([]byte(`{"accessToken":"access-new","expiresIn":3600}`))
	}))
	defer server.Close()

	executor := NewKiroExecutor(nil)
	executor.oidcEndpoint = func(region string) string {
		if region != "eu-west-1" {
			t.Fatalf("region = %q, want eu-west-1", region)
		}
		return server.URL
	}

	_, err := executor.Refresh(context.Background(), &cliproxyauth.Auth{
		ID:       "kiro-oidc",
		Provider: "kiro",
		Metadata: map[string]any{
			"type":          "kiro",
			"refresh_token": "refresh",
			"client_id":     "client-id",
			"client_secret": "client-secret",
			"region":        "eu-west-1",
		},
	})
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
}

func TestKiroExecutorConcurrentRefreshDedupes(t *testing.T) {
	var requests atomic.Int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		<-release
		_, _ = w.Write([]byte(`{"accessToken":"access-new","expiresIn":3600}`))
	}))
	defer server.Close()

	executor := NewKiroExecutor(nil)
	executor.refreshEndpoint = server.URL
	auth := &cliproxyauth.Auth{
		ID:       "kiro-1",
		Provider: "kiro",
		Metadata: map[string]any{"type": "kiro", "refresh_token": "refresh"},
	}

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := executor.Refresh(context.Background(), auth)
			errs <- err
		}()
	}
	for requests.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("Refresh error: %v", err)
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want 1", requests.Load())
	}
}

func TestKiroExecutorShouldRefreshAfterError(t *testing.T) {
	executor := NewKiroExecutor(nil)
	if !executor.ShouldRefreshAfterError(statusErr{code: http.StatusUnauthorized, msg: "unauthorized"}) {
		t.Fatal("expected 401 to refresh")
	}
	if !executor.ShouldRefreshAfterError(statusErr{code: http.StatusForbidden, msg: "invalid bearer token"}) {
		t.Fatal("expected token-related 403 to refresh")
	}
	if executor.ShouldRefreshAfterError(statusErr{code: http.StatusForbidden, msg: "quota exceeded"}) {
		t.Fatal("did not expect quota 403 to refresh")
	}
}

func TestKiroExecutorPrepareRequestInjectsHeaders(t *testing.T) {
	executor := NewKiroExecutor(nil)
	req := httptest.NewRequest(http.MethodPost, "https://example.com", nil)
	err := executor.PrepareRequest(req, &cliproxyauth.Auth{
		ID:       "kiro-1",
		Provider: "kiro",
		Metadata: map[string]any{
			"type":          "kiro",
			"refresh_token": "refresh",
			"access_token":  "access",
		},
	})
	if err != nil {
		t.Fatalf("PrepareRequest: %v", err)
	}
	if req.Header.Get("Authorization") != "Bearer access" {
		t.Fatalf("Authorization = %q", req.Header.Get("Authorization"))
	}
	if req.Header.Get("Accept") != "application/vnd.amazon.eventstream" {
		t.Fatalf("Accept = %q", req.Header.Get("Accept"))
	}
}

func TestStreamKiroEventStreamEmitsOpenAIChunks(t *testing.T) {
	var stream bytes.Buffer
	for _, frame := range [][]byte{
		kiroTestFrame(t, "assistantResponseEvent", []byte(`{"content":"hi"}`)),
		kiroTestFrame(t, "reasoningContentEvent", []byte(`{"text":"why"}`)),
		kiroTestFrame(t, "codeEvent", []byte(`{"content":"fmt.Println(1)"}`)),
		kiroTestFrame(t, "toolUseEvent", []byte(`{"toolUseId":"call_1","name":"lookup","input":{"q":"x"}}`)),
		kiroTestFrame(t, "messageStopEvent", []byte(`{}`)),
		kiroTestFrame(t, "usageEvent", []byte(`{"inputTokens":10,"outputTokens":4,"reasoningTokens":2}`)),
	} {
		stream.Write(frame)
	}

	ch := make(chan cliproxyexecutor.StreamChunk)
	go func() {
		defer close(ch)
		streamKiroEventStream(context.Background(), nil, bytes.NewReader(stream.Bytes()), ch, "claude-sonnet-4.5", cliproxyexecutor.Options{}, nil, nil)
	}()

	var chunks []string
	for chunk := range ch {
		if chunk.Err != nil {
			t.Fatalf("stream chunk error: %v", chunk.Err)
		}
		chunks = append(chunks, string(chunk.Payload))
	}
	joined := strings.Join(chunks, "\n")
	for _, want := range []string{
		`"content":"hi"`,
		`"reasoning_content":"why"`,
		`"content":"fmt.Println(1)"`,
		`"tool_calls"`,
		`"name":"lookup"`,
		`"reasoning_tokens":2`,
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("stream output missing %q:\n%s", want, joined)
		}
	}
}

func TestStreamKiroEventStreamErrorsOnCloseBeforeFirstPayload(t *testing.T) {
	ch := make(chan cliproxyexecutor.StreamChunk)
	go func() {
		defer close(ch)
		streamKiroEventStream(context.Background(), nil, strings.NewReader(""), ch, "claude-sonnet-4.5", cliproxyexecutor.Options{}, nil, nil)
	}()

	chunk, ok := <-ch
	if !ok {
		t.Fatal("expected upstream close error chunk")
	}
	if chunk.Err == nil {
		t.Fatalf("expected error before first payload, got payload %q", string(chunk.Payload))
	}
	statusErr, ok := chunk.Err.(cliproxyexecutor.StatusError)
	if !ok || statusErr.StatusCode() != http.StatusBadGateway {
		t.Fatalf("error = %T %v, want 502 status error", chunk.Err, chunk.Err)
	}
	if _, ok := <-ch; ok {
		t.Fatal("expected stream to close after upstream close error")
	}
}

func TestStreamKiroEventStreamEmitsPayloadThenLaterError(t *testing.T) {
	var stream bytes.Buffer
	stream.Write(kiroTestFrame(t, "assistantResponseEvent", []byte(`{"content":"hi"}`)))
	stream.Write([]byte{0x00, 0x00, 0x00})

	ch := make(chan cliproxyexecutor.StreamChunk)
	go func() {
		defer close(ch)
		streamKiroEventStream(context.Background(), nil, bytes.NewReader(stream.Bytes()), ch, "claude-sonnet-4.5", cliproxyexecutor.Options{}, nil, nil)
	}()

	first, ok := <-ch
	if !ok {
		t.Fatal("expected first payload chunk")
	}
	if first.Err != nil {
		t.Fatalf("first chunk error = %v", first.Err)
	}
	if !strings.Contains(string(first.Payload), `"content":"hi"`) {
		t.Fatalf("first payload = %s", first.Payload)
	}

	second, ok := <-ch
	if !ok {
		t.Fatal("expected later decoder error chunk")
	}
	if second.Err == nil {
		t.Fatalf("expected later decoder error, got payload %q", string(second.Payload))
	}
}

func TestDecodeKiroNonStreamAggregatesEvents(t *testing.T) {
	var stream bytes.Buffer
	for _, frame := range [][]byte{
		kiroTestFrame(t, "assistantResponseEvent", []byte(`{"content":"hello "}`)),
		kiroTestFrame(t, "codeEvent", []byte(`{"content":"world"}`)),
		kiroTestFrame(t, "reasoningContentEvent", []byte(`{"text":"because"}`)),
		kiroTestFrame(t, "toolUseEvent", []byte(`{"toolUseId":"call_1","name":"lookup","input":{"q":"x"}}`)),
		kiroTestFrame(t, "usageEvent", []byte(`{"inputTokens":10,"outputTokens":3,"reasoningTokens":1}`)),
	} {
		stream.Write(frame)
	}

	body, detail, usageSeen, err := decodeKiroNonStream(context.Background(), nil, bytes.NewReader(stream.Bytes()), "claude-sonnet-4.5")
	if err != nil {
		t.Fatalf("decodeKiroNonStream: %v", err)
	}
	if !usageSeen || detail.InputTokens != 10 || detail.OutputTokens != 3 || detail.ReasoningTokens != 1 {
		t.Fatalf("usage = %+v, seen=%t", detail, usageSeen)
	}

	var response map[string]any
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	choices := response["choices"].([]any)
	message := choices[0].(map[string]any)["message"].(map[string]any)
	if message["content"] != "hello world" {
		t.Fatalf("content = %v, want hello world", message["content"])
	}
	if message["reasoning_content"] != "because" {
		t.Fatalf("reasoning_content = %v, want because", message["reasoning_content"])
	}
	if toolCalls, _ := message["tool_calls"].([]any); len(toolCalls) != 1 {
		t.Fatalf("tool_calls length = %d, want 1", len(toolCalls))
	}
}

func TestKiroListAvailableModelsRefreshesAfterTokenError(t *testing.T) {
	var listRequests atomic.Int32
	var refreshRequests atomic.Int32
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Host == "q.us-east-1.amazonaws.com":
			call := listRequests.Add(1)
			if call == 1 {
				if got := req.Header.Get("Authorization"); got != "Bearer access-old" {
					return nil, fmt.Errorf("first catalog Authorization = %q", got)
				}
				return testHTTPResponse(http.StatusForbidden, `{"message":"invalid bearer token"}`), nil
			}
			if got := req.Header.Get("Authorization"); got != "Bearer access-new" {
				return nil, fmt.Errorf("retry catalog Authorization = %q", got)
			}
			return testHTTPResponse(http.StatusOK, `{"models":[{"modelId":"claude-sonnet-4.5","modelName":"Claude Sonnet 4.5","description":"Sonnet","rateMultiplier":1.5,"tokenLimits":{"maxInputTokens":12345}}]}`), nil
		case req.URL.Host == "prod.us-east-1.auth.desktop.kiro.dev":
			refreshRequests.Add(1)
			return testHTTPResponse(http.StatusOK, `{"accessToken":"access-new","refreshToken":"refresh-new","expiresIn":3600}`), nil
		default:
			return nil, fmt.Errorf("unexpected request URL: %s", req.URL.String())
		}
	})
	ctx := context.WithValue(context.Background(), "cliproxy.roundtripper", http.RoundTripper(rt))
	executor := NewKiroExecutor(nil)
	auth := &cliproxyauth.Auth{
		ID:       "kiro-models",
		Provider: "kiro",
		Metadata: map[string]any{
			"type":          "kiro",
			"refresh_token": "refresh-old",
			"access_token":  "access-old",
			"expires_at":    time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
			"region":        "us-east-1",
		},
	}

	models, updated, err := executor.ListAvailableModels(ctx, auth, true)
	if err != nil {
		t.Fatalf("ListAvailableModels: %v", err)
	}
	if listRequests.Load() != 2 {
		t.Fatalf("catalog requests = %d, want 2", listRequests.Load())
	}
	if refreshRequests.Load() != 1 {
		t.Fatalf("refresh requests = %d, want 1", refreshRequests.Load())
	}
	if updated.Metadata["access_token"] != "access-new" || updated.Metadata["refresh_token"] != "refresh-new" {
		t.Fatalf("updated metadata = %+v", updated.Metadata)
	}
	seen := map[string]*ModelInfoAlias{}
	for _, model := range models {
		if model == nil {
			continue
		}
		seen[model.ID] = &ModelInfoAlias{upstream: model.UpstreamModelID, contextLength: model.ContextLength}
	}
	for _, id := range []string{"claude-sonnet-4.5", "claude-sonnet-4.5-thinking", "claude-sonnet-4.5-agentic", "claude-sonnet-4.5-thinking-agentic"} {
		model := seen[id]
		if model == nil {
			t.Fatalf("missing model variant %q in %+v", id, models)
		}
		if model.upstream != "claude-sonnet-4.5" {
			t.Fatalf("%s upstream = %q", id, model.upstream)
		}
		if model.contextLength != 12345 {
			t.Fatalf("%s context length = %d", id, model.contextLength)
		}
	}
}

var _ cliproxyexecutor.StatusError = statusErr{}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type ModelInfoAlias struct {
	upstream      string
	contextLength int
}

func testHTTPResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func kiroTestFrame(t *testing.T, eventType string, payload []byte) []byte {
	t.Helper()
	headers := map[string]string{
		":message-type": "event",
		":event-type":   eventType,
	}
	var headerBytes []byte
	for name, value := range headers {
		headerBytes = append(headerBytes, byte(len(name)))
		headerBytes = append(headerBytes, []byte(name)...)
		headerBytes = append(headerBytes, byte(7))
		var length [2]byte
		binary.BigEndian.PutUint16(length[:], uint16(len(value)))
		headerBytes = append(headerBytes, length[:]...)
		headerBytes = append(headerBytes, []byte(value)...)
	}

	totalLen := 12 + len(headerBytes) + len(payload) + 4
	frame := make([]byte, totalLen)
	binary.BigEndian.PutUint32(frame[0:4], uint32(totalLen))
	binary.BigEndian.PutUint32(frame[4:8], uint32(len(headerBytes)))
	binary.BigEndian.PutUint32(frame[8:12], crc32.ChecksumIEEE(frame[:8]))
	copy(frame[12:], headerBytes)
	copy(frame[12+len(headerBytes):], payload)
	binary.BigEndian.PutUint32(frame[len(frame)-4:], crc32.ChecksumIEEE(frame[:len(frame)-4]))
	return frame
}
