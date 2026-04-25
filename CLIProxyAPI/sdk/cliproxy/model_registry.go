package cliproxy

import (
	"context"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/registry"
)

// ModelInfo re-exports the registry model info structure.
type ModelInfo = registry.ModelInfo

// ModelRegistryHook re-exports the registry hook interface for external integrations.
type ModelRegistryHook = registry.ModelRegistryHook

// ModelCatalogRefreshResult describes the outcome of a manual model catalog refresh.
type ModelCatalogRefreshResult struct {
	Source           string
	ChangedProviders []string
}

// ModelRegistry describes registry operations consumed by external callers.
type ModelRegistry interface {
	RegisterClient(clientID, clientProvider string, models []*ModelInfo)
	UnregisterClient(clientID string)
	SetModelQuotaExceeded(clientID, modelID string)
	ClearModelQuotaExceeded(clientID, modelID string)
	ClientSupportsModel(clientID, modelID string) bool
	GetAvailableModels(handlerType string) []map[string]any
	GetAvailableModelsByProvider(provider string) []*ModelInfo
}

// GlobalModelRegistry returns the shared registry instance.
func GlobalModelRegistry() ModelRegistry {
	return registry.GetGlobalRegistry()
}

// SetGlobalModelRegistryHook registers an optional hook on the shared global registry instance.
func SetGlobalModelRegistryHook(hook ModelRegistryHook) {
	registry.GetGlobalRegistry().SetHook(hook)
}

// RefreshGlobalModelCatalog fetches the latest remote model catalog immediately.
// Any changed providers trigger the same callback path used by startup and periodic refreshes.
func RefreshGlobalModelCatalog(ctx context.Context) (ModelCatalogRefreshResult, error) {
	changedProviders, source, err := registry.RefreshModelsNow(ctx)
	if err != nil {
		return ModelCatalogRefreshResult{}, err
	}
	return ModelCatalogRefreshResult{
		Source:           source,
		ChangedProviders: changedProviders,
	}, nil
}
