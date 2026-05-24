package http

import (
	"testing"
	"time"

	sdkcliproxy "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/modelmapping"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
)

func TestFilterModelInfosByUserGroupsUsesKiroTypeWhenOwnedByIsAmazon(t *testing.T) {
	now := time.Now().UTC()
	allowedGroupID := uint64(10)
	deniedGroupID := uint64(20)
	modelmapping.StoreModelMappings(now, []models.ModelMapping{
		{
			ID:           1,
			Provider:     "kiro",
			ModelName:    "claude-sonnet-4.5",
			NewModelName: "claude-sonnet-4.5-thinking-agentic",
			IsEnabled:    true,
			UserGroupID:  models.UserGroupIDs{&allowedGroupID},
			CreatedAt:    now,
			UpdatedAt:    now,
		},
	})
	t.Cleanup(func() { modelmapping.StoreModelMappings(time.Now().UTC(), nil) })

	raw := []*sdkcliproxy.ModelInfo{{
		ID:      "claude-sonnet-4.5-thinking-agentic",
		OwnedBy: "amazon",
		Type:    "kiro",
	}}

	filtered := filterModelInfosByUserGroups(raw, models.UserGroupIDs{&deniedGroupID}, nil)
	if len(filtered) != 0 {
		t.Fatalf("filtered length = %d, want 0 for denied Kiro group", len(filtered))
	}

	filtered = filterModelInfosByUserGroups(raw, models.UserGroupIDs{&allowedGroupID}, nil)
	if len(filtered) != 1 {
		t.Fatalf("filtered length = %d, want 1 for allowed Kiro group", len(filtered))
	}
}
