package kiro

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildKiroPayloadBasicPrompt(t *testing.T) {
	payload := mustBuildKiroPayload(t, "claude-sonnet-4.5", []byte(`{
		"messages": [
			{"role": "system", "content": "You are precise."},
			{"role": "user", "content": "Summarize this."}
		],
		"temperature": 0.2,
		"max_tokens": 123
	}`))

	current := currentKiroUserMessage(t, payload)
	if got := current["modelId"]; got != "claude-sonnet-4.5" {
		t.Fatalf("modelId = %v", got)
	}
	content := current["content"].(string)
	for _, want := range []string{"You are precise.", "Summarize this.", "[Context: Current time is "} {
		if !strings.Contains(content, want) {
			t.Fatalf("current content missing %q: %s", want, content)
		}
	}

	inference, _ := payload["inferenceConfig"].(map[string]any)
	if inference["maxTokens"] != float64(123) && inference["maxTokens"] != 123 {
		t.Fatalf("maxTokens = %v, want 123", inference["maxTokens"])
	}
	if inference["temperature"] != float64(0.2) {
		t.Fatalf("temperature = %v, want 0.2", inference["temperature"])
	}
}

func TestBuildKiroPayloadToolsToolResultAndImage(t *testing.T) {
	payload := mustBuildKiroPayload(t, "claude-sonnet-4.5", []byte(`{
		"messages": [
			{"role": "user", "content": "Use the tool."},
			{"role": "assistant", "content": "Calling it.", "tool_calls": [
				{"id": "call_1", "type": "function", "function": {"name": "lookup", "arguments": "{\"q\":\"x\"}"}}
			]},
			{"role": "tool", "tool_call_id": "call_1", "content": "tool result"},
			{"role": "user", "content": [
				{"type": "text", "text": "Continue with this image."},
				{"type": "image_url", "image_url": {"url": "data:image/png;base64,aGVsbG8="}}
			]}
		],
		"tools": [
			{"type": "function", "function": {"name": "lookup", "description": "Lookup data", "parameters": {"type": "object"}}}
		]
	}`))

	current := currentKiroUserMessage(t, payload)
	ctx, _ := current["userInputMessageContext"].(map[string]any)
	if ctx == nil {
		t.Fatal("expected userInputMessageContext")
	}
	if results, _ := ctx["toolResults"].([]any); len(results) != 1 {
		t.Fatalf("toolResults length = %d, want 1", len(results))
	}
	if tools, _ := ctx["tools"].([]any); len(tools) != 1 {
		t.Fatalf("tools length = %d, want 1", len(tools))
	}
	if images, _ := current["images"].([]any); len(images) != 1 {
		t.Fatalf("images length = %d, want 1", len(images))
	}

	history, _ := payload["conversationState"].(map[string]any)["history"].([]any)
	if len(history) != 2 {
		t.Fatalf("history length = %d, want 2", len(history))
	}
	assistant, _ := history[1].(map[string]any)["assistantResponseMessage"].(map[string]any)
	if toolUses, _ := assistant["toolUses"].([]any); len(toolUses) != 1 {
		t.Fatalf("assistant toolUses length = %d, want 1", len(toolUses))
	}
}

func TestResolveModelThinkingAgenticVariant(t *testing.T) {
	variant := ResolveModel("claude-opus-4.6-thinking-agentic")
	if variant.Upstream != "claude-opus-4.6" || !variant.Thinking || !variant.Agentic {
		t.Fatalf("variant = %+v", variant)
	}

	payload := mustBuildKiroPayload(t, "claude-opus-4.6-thinking-agentic", []byte(`{
		"messages": [{"role": "user", "content": "Implement this."}]
	}`))
	current := currentKiroUserMessage(t, payload)
	if got := current["modelId"]; got != "claude-opus-4.6" {
		t.Fatalf("modelId = %v, want upstream base", got)
	}
	content := current["content"].(string)
	for _, want := range []string{"<thinking_mode>enabled</thinking_mode>", "CHUNKED WRITE PROTOCOL", "Implement this."} {
		if !strings.Contains(content, want) {
			t.Fatalf("current content missing %q: %s", want, content)
		}
	}
}

func TestConvertOpenAIRequestToKiroReportsUnsupportedContent(t *testing.T) {
	out := ConvertOpenAIRequestToKiro("claude-sonnet-4.5", []byte(`{
		"messages": [{"role": "user", "content": [{"type": "file", "file_id": "file_1"}]}]
	}`), true)
	err := TranslationError(out)
	if err == nil {
		t.Fatalf("expected translation error, got %s", out)
	}
	if !strings.Contains(err.Error(), "unsupported user content type") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func mustBuildKiroPayload(t *testing.T, model string, raw []byte) map[string]any {
	t.Helper()
	out, err := BuildKiroPayload(model, raw, true)
	if err != nil {
		t.Fatalf("BuildKiroPayload: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(out, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	return payload
}

func currentKiroUserMessage(t *testing.T, payload map[string]any) map[string]any {
	t.Helper()
	state, _ := payload["conversationState"].(map[string]any)
	current, _ := state["currentMessage"].(map[string]any)
	user, _ := current["userInputMessage"].(map[string]any)
	if user == nil {
		t.Fatalf("missing current user message: %+v", payload)
	}
	return user
}
