package kiro

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	AgenticSuffix            = "-agentic"
	ThinkingSuffix           = "-thinking"
	ThinkingBudgetDefault    = 16000
	translationErrorJSONPath = "_kiro_error"
)

const AgenticSystemPrompt = `
# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- MAXIMUM 350 LINES per single write/edit operation - NO EXCEPTIONS
- RECOMMENDED 300 LINES or less for optimal performance
- NEVER write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines) using write_to_file/fsWrite
2. THEN: Append remaining content in 250-300 line chunks using file append operations
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits (apply_diff/targeted edits) - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

### For LARGE CODE GENERATION:
1. Generate in logical sections (imports, types, functions separately)
2. Write each section as a separate operation
3. Use append operations for subsequent sections

REMEMBER: When in doubt, write LESS per operation. Multiple small operations are better than one large operation.
`

type ModelVariant struct {
	Upstream string
	Thinking bool
	Agentic  bool
}

type kiroTranslationError struct {
	Message string `json:"_kiro_error"`
}

func (e kiroTranslationError) Error() string {
	return e.Message
}

func ResolveModel(model string) ModelVariant {
	upstream := strings.TrimSpace(model)
	variant := ModelVariant{Upstream: upstream}
	if strings.HasSuffix(upstream, AgenticSuffix) {
		variant.Agentic = true
		upstream = strings.TrimSuffix(upstream, AgenticSuffix)
	}
	if strings.HasSuffix(upstream, ThinkingSuffix) {
		variant.Thinking = true
		upstream = strings.TrimSuffix(upstream, ThinkingSuffix)
	}
	variant.Upstream = upstream
	return variant
}

func BuildThinkingSystemPrefix(budget int) string {
	if budget <= 0 {
		budget = ThinkingBudgetDefault
	}
	if budget > 32000 {
		budget = 32000
	}
	return fmt.Sprintf("<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>%d</max_thinking_length>", budget)
}

func TranslationError(rawJSON []byte) error {
	var decoded kiroTranslationError
	if err := json.Unmarshal(rawJSON, &decoded); err != nil {
		return nil
	}
	if strings.TrimSpace(decoded.Message) == "" {
		return nil
	}
	return decoded
}

func ConvertOpenAIRequestToKiro(modelName string, rawJSON []byte, stream bool) []byte {
	out, err := BuildKiroPayload(modelName, rawJSON, stream)
	if err != nil {
		return encodeTranslationError(err)
	}
	return out
}

func BuildKiroPayload(modelName string, rawJSON []byte, _ bool) ([]byte, error) {
	root, err := decodeJSONObject(rawJSON)
	if err != nil {
		return nil, fmt.Errorf("kiro translator: decode OpenAI request: %w", err)
	}
	variant := ResolveModel(modelName)
	if variant.Upstream == "" {
		return nil, errors.New("kiro translator: model is required")
	}

	messages, _ := root["messages"].([]any)
	tools, _ := root["tools"].([]any)
	history, current, err := convertMessages(messages, tools, variant.Upstream)
	if err != nil {
		return nil, err
	}

	finalContent := current.Content
	prefixes := make([]string, 0, 3)
	if variant.Thinking || thinkingEnabled(root, modelName) {
		prefixes = append(prefixes, BuildThinkingSystemPrefix(ThinkingBudgetDefault))
	}
	prefixes = append(prefixes, "[Context: Current time is "+time.Now().UTC().Format(time.RFC3339)+"]")
	if variant.Agentic {
		prefixes = append(prefixes, strings.TrimSpace(AgenticSystemPrompt))
	}
	if len(prefixes) > 0 {
		finalContent = strings.TrimSpace(strings.Join(prefixes, "\n\n") + "\n\n" + finalContent)
	}

	currentMap := userMessageMap(kiroUserMessage{
		Content:     finalContent,
		ModelID:     variant.Upstream,
		Images:      current.Images,
		ToolResults: current.ToolResults,
		Tools:       current.Tools,
	})
	payload := map[string]any{
		"conversationState": map[string]any{
			"chatTriggerType": "MANUAL",
			"conversationId":  uuid.NewString(),
			"currentMessage":  currentMap,
			"history":         history,
		},
	}
	if inference := buildInferenceConfig(root); len(inference) > 0 {
		payload["inferenceConfig"] = inference
	}
	return json.Marshal(payload)
}

type kiroUserMessage struct {
	Content     string
	ModelID     string
	Images      []any
	ToolResults []any
	Tools       []any
}

type pendingMessageState struct {
	role             string
	userContent      []string
	assistantContent []string
	toolResults      []any
	images           []any
	history          []any
}

func convertMessages(messages, tools []any, model string) ([]any, kiroUserMessage, error) {
	state := &pendingMessageState{}
	kiroTools, err := buildKiroTools(tools)
	if err != nil {
		return nil, kiroUserMessage{}, err
	}

	for _, rawMsg := range messages {
		msg, ok := rawMsg.(map[string]any)
		if !ok {
			return nil, kiroUserMessage{}, errors.New("kiro translator: message must be an object")
		}
		role := strings.TrimSpace(asString(msg["role"]))
		if role == "" {
			return nil, kiroUserMessage{}, errors.New("kiro translator: message role is required")
		}
		normalizedRole := role
		if normalizedRole == "system" || normalizedRole == "tool" || normalizedRole == "developer" {
			normalizedRole = "user"
		}
		if normalizedRole != "user" && normalizedRole != "assistant" {
			return nil, kiroUserMessage{}, fmt.Errorf("kiro translator: unsupported message role %q", role)
		}
		if state.role != "" && state.role != normalizedRole {
			if err := state.flush(model); err != nil {
				return nil, kiroUserMessage{}, err
			}
		}
		state.role = normalizedRole

		switch normalizedRole {
		case "user":
			if role == "tool" {
				result, err := toolRoleResult(msg)
				if err != nil {
					return nil, kiroUserMessage{}, err
				}
				state.toolResults = append(state.toolResults, result)
				continue
			}
			text, images, toolResults, err := userContent(msg["content"])
			if err != nil {
				return nil, kiroUserMessage{}, err
			}
			if strings.TrimSpace(text) != "" {
				state.userContent = append(state.userContent, text)
			}
			state.images = append(state.images, images...)
			state.toolResults = append(state.toolResults, toolResults...)
		case "assistant":
			text, toolUses, err := assistantContent(msg)
			if err != nil {
				return nil, kiroUserMessage{}, err
			}
			if strings.TrimSpace(text) != "" {
				state.assistantContent = append(state.assistantContent, text)
			}
			if len(toolUses) > 0 {
				if len(state.assistantContent) == 0 {
					state.assistantContent = append(state.assistantContent, "...")
				}
				if err := state.flush(model); err != nil {
					return nil, kiroUserMessage{}, err
				}
				last := state.history[len(state.history)-1].(map[string]any)
				assistant := last["assistantResponseMessage"].(map[string]any)
				assistant["toolUses"] = toolUses
				state.role = ""
			}
		}
	}
	if state.role != "" {
		if err := state.flush(model); err != nil {
			return nil, kiroUserMessage{}, err
		}
	}

	currentIndex := -1
	for i := len(state.history) - 1; i >= 0; i-- {
		item, _ := state.history[i].(map[string]any)
		if _, ok := item["userInputMessage"]; ok {
			currentIndex = i
			break
		}
	}

	current := kiroUserMessage{Content: "continue", ModelID: model, Tools: kiroTools}
	if currentIndex >= 0 {
		item := state.history[currentIndex].(map[string]any)
		user := item["userInputMessage"].(map[string]any)
		current.Content = asString(user["content"])
		if current.Content == "" {
			current.Content = "continue"
		}
		current.Images, _ = user["images"].([]any)
		if ctx, _ := user["userInputMessageContext"].(map[string]any); ctx != nil {
			current.ToolResults, _ = ctx["toolResults"].([]any)
		}
		state.history = append(state.history[:currentIndex], state.history[currentIndex+1:]...)
	}

	history := mergeConsecutiveUserMessages(state.history)
	for _, raw := range history {
		item, _ := raw.(map[string]any)
		if user, _ := item["userInputMessage"].(map[string]any); user != nil {
			if asString(user["modelId"]) == "" {
				user["modelId"] = model
			}
		}
	}
	return history, current, nil
}

func (s *pendingMessageState) flush(model string) error {
	switch s.role {
	case "user":
		content := strings.TrimSpace(strings.Join(s.userContent, "\n\n"))
		if content == "" {
			content = "continue"
		}
		s.history = append(s.history, userMessageMap(kiroUserMessage{
			Content:     content,
			ModelID:     model,
			Images:      s.images,
			ToolResults: s.toolResults,
		}))
		s.userContent = nil
		s.images = nil
		s.toolResults = nil
	case "assistant":
		content := strings.TrimSpace(strings.Join(s.assistantContent, "\n\n"))
		if content == "" {
			content = "..."
		}
		s.history = append(s.history, map[string]any{
			"assistantResponseMessage": map[string]any{"content": content},
		})
		s.assistantContent = nil
	}
	return nil
}

func userMessageMap(msg kiroUserMessage) map[string]any {
	user := map[string]any{
		"content": msg.Content,
		"modelId": msg.ModelID,
	}
	if len(msg.Images) > 0 {
		user["images"] = msg.Images
	}
	ctx := map[string]any{}
	if len(msg.ToolResults) > 0 {
		ctx["toolResults"] = msg.ToolResults
	}
	if len(msg.Tools) > 0 {
		ctx["tools"] = msg.Tools
	}
	if len(ctx) > 0 {
		user["userInputMessageContext"] = ctx
	}
	return map[string]any{"userInputMessage": user}
}

func mergeConsecutiveUserMessages(history []any) []any {
	if len(history) < 2 {
		return history
	}
	merged := make([]any, 0, len(history))
	for _, raw := range history {
		current, _ := raw.(map[string]any)
		currentUser, _ := current["userInputMessage"].(map[string]any)
		if currentUser != nil && len(merged) > 0 {
			prev, _ := merged[len(merged)-1].(map[string]any)
			prevUser, _ := prev["userInputMessage"].(map[string]any)
			if prevUser != nil {
				prevUser["content"] = strings.TrimSpace(asString(prevUser["content"]) + "\n\n" + asString(currentUser["content"]))
				continue
			}
		}
		merged = append(merged, raw)
	}
	return merged
}

func userContent(raw any) (string, []any, []any, error) {
	switch value := raw.(type) {
	case nil:
		return "", nil, nil, nil
	case string:
		return value, nil, nil, nil
	case []any:
		texts := make([]string, 0, len(value))
		images := make([]any, 0)
		toolResults := make([]any, 0)
		for _, rawPart := range value {
			part, ok := rawPart.(map[string]any)
			if !ok {
				return "", nil, nil, errors.New("kiro translator: content part must be an object")
			}
			partType := strings.TrimSpace(asString(part["type"]))
			switch {
			case partType == "text" || partType == "input_text" || partType == "output_text" || (partType == "" && asString(part["text"]) != ""):
				texts = append(texts, asString(part["text"]))
			case partType == "image_url" || partType == "input_image":
				image, err := openAIImagePart(part)
				if err != nil {
					return "", nil, nil, err
				}
				images = append(images, image)
			case partType == "image":
				image, err := claudeImagePart(part)
				if err != nil {
					return "", nil, nil, err
				}
				images = append(images, image)
			case partType == "tool_result":
				result, err := contentToolResult(part)
				if err != nil {
					return "", nil, nil, err
				}
				toolResults = append(toolResults, result)
			default:
				return "", nil, nil, fmt.Errorf("kiro translator: unsupported user content type %q", partType)
			}
		}
		return strings.Join(texts, "\n"), images, toolResults, nil
	default:
		return "", nil, nil, fmt.Errorf("kiro translator: unsupported user content shape %T", raw)
	}
}

func assistantContent(msg map[string]any) (string, []any, error) {
	texts := make([]string, 0)
	if raw := msg["content"]; raw != nil {
		switch value := raw.(type) {
		case string:
			if strings.TrimSpace(value) != "" {
				texts = append(texts, value)
			}
		case []any:
			for _, rawPart := range value {
				part, ok := rawPart.(map[string]any)
				if !ok {
					return "", nil, errors.New("kiro translator: assistant content part must be an object")
				}
				partType := strings.TrimSpace(asString(part["type"]))
				switch {
				case partType == "text" || partType == "output_text" || (partType == "" && asString(part["text"]) != ""):
					texts = append(texts, asString(part["text"]))
				case partType == "tool_use":
					toolUse, err := claudeToolUse(part)
					if err != nil {
						return "", nil, err
					}
					return strings.Join(texts, "\n"), []any{toolUse}, nil
				default:
					return "", nil, fmt.Errorf("kiro translator: unsupported assistant content type %q", partType)
				}
			}
		default:
			return "", nil, fmt.Errorf("kiro translator: unsupported assistant content shape %T", raw)
		}
	}

	toolUses := make([]any, 0)
	if calls, _ := msg["tool_calls"].([]any); len(calls) > 0 {
		for _, rawCall := range calls {
			call, ok := rawCall.(map[string]any)
			if !ok {
				return "", nil, errors.New("kiro translator: tool call must be an object")
			}
			toolUse, err := openAIToolCall(call)
			if err != nil {
				return "", nil, err
			}
			toolUses = append(toolUses, toolUse)
		}
	}
	return strings.Join(texts, "\n"), toolUses, nil
}

func openAIToolCall(call map[string]any) (any, error) {
	fn, _ := call["function"].(map[string]any)
	if fn == nil {
		return nil, errors.New("kiro translator: tool call function is required")
	}
	name := strings.TrimSpace(asString(fn["name"]))
	if name == "" {
		return nil, errors.New("kiro translator: tool call function.name is required")
	}
	input, err := parseToolArguments(fn["arguments"])
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(asString(call["id"]))
	if id == "" {
		id = uuid.NewString()
	}
	return map[string]any{
		"toolUseId": id,
		"name":      name,
		"input":     input,
	}, nil
}

func claudeToolUse(part map[string]any) (any, error) {
	name := strings.TrimSpace(asString(part["name"]))
	if name == "" {
		return nil, errors.New("kiro translator: tool_use name is required")
	}
	id := strings.TrimSpace(asString(part["id"]))
	if id == "" {
		id = uuid.NewString()
	}
	input, _ := part["input"].(map[string]any)
	if input == nil {
		input = map[string]any{}
	}
	return map[string]any{"toolUseId": id, "name": name, "input": input}, nil
}

func parseToolArguments(raw any) (map[string]any, error) {
	switch value := raw.(type) {
	case nil:
		return map[string]any{}, nil
	case map[string]any:
		return value, nil
	case string:
		if strings.TrimSpace(value) == "" {
			return map[string]any{}, nil
		}
		decoded, err := decodeJSONObject([]byte(value))
		if err != nil {
			return nil, fmt.Errorf("kiro translator: tool call arguments must be JSON object: %w", err)
		}
		return decoded, nil
	default:
		return nil, fmt.Errorf("kiro translator: unsupported tool arguments shape %T", raw)
	}
}

func toolRoleResult(msg map[string]any) (any, error) {
	id := strings.TrimSpace(asString(msg["tool_call_id"]))
	if id == "" {
		return nil, errors.New("kiro translator: tool message tool_call_id is required")
	}
	text, _, _, err := userContent(msg["content"])
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"toolUseId": id,
		"status":    "success",
		"content":   []any{map[string]any{"text": text}},
	}, nil
}

func contentToolResult(part map[string]any) (any, error) {
	id := strings.TrimSpace(asString(part["tool_use_id"]))
	if id == "" {
		return nil, errors.New("kiro translator: tool_result tool_use_id is required")
	}
	text, err := toolResultText(part["content"])
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"toolUseId": id,
		"status":    "success",
		"content":   []any{map[string]any{"text": text}},
	}, nil
}

func toolResultText(raw any) (string, error) {
	switch value := raw.(type) {
	case nil:
		return "", nil
	case string:
		return value, nil
	case []any:
		texts := make([]string, 0, len(value))
		for _, rawItem := range value {
			item, ok := rawItem.(map[string]any)
			if !ok {
				return "", errors.New("kiro translator: tool_result content part must be an object")
			}
			if itemType := strings.TrimSpace(asString(item["type"])); itemType != "" && itemType != "text" {
				return "", fmt.Errorf("kiro translator: unsupported tool_result content type %q", itemType)
			}
			texts = append(texts, asString(item["text"]))
		}
		return strings.Join(texts, "\n"), nil
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	}
}

func openAIImagePart(part map[string]any) (any, error) {
	url := asString(part["image_url"])
	if imageURL, _ := part["image_url"].(map[string]any); imageURL != nil {
		url = asString(imageURL["url"])
	}
	if url == "" {
		url = asString(part["url"])
	}
	return imageFromDataURL(url)
}

func claudeImagePart(part map[string]any) (any, error) {
	source, _ := part["source"].(map[string]any)
	if source == nil || asString(source["type"]) != "base64" || asString(source["data"]) == "" {
		return nil, errors.New("kiro translator: only base64 image inputs are supported")
	}
	mediaType := asString(source["media_type"])
	if mediaType == "" {
		mediaType = "image/png"
	}
	return imageFromBase64(mediaType, asString(source["data"]))
}

func imageFromDataURL(rawURL string) (any, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, errors.New("kiro translator: image_url.url is required")
	}
	prefix, data, ok := strings.Cut(rawURL, ",")
	if !ok || !strings.HasPrefix(prefix, "data:") || !strings.Contains(prefix, ";base64") {
		return nil, errors.New("kiro translator: only base64 data URL images are supported")
	}
	mediaType := strings.TrimPrefix(strings.TrimSuffix(prefix, ";base64"), "data:")
	return imageFromBase64(mediaType, data)
}

func imageFromBase64(mediaType, data string) (any, error) {
	if strings.TrimSpace(data) == "" {
		return nil, errors.New("kiro translator: image data is empty")
	}
	if _, err := base64.StdEncoding.DecodeString(data); err != nil {
		return nil, fmt.Errorf("kiro translator: invalid base64 image data: %w", err)
	}
	format := mediaType
	if _, suffix, ok := strings.Cut(mediaType, "/"); ok {
		format = suffix
	}
	if format == "" {
		format = "png"
	}
	return map[string]any{
		"format": format,
		"source": map[string]any{"bytes": data},
	}, nil
}

func buildKiroTools(tools []any) ([]any, error) {
	if len(tools) == 0 {
		return nil, nil
	}
	out := make([]any, 0, len(tools))
	for _, rawTool := range tools {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			return nil, errors.New("kiro translator: tool must be an object")
		}
		name := asString(tool["name"])
		description := asString(tool["description"])
		var schema any = tool["parameters"]
		if fn, _ := tool["function"].(map[string]any); fn != nil {
			name = asString(fn["name"])
			description = asString(fn["description"])
			schema = fn["parameters"]
		}
		if schema == nil {
			schema = tool["input_schema"]
		}
		if strings.TrimSpace(name) == "" {
			return nil, errors.New("kiro translator: tool name is required")
		}
		if strings.TrimSpace(description) == "" {
			description = "Tool: " + name
		}
		normalizedSchema := normalizeToolSchema(schema)
		out = append(out, map[string]any{
			"toolSpecification": map[string]any{
				"name":        name,
				"description": description,
				"inputSchema": map[string]any{"json": normalizedSchema},
			},
		})
	}
	return out, nil
}

func normalizeToolSchema(raw any) map[string]any {
	schema, _ := raw.(map[string]any)
	if len(schema) == 0 {
		return map[string]any{"type": "object", "properties": map[string]any{}, "required": []any{}}
	}
	out := make(map[string]any, len(schema)+1)
	for k, v := range schema {
		out[k] = v
	}
	if _, ok := out["required"]; !ok {
		out["required"] = []any{}
	}
	if _, ok := out["type"]; !ok {
		if _, hasProps := out["properties"]; hasProps {
			out["type"] = "object"
		}
	}
	return out
}

func buildInferenceConfig(root map[string]any) map[string]any {
	out := map[string]any{"maxTokens": 32000}
	if v, ok := numberValue(root["temperature"]); ok {
		out["temperature"] = v
	}
	if v, ok := numberValue(root["top_p"]); ok {
		out["topP"] = v
	}
	if v, ok := numberValue(root["max_tokens"]); ok && v > 0 && v < 32000 {
		out["maxTokens"] = int(v)
	}
	return out
}

func thinkingEnabled(root map[string]any, modelName string) bool {
	modelLower := strings.ToLower(modelName)
	if strings.Contains(modelLower, "thinking") || strings.Contains(modelLower, "-reason") {
		return true
	}
	if effort := strings.ToLower(strings.TrimSpace(asString(root["reasoning_effort"]))); effort != "" && effort != "none" {
		return true
	}
	if reasoning, _ := root["reasoning"].(map[string]any); reasoning != nil {
		if effort := strings.ToLower(strings.TrimSpace(asString(reasoning["effort"]))); effort != "" && effort != "none" {
			return true
		}
	}
	if thinking, _ := root["thinking"].(map[string]any); thinking != nil {
		if strings.EqualFold(asString(thinking["type"]), "enabled") {
			if budget, ok := numberValue(thinking["budget_tokens"]); !ok || budget > 0 {
				return true
			}
		}
	}
	return containsThinkingModeTag(root)
}

func containsThinkingModeTag(root map[string]any) bool {
	messages, _ := root["messages"].([]any)
	for _, raw := range messages {
		msg, _ := raw.(map[string]any)
		if msg == nil {
			continue
		}
		role := asString(msg["role"])
		if role != "system" && role != "user" {
			continue
		}
		if contentContainsThinkingTag(msg["content"]) {
			return true
		}
	}
	return false
}

func contentContainsThinkingTag(raw any) bool {
	switch value := raw.(type) {
	case string:
		return textContainsThinkingTag(value)
	case []any:
		for _, rawPart := range value {
			part, _ := rawPart.(map[string]any)
			if textContainsThinkingTag(asString(part["text"])) {
				return true
			}
		}
	}
	return false
}

func textContainsThinkingTag(text string) bool {
	return strings.Contains(text, "<thinking_mode>enabled</thinking_mode>") ||
		strings.Contains(text, "<thinking_mode>interleaved</thinking_mode>")
}

func decodeJSONObject(rawJSON []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(rawJSON))
	decoder.UseNumber()
	var out map[string]any
	if err := decoder.Decode(&out); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("empty object")
	}
	return out, nil
}

func encodeTranslationError(err error) []byte {
	encoded, marshalErr := json.Marshal(kiroTranslationError{Message: err.Error()})
	if marshalErr != nil {
		return []byte(`{"_kiro_error":"kiro translator failed"}`)
	}
	return encoded
}

func asString(raw any) string {
	switch value := raw.(type) {
	case string:
		return value
	case json.Number:
		return value.String()
	default:
		return ""
	}
}

func numberValue(raw any) (float64, bool) {
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
