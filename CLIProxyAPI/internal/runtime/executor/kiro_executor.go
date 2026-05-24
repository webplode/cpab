package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/runtime/aws/eventstream"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/runtime/executor/helps"
	kirotranslator "github.com/router-for-me/CLIProxyAPI/v7/internal/translator/openai/kiro"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/usage"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
)

const (
	kiroDefaultRegion         = "us-east-1"
	kiroSocialRefreshEndpoint = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"
	kiroRefreshLead           = 5 * time.Minute
)

func init() {
	cliproxyauth.RegisterRefreshLeadProvider(cliproxyauth.KiroProvider, func() *time.Duration {
		lead := kiroRefreshLead
		return &lead
	})
}

// KiroExecutor is the first-class executor for Kiro/AWS CodeWhisperer.
type KiroExecutor struct {
	cfg *config.Config

	refreshEndpoint string
	oidcEndpoint    func(region string) string
	now             func() time.Time

	refreshMu    sync.Mutex
	refreshCalls map[string]*kiroRefreshCall
}

type kiroRefreshCall struct {
	wg   sync.WaitGroup
	auth *cliproxyauth.Auth
	err  error
}

func NewKiroExecutor(cfg *config.Config) *KiroExecutor {
	return &KiroExecutor{
		cfg:             cfg,
		refreshEndpoint: kiroSocialRefreshEndpoint,
		oidcEndpoint: func(region string) string {
			region = strings.TrimSpace(region)
			if region == "" {
				region = kiroDefaultRegion
			}
			return fmt.Sprintf("https://oidc.%s.amazonaws.com/token", region)
		},
		now: time.Now,
	}
}

func (e *KiroExecutor) Identifier() string { return cliproxyauth.KiroProvider }

func (e *KiroExecutor) PrepareRequest(req *http.Request, auth *cliproxyauth.Auth) error {
	if req == nil {
		return nil
	}
	meta, err := cliproxyauth.ParseKiroMetadata(auth)
	if err != nil {
		return err
	}
	if strings.TrimSpace(meta.AccessToken) == "" {
		return statusErr{code: http.StatusUnauthorized, msg: "kiro executor: missing access token"}
	}

	req.Header.Set("Authorization", "Bearer "+meta.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/vnd.amazon.eventstream")
	req.Header.Set("X-Amz-Target", "AmazonCodeWhispererStreamingService.GenerateAssistantResponse")
	req.Header.Set("User-Agent", "AWS-SDK-Go/1.0.0 kiro-ide/1.0.0")
	req.Header.Set("X-Amz-User-Agent", "aws-sdk-go/1.0.0 kiro-ide/1.0.0")
	req.Header.Set("Amz-Sdk-Request", "attempt=1; max=3")
	req.Header.Set("Amz-Sdk-Invocation-Id", uuid.NewString())
	return nil
}

func (e *KiroExecutor) HttpRequest(ctx context.Context, auth *cliproxyauth.Auth, req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, fmt.Errorf("kiro executor: request is nil")
	}
	if ctx == nil {
		ctx = req.Context()
	}
	httpReq := req.WithContext(ctx)
	if err := e.PrepareRequest(httpReq, auth); err != nil {
		return nil, err
	}
	client := helps.NewProxyAwareHTTPClient(ctx, e.cfg, auth, 0)
	return client.Do(httpReq)
}

func (e *KiroExecutor) Execute(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (respOut cliproxyexecutor.Response, err error) {
	body, baseModel, err := e.buildRequestBody(auth, req, opts, false)
	if err != nil {
		return respOut, err
	}

	reporter := helps.NewUsageReporter(ctx, e.Identifier(), baseModel, auth)
	defer reporter.TrackFailure(ctx, &err)

	resp, err := e.doGenerateAssistantRequest(ctx, auth, body, opts)
	if err != nil {
		return respOut, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		helps.AppendAPIResponseChunk(ctx, e.cfg, respBody)
		err = statusErr{code: resp.StatusCode, msg: safeKiroHTTPError(resp.StatusCode, respBody)}
		return respOut, err
	}

	openAIResponse, detail, usageSeen, err := decodeKiroNonStream(ctx, e.cfg, resp.Body, req.Model)
	if err != nil {
		helps.RecordAPIResponseError(ctx, e.cfg, err)
		reporter.PublishFailure(ctx, err)
		return respOut, err
	}
	if usageSeen {
		reporter.Publish(ctx, detail)
	} else {
		reporter.EnsurePublished(ctx)
	}

	var param any
	out := sdktranslator.TranslateNonStream(ctx, sdktranslator.FormatOpenAI, opts.SourceFormat, req.Model, opts.OriginalRequest, body, openAIResponse, &param)
	respOut = cliproxyexecutor.Response{Payload: out, Headers: resp.Header.Clone()}
	return respOut, nil
}

func (e *KiroExecutor) ExecuteStream(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (_ *cliproxyexecutor.StreamResult, err error) {
	body, baseModel, err := e.buildRequestBody(auth, req, opts, true)
	if err != nil {
		return nil, err
	}

	reporter := helps.NewUsageReporter(ctx, e.Identifier(), baseModel, auth)
	defer reporter.TrackFailure(ctx, &err)

	resp, err := e.doGenerateAssistantRequest(ctx, auth, body, opts)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		helps.AppendAPIResponseChunk(ctx, e.cfg, body)
		_ = resp.Body.Close()
		err = statusErr{code: resp.StatusCode, msg: safeKiroHTTPError(resp.StatusCode, body)}
		return nil, err
	}

	ch := make(chan cliproxyexecutor.StreamChunk)
	go func() {
		defer close(ch)
		defer resp.Body.Close()
		streamKiroEventStream(ctx, e.cfg, resp.Body, ch, req.Model, opts, body, reporter)
	}()
	return &cliproxyexecutor.StreamResult{Headers: resp.Header.Clone(), Chunks: ch}, nil
}

func (e *KiroExecutor) buildRequestBody(auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options, stream bool) ([]byte, string, error) {
	variant := kirotranslator.ResolveModel(req.Model)
	if strings.TrimSpace(variant.Upstream) == "" {
		return nil, "", fmt.Errorf("kiro executor: model is required")
	}

	from := opts.SourceFormat
	if from == "" {
		from = sdktranslator.FormatOpenAI
	}
	to := sdktranslator.FormatKiro
	originalPayloadSource := req.Payload
	if len(opts.OriginalRequest) > 0 {
		originalPayloadSource = opts.OriginalRequest
	}
	originalTranslated := sdktranslator.TranslateRequest(from, to, req.Model, originalPayloadSource, stream)
	body := sdktranslator.TranslateRequest(from, to, req.Model, req.Payload, stream)
	if err := kirotranslator.TranslationError(body); err != nil {
		return nil, "", err
	}
	if err := kirotranslator.TranslationError(originalTranslated); err != nil && len(originalPayloadSource) > 0 {
		return nil, "", err
	}

	if meta, err := cliproxyauth.ParseKiroMetadata(auth); err == nil && strings.TrimSpace(meta.ProfileARN) != "" {
		body = injectKiroProfileARN(body, meta.ProfileARN)
	}
	requestedModel := helps.PayloadRequestedModel(opts, req.Model)
	requestPath := helps.PayloadRequestPath(opts)
	body = helps.ApplyPayloadConfigWithRoot(e.cfg, variant.Upstream, to.String(), "", body, originalTranslated, requestedModel, requestPath)
	return body, variant.Upstream, nil
}

func injectKiroProfileARN(body []byte, profileARN string) []byte {
	profileARN = strings.TrimSpace(profileARN)
	if profileARN == "" || len(body) == 0 {
		return body
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return body
	}
	payload["profileArn"] = profileARN
	updated, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return updated
}

func (e *KiroExecutor) doGenerateAssistantRequest(ctx context.Context, auth *cliproxyauth.Auth, body []byte, opts cliproxyexecutor.Options) (*http.Response, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	targetURL := e.generateAssistantResponseURL(auth)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if opts.Headers != nil {
		httpReq.Header = opts.Headers.Clone()
	}
	if err := e.PrepareRequest(httpReq, auth); err != nil {
		return nil, err
	}
	var authID, authLabel, authType, authValue string
	if auth != nil {
		authID = auth.ID
		authLabel = auth.Label
		authType, authValue = auth.AccountInfo()
	}
	helps.RecordAPIRequest(ctx, e.cfg, helps.UpstreamRequestLog{
		URL:       targetURL,
		Method:    http.MethodPost,
		Headers:   httpReq.Header.Clone(),
		Body:      body,
		Provider:  e.Identifier(),
		AuthID:    authID,
		AuthLabel: authLabel,
		AuthType:  authType,
		AuthValue: authValue,
	})

	client := helps.NewProxyAwareHTTPClient(ctx, e.cfg, auth, 0)
	resp, err := client.Do(httpReq)
	if err != nil {
		helps.RecordAPIResponseError(ctx, e.cfg, err)
		return nil, err
	}
	helps.RecordAPIResponseMetadata(ctx, e.cfg, resp.StatusCode, resp.Header.Clone())
	return resp, nil
}

type kiroOpenAIStreamState struct {
	responseID       string
	created          int64
	model            string
	chunkIndex       int
	toolCallIndex    int
	seenToolIDs      map[string]int
	toolCalls        map[int]*kiroToolCallAggregate
	content          strings.Builder
	reasoning        strings.Builder
	totalContentSize int
	hasToolCalls     bool
	finishEmitted    bool
	usageSeen        bool
	usage            usage.Detail
	contextSeen      bool
	meteringSeen     bool
	contextPercent   float64
}

type kiroToolCallAggregate struct {
	ID        string
	Name      string
	Arguments strings.Builder
}

func newKiroOpenAIStreamState(model string) *kiroOpenAIStreamState {
	return &kiroOpenAIStreamState{
		responseID:  fmt.Sprintf("chatcmpl-%d", time.Now().UnixNano()),
		created:     time.Now().Unix(),
		model:       model,
		seenToolIDs: make(map[string]int),
		toolCalls:   make(map[int]*kiroToolCallAggregate),
	}
}

func streamKiroEventStream(ctx context.Context, cfg *config.Config, reader io.Reader, out chan<- cliproxyexecutor.StreamChunk, model string, opts cliproxyexecutor.Options, requestBody []byte, reporter *helps.UsageReporter) {
	if ctx == nil {
		ctx = context.Background()
	}
	decoder := eventstream.NewDecoder(reader)
	state := newKiroOpenAIStreamState(model)
	var param any
	for {
		msg, err := decoder.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				if state.chunkIndex == 0 {
					sendKiroStreamChunk(ctx, out, cliproxyexecutor.StreamChunk{Err: &cliproxyauth.Error{
						Code:       "upstream_close",
						Message:    "kiro executor: upstream stream closed before first payload",
						Retryable:  true,
						HTTPStatus: http.StatusBadGateway,
					}})
					return
				}
				break
			}
			helps.RecordAPIResponseError(ctx, cfg, err)
			if reporter != nil {
				reporter.PublishFailure(ctx, err)
			}
			sendKiroStreamChunk(ctx, out, cliproxyexecutor.StreamChunk{Err: err})
			return
		}
		helps.AppendAPIResponseChunk(ctx, cfg, msg.Payload)
		lines, detail, usageSeen, err := state.handleEvent(msg)
		if err != nil {
			helps.RecordAPIResponseError(ctx, cfg, err)
			if reporter != nil {
				reporter.PublishFailure(ctx, err)
			}
			sendKiroStreamChunk(ctx, out, cliproxyexecutor.StreamChunk{Err: err})
			return
		}
		if usageSeen && reporter != nil {
			reporter.Publish(ctx, detail)
		}
		for _, line := range lines {
			if !sendTranslatedKiroLine(ctx, out, opts, model, requestBody, line, &param) {
				return
			}
		}
	}

	for _, line := range state.closeLines() {
		if !sendTranslatedKiroLine(ctx, out, opts, model, requestBody, line, &param) {
			return
		}
	}
	if reporter != nil {
		if state.usageSeen {
			reporter.Publish(ctx, state.usage)
		} else {
			reporter.EnsurePublished(ctx)
		}
	}
}

func decodeKiroNonStream(ctx context.Context, cfg *config.Config, reader io.Reader, model string) ([]byte, usage.Detail, bool, error) {
	decoder := eventstream.NewDecoder(reader)
	state := newKiroOpenAIStreamState(model)
	for {
		msg, err := decoder.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, usage.Detail{}, false, err
		}
		helps.AppendAPIResponseChunk(ctx, cfg, msg.Payload)
		if _, _, _, err := state.handleEvent(msg); err != nil {
			return nil, usage.Detail{}, false, err
		}
	}
	return state.nonStreamResponse()
}

func (s *kiroOpenAIStreamState) handleEvent(msg eventstream.Message) ([][]byte, usage.Detail, bool, error) {
	if messageType := msg.HeaderString(":message-type"); strings.EqualFold(messageType, "exception") {
		return nil, usage.Detail{}, false, statusErr{code: http.StatusBadGateway, msg: safeKiroHTTPError(http.StatusBadGateway, msg.Payload)}
	}
	eventType := msg.HeaderString(":event-type")
	payload := map[string]any{}
	if len(bytes.TrimSpace(msg.Payload)) > 0 {
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return nil, usage.Detail{}, false, fmt.Errorf("kiro executor: decode %s payload: %w", eventType, err)
		}
	}

	switch eventType {
	case "assistantResponseEvent":
		text := eventText(payload, "assistantResponseEvent")
		if text == "" {
			return nil, usage.Detail{}, false, nil
		}
		s.content.WriteString(text)
		s.totalContentSize += len(text)
		return [][]byte{s.textChunk("content", text)}, usage.Detail{}, false, nil
	case "reasoningContentEvent":
		text := eventText(payload, "reasoningContentEvent")
		if text == "" {
			return nil, usage.Detail{}, false, nil
		}
		s.reasoning.WriteString(text)
		s.totalContentSize += len(text)
		return [][]byte{s.textChunk("reasoning_content", text)}, usage.Detail{}, false, nil
	case "codeEvent":
		text := eventText(payload, "codeEvent")
		if text == "" {
			return nil, usage.Detail{}, false, nil
		}
		s.content.WriteString(text)
		s.totalContentSize += len(text)
		return [][]byte{s.textChunk("content", text)}, usage.Detail{}, false, nil
	case "toolUseEvent":
		return s.toolUseChunks(payload)
	case "messageStopEvent":
		if line := s.finishLine(); len(line) > 0 {
			return [][]byte{line}, usage.Detail{}, false, nil
		}
		return nil, usage.Detail{}, false, nil
	case "metricsEvent", "usageEvent":
		if detail, ok := parseKiroUsage(payload, eventType); ok {
			s.usage = detail
			s.usageSeen = true
			if s.finishEmitted {
				return [][]byte{s.usageLine()}, detail, true, nil
			}
			return nil, detail, true, nil
		}
	case "contextUsageEvent":
		s.contextSeen = true
		if v, ok := floatFromAny(payload["contextUsagePercentage"]); ok {
			s.contextPercent = v
		} else if nested := nestedMap(payload, "contextUsageEvent"); nested != nil {
			if v, ok := floatFromAny(nested["contextUsagePercentage"]); ok {
				s.contextPercent = v
			}
		}
	case "meteringEvent":
		s.meteringSeen = true
	}
	return nil, usage.Detail{}, false, nil
}

func (s *kiroOpenAIStreamState) textChunk(field, text string) []byte {
	delta := map[string]any{field: text}
	if s.chunkIndex == 0 {
		delta["role"] = "assistant"
	}
	chunk := s.baseChunk([]any{map[string]any{
		"index":         0,
		"delta":         delta,
		"finish_reason": nil,
	}})
	s.chunkIndex++
	return encodeSSEData(chunk)
}

func (s *kiroOpenAIStreamState) toolUseChunks(payload map[string]any) ([][]byte, usage.Detail, bool, error) {
	raw := any(payload)
	if nested, ok := payload["toolUseEvent"]; ok {
		raw = nested
	}
	toolUses, err := normalizeToolUses(raw)
	if err != nil {
		return nil, usage.Detail{}, false, err
	}
	lines := make([][]byte, 0, len(toolUses)*2)
	for _, toolUse := range toolUses {
		toolCallID := strings.TrimSpace(stringFromAny(toolUse["toolUseId"]))
		if toolCallID == "" {
			toolCallID = "call_" + uuid.NewString()
		}
		toolName := strings.TrimSpace(stringFromAny(toolUse["name"]))
		toolIndex, exists := s.seenToolIDs[toolCallID]
		if !exists {
			toolIndex = s.toolCallIndex
			s.toolCallIndex++
			s.seenToolIDs[toolCallID] = toolIndex
			s.hasToolCalls = true
			s.toolCalls[toolIndex] = &kiroToolCallAggregate{ID: toolCallID, Name: toolName}
			delta := map[string]any{
				"tool_calls": []any{map[string]any{
					"index": toolIndex,
					"id":    toolCallID,
					"type":  "function",
					"function": map[string]any{
						"name":      toolName,
						"arguments": "",
					},
				}},
			}
			if s.chunkIndex == 0 {
				delta["role"] = "assistant"
			}
			lines = append(lines, encodeSSEData(s.baseChunk([]any{map[string]any{
				"index":         0,
				"delta":         delta,
				"finish_reason": nil,
			}})))
			s.chunkIndex++
		}

		if input, ok := toolUse["input"]; ok {
			args, err := toolArgumentsString(input)
			if err != nil {
				return nil, usage.Detail{}, false, err
			}
			if aggregate := s.toolCalls[toolIndex]; aggregate != nil {
				aggregate.Arguments.WriteString(args)
			}
			lines = append(lines, encodeSSEData(s.baseChunk([]any{map[string]any{
				"index": 0,
				"delta": map[string]any{
					"tool_calls": []any{map[string]any{
						"index": toolIndex,
						"function": map[string]any{
							"arguments": args,
						},
					}},
				},
				"finish_reason": nil,
			}})))
			s.chunkIndex++
		}
	}
	return lines, usage.Detail{}, false, nil
}

func (s *kiroOpenAIStreamState) finishLine() []byte {
	if s.finishEmitted {
		return nil
	}
	s.ensureEstimatedUsage()
	chunk := s.baseChunk([]any{map[string]any{
		"index":         0,
		"delta":         map[string]any{},
		"finish_reason": s.finishReason(),
	}})
	if s.usageSeen {
		chunk["usage"] = usageDetailMap(s.usage)
	}
	s.finishEmitted = true
	s.chunkIndex++
	return encodeSSEData(chunk)
}

func (s *kiroOpenAIStreamState) usageLine() []byte {
	return encodeSSEData(s.baseChunk([]any{}, map[string]any{"usage": usageDetailMap(s.usage)}))
}

func (s *kiroOpenAIStreamState) closeLines() [][]byte {
	lines := make([][]byte, 0, 2)
	if line := s.finishLine(); len(line) > 0 {
		lines = append(lines, line)
	}
	lines = append(lines, []byte("data: [DONE]\n\n"))
	return lines
}

func (s *kiroOpenAIStreamState) nonStreamResponse() ([]byte, usage.Detail, bool, error) {
	s.ensureEstimatedUsage()
	message := map[string]any{
		"role":    "assistant",
		"content": s.content.String(),
	}
	if reasoning := s.reasoning.String(); reasoning != "" {
		message["reasoning_content"] = reasoning
	}
	if len(s.toolCalls) > 0 {
		toolCalls := make([]any, len(s.toolCalls))
		for idx, aggregate := range s.toolCalls {
			if aggregate == nil {
				continue
			}
			toolCalls[idx] = map[string]any{
				"id":   aggregate.ID,
				"type": "function",
				"function": map[string]any{
					"name":      aggregate.Name,
					"arguments": aggregate.Arguments.String(),
				},
			}
		}
		message["tool_calls"] = toolCalls
	}
	response := map[string]any{
		"id":      s.responseID,
		"object":  "chat.completion",
		"created": s.created,
		"model":   s.model,
		"choices": []any{map[string]any{
			"index":         0,
			"message":       message,
			"finish_reason": s.finishReason(),
		}},
	}
	if s.usageSeen {
		response["usage"] = usageDetailMap(s.usage)
	}
	out, err := json.Marshal(response)
	return out, s.usage, s.usageSeen, err
}

func (s *kiroOpenAIStreamState) baseChunk(choices []any, extras ...map[string]any) map[string]any {
	chunk := map[string]any{
		"id":      s.responseID,
		"object":  "chat.completion.chunk",
		"created": s.created,
		"model":   s.model,
		"choices": choices,
	}
	for _, extra := range extras {
		for k, v := range extra {
			chunk[k] = v
		}
	}
	return chunk
}

func (s *kiroOpenAIStreamState) finishReason() string {
	if s.hasToolCalls {
		return "tool_calls"
	}
	return "stop"
}

func (s *kiroOpenAIStreamState) ensureEstimatedUsage() {
	if s.usageSeen {
		return
	}
	if !s.contextSeen && s.totalContentSize == 0 {
		return
	}
	outputTokens := int64(0)
	if s.totalContentSize > 0 {
		outputTokens = int64(s.totalContentSize / 4)
		if outputTokens == 0 {
			outputTokens = 1
		}
	}
	inputTokens := int64(0)
	if s.contextPercent > 0 {
		inputTokens = int64((s.contextPercent / 100) * 200000)
	}
	if inputTokens == 0 && outputTokens == 0 {
		return
	}
	s.usage = usage.Detail{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  inputTokens + outputTokens,
	}
	s.usageSeen = true
}

func sendTranslatedKiroLine(ctx context.Context, out chan<- cliproxyexecutor.StreamChunk, opts cliproxyexecutor.Options, model string, requestBody, line []byte, param *any) bool {
	from := opts.SourceFormat
	if from == "" {
		from = sdktranslator.FormatOpenAI
	}
	chunks := sdktranslator.TranslateStream(ctx, sdktranslator.FormatOpenAI, from, model, opts.OriginalRequest, requestBody, line, param)
	for i := range chunks {
		if !sendKiroStreamChunk(ctx, out, cliproxyexecutor.StreamChunk{Payload: chunks[i]}) {
			return false
		}
	}
	return true
}

func sendKiroStreamChunk(ctx context.Context, out chan<- cliproxyexecutor.StreamChunk, chunk cliproxyexecutor.StreamChunk) bool {
	if ctx == nil {
		out <- chunk
		return true
	}
	select {
	case out <- chunk:
		return true
	case <-ctx.Done():
		return false
	}
}

func encodeSSEData(payload map[string]any) []byte {
	encoded, err := json.Marshal(payload)
	if err != nil {
		encoded = []byte(`{"object":"chat.completion.chunk","choices":[]}`)
	}
	out := make([]byte, 0, len(encoded)+8)
	out = append(out, "data: "...)
	out = append(out, encoded...)
	out = append(out, "\n\n"...)
	return out
}

func eventText(payload map[string]any, nestedKey string) string {
	if nested := nestedMap(payload, nestedKey); nested != nil {
		if text := strings.TrimSpace(stringFromAny(nested["text"])); text != "" {
			return text
		}
		if text := strings.TrimSpace(stringFromAny(nested["content"])); text != "" {
			return text
		}
	}
	if text := strings.TrimSpace(stringFromAny(payload["text"])); text != "" {
		return text
	}
	return stringFromAny(payload["content"])
}

func nestedMap(payload map[string]any, key string) map[string]any {
	if payload == nil {
		return nil
	}
	nested, _ := payload[key].(map[string]any)
	return nested
}

func normalizeToolUses(raw any) ([]map[string]any, error) {
	switch value := raw.(type) {
	case []any:
		out := make([]map[string]any, 0, len(value))
		for _, item := range value {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, errors.New("kiro executor: toolUseEvent item must be an object")
			}
			out = append(out, m)
		}
		return out, nil
	case map[string]any:
		return []map[string]any{value}, nil
	default:
		return nil, fmt.Errorf("kiro executor: unsupported toolUseEvent payload %T", raw)
	}
}

func toolArgumentsString(raw any) (string, error) {
	switch value := raw.(type) {
	case nil:
		return "{}", nil
	case string:
		if strings.TrimSpace(value) == "" {
			return "{}", nil
		}
		return value, nil
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	}
}

func parseKiroUsage(payload map[string]any, eventType string) (usage.Detail, bool) {
	source := payload
	switch eventType {
	case "metricsEvent":
		if nested := nestedMap(payload, "metricsEvent"); nested != nil {
			source = nested
		}
	case "usageEvent":
		if nested := nestedMap(payload, "usageEvent"); nested != nil {
			source = nested
		}
	}
	input, hasInput := int64FromAny(firstPresent(source, "inputTokens", "prompt_tokens", "input_tokens"))
	output, hasOutput := int64FromAny(firstPresent(source, "outputTokens", "completion_tokens", "output_tokens"))
	reasoning, hasReasoning := int64FromAny(firstPresent(source, "reasoningTokens", "reasoning_tokens"))
	if !hasInput && !hasOutput && !hasReasoning {
		return usage.Detail{}, false
	}
	detail := usage.Detail{
		InputTokens:     input,
		OutputTokens:    output,
		ReasoningTokens: reasoning,
	}
	if total, ok := int64FromAny(firstPresent(source, "totalTokens", "total_tokens")); ok {
		detail.TotalTokens = total
	} else {
		detail.TotalTokens = input + output + reasoning
	}
	return detail, true
}

func usageDetailMap(detail usage.Detail) map[string]any {
	total := detail.TotalTokens
	if total == 0 {
		total = detail.InputTokens + detail.OutputTokens + detail.ReasoningTokens
	}
	out := map[string]any{
		"prompt_tokens":     detail.InputTokens,
		"completion_tokens": detail.OutputTokens,
		"total_tokens":      total,
	}
	if detail.ReasoningTokens > 0 {
		out["completion_tokens_details"] = map[string]any{"reasoning_tokens": detail.ReasoningTokens}
		out["output_tokens_details"] = map[string]any{"reasoning_tokens": detail.ReasoningTokens}
	}
	if detail.CachedTokens > 0 {
		out["prompt_tokens_details"] = map[string]any{"cached_tokens": detail.CachedTokens}
	}
	return out
}

func firstPresent(source map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			return value
		}
	}
	return nil
}

func stringFromAny(raw any) string {
	switch value := raw.(type) {
	case string:
		return value
	case fmt.Stringer:
		return value.String()
	default:
		return ""
	}
}

func int64FromAny(raw any) (int64, bool) {
	switch value := raw.(type) {
	case json.Number:
		i, err := value.Int64()
		if err == nil {
			return i, true
		}
		f, err := value.Float64()
		return int64(f), err == nil
	case float64:
		return int64(value), true
	case int:
		return int64(value), true
	case int64:
		return value, true
	default:
		return 0, false
	}
}

func floatFromAny(raw any) (float64, bool) {
	switch value := raw.(type) {
	case json.Number:
		f, err := value.Float64()
		return f, err == nil
	case float64:
		return value, true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}

func (e *KiroExecutor) Refresh(ctx context.Context, auth *cliproxyauth.Auth) (*cliproxyauth.Auth, error) {
	if auth == nil {
		return nil, fmt.Errorf("kiro executor: auth is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	key := strings.TrimSpace(auth.ID)
	if key == "" {
		key = strings.TrimSpace(authRefreshTokenForKey(auth))
	}
	if key == "" {
		return e.refresh(ctx, auth)
	}

	e.refreshMu.Lock()
	if e.refreshCalls == nil {
		e.refreshCalls = make(map[string]*kiroRefreshCall)
	}
	if call := e.refreshCalls[key]; call != nil {
		e.refreshMu.Unlock()
		call.wg.Wait()
		if call.auth == nil {
			return nil, call.err
		}
		return call.auth.Clone(), call.err
	}
	call := &kiroRefreshCall{}
	call.wg.Add(1)
	e.refreshCalls[key] = call
	e.refreshMu.Unlock()

	call.auth, call.err = e.refresh(ctx, auth)
	call.wg.Done()

	e.refreshMu.Lock()
	delete(e.refreshCalls, key)
	e.refreshMu.Unlock()

	if call.auth == nil {
		return nil, call.err
	}
	return call.auth.Clone(), call.err
}

func (e *KiroExecutor) CountTokens(context.Context, *cliproxyauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, statusErr{code: http.StatusNotImplemented, msg: "kiro executor: token counting not implemented"}
}

func (e *KiroExecutor) RefreshLead() *time.Duration {
	lead := kiroRefreshLead
	return &lead
}

func (e *KiroExecutor) ShouldRefresh(now time.Time, auth *cliproxyauth.Auth) bool {
	meta, err := cliproxyauth.ParseKiroMetadata(auth)
	if err != nil {
		return false
	}
	return meta.ShouldRefresh(now, kiroRefreshLead)
}

func (e *KiroExecutor) ShouldRefreshAfterError(err error) bool {
	if err == nil {
		return false
	}
	if se, ok := err.(cliproxyexecutor.StatusError); ok && se != nil {
		return cliproxyauth.IsKiroTokenAuthError(se.StatusCode(), err.Error())
	}
	return false
}

func (e *KiroExecutor) refresh(ctx context.Context, auth *cliproxyauth.Auth) (*cliproxyauth.Auth, error) {
	meta, err := cliproxyauth.ParseKiroMetadata(auth)
	if err != nil {
		return nil, err
	}

	endpoint := strings.TrimSpace(e.refreshEndpoint)
	body := map[string]any{"refreshToken": meta.RefreshToken}
	if meta.ClientID != "" && meta.ClientSecret != "" {
		if e.oidcEndpoint != nil {
			endpoint = e.oidcEndpoint(meta.Region)
		}
		body["clientId"] = meta.ClientID
		body["clientSecret"] = meta.ClientSecret
		body["grantType"] = "refresh_token"
	}
	if endpoint == "" {
		endpoint = kiroSocialRefreshEndpoint
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "kiro-cli/1.0.0")

	client := helps.NewProxyAwareHTTPClient(ctx, e.cfg, auth, 30*time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, statusErr{code: resp.StatusCode, msg: safeKiroHTTPError(resp.StatusCode, respBody)}
	}

	var tokenResp struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresIn    int64  `json:"expiresIn"`
		ProfileARN   string `json:"profileArn"`
	}
	if errDecode := json.Unmarshal(respBody, &tokenResp); errDecode != nil {
		return nil, fmt.Errorf("kiro executor: decode refresh response: %w", errDecode)
	}
	if strings.TrimSpace(tokenResp.AccessToken) == "" {
		return nil, fmt.Errorf("kiro executor: refresh response missing access token")
	}

	updated := auth.Clone()
	meta.AccessToken = tokenResp.AccessToken
	if strings.TrimSpace(tokenResp.RefreshToken) != "" {
		meta.RefreshToken = tokenResp.RefreshToken
	}
	if strings.TrimSpace(tokenResp.ProfileARN) != "" {
		meta.ProfileARN = tokenResp.ProfileARN
	}
	if tokenResp.ExpiresIn > 0 {
		meta.ExpiresIn = tokenResp.ExpiresIn
		now := time.Now().UTC()
		if e.now != nil {
			now = e.now().UTC()
		}
		meta.ExpiresAt = now.Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}
	cliproxyauth.ApplyKiroMetadata(updated, meta)
	updated.Metadata["last_refresh"] = time.Now().UTC().Format(time.RFC3339)
	if e.now != nil {
		updated.Metadata["last_refresh"] = e.now().UTC().Format(time.RFC3339)
	}
	return updated, nil
}

func (e *KiroExecutor) generateAssistantResponseURL(auth *cliproxyauth.Auth) string {
	region := kiroDefaultRegion
	if meta, err := cliproxyauth.ParseKiroMetadata(auth); err == nil && strings.TrimSpace(meta.Region) != "" {
		region = meta.Region
	}
	return fmt.Sprintf("https://codewhisperer.%s.amazonaws.com/generateAssistantResponse", region)
}

func authRefreshTokenForKey(auth *cliproxyauth.Auth) string {
	if auth == nil || auth.Metadata == nil {
		return ""
	}
	if v, ok := auth.Metadata["refresh_token"].(string); ok {
		return v
	}
	if v, ok := auth.Metadata["refreshToken"].(string); ok {
		return v
	}
	return ""
}

func safeKiroHTTPError(statusCode int, body []byte) string {
	text := strings.TrimSpace(string(body))
	text = redactKiroErrorText(text)
	if text == "" {
		return fmt.Sprintf("kiro upstream status %d", statusCode)
	}
	if len(text) > 512 {
		text = text[:512]
	}
	return fmt.Sprintf("kiro upstream status %d: %s", statusCode, text)
}

func redactKiroErrorText(text string) string {
	for _, marker := range []string{"accessToken", "refreshToken", "access_token", "refresh_token", "clientSecret", "client_secret"} {
		if strings.Contains(text, marker) {
			return "upstream error body contained token fields and was redacted"
		}
	}
	return text
}
