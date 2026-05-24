package kiro

import (
	. "github.com/router-for-me/CLIProxyAPI/v7/internal/constant"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/interfaces"
	openaiClaude "github.com/router-for-me/CLIProxyAPI/v7/internal/translator/openai/claude"
	openaiGemini "github.com/router-for-me/CLIProxyAPI/v7/internal/translator/openai/gemini"
	openaiGeminiCLI "github.com/router-for-me/CLIProxyAPI/v7/internal/translator/openai/gemini-cli"
	openaiResponses "github.com/router-for-me/CLIProxyAPI/v7/internal/translator/openai/openai/responses"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/translator/translator"
)

func init() {
	response := interfaces.TranslateResponse{}
	translator.Register(OpenAI, Kiro, ConvertOpenAIRequestToKiro, response)
	translator.Register(OpenaiResponse, Kiro, convertOpenAIResponsesRequestToKiro, response)
	translator.Register(Claude, Kiro, convertClaudeRequestToKiro, response)
	translator.Register(Gemini, Kiro, convertGeminiRequestToKiro, response)
	translator.Register(GeminiCLI, Kiro, convertGeminiCLIRequestToKiro, response)
}

func convertOpenAIResponsesRequestToKiro(modelName string, rawJSON []byte, stream bool) []byte {
	openAI := openaiResponses.ConvertOpenAIResponsesRequestToOpenAIChatCompletions(modelName, rawJSON, stream)
	return ConvertOpenAIRequestToKiro(modelName, openAI, stream)
}

func convertClaudeRequestToKiro(modelName string, rawJSON []byte, stream bool) []byte {
	openAI := openaiClaude.ConvertClaudeRequestToOpenAI(modelName, rawJSON, stream)
	return ConvertOpenAIRequestToKiro(modelName, openAI, stream)
}

func convertGeminiRequestToKiro(modelName string, rawJSON []byte, stream bool) []byte {
	openAI := openaiGemini.ConvertGeminiRequestToOpenAI(modelName, rawJSON, stream)
	return ConvertOpenAIRequestToKiro(modelName, openAI, stream)
}

func convertGeminiCLIRequestToKiro(modelName string, rawJSON []byte, stream bool) []byte {
	openAI := openaiGeminiCLI.ConvertGeminiCLIRequestToOpenAI(modelName, rawJSON, stream)
	return ConvertOpenAIRequestToKiro(modelName, openAI, stream)
}
