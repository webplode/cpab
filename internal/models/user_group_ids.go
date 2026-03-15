package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// UserGroupIDs stores user group identifiers as a JSON array.
type UserGroupIDs []*uint64

// Value implements driver.Valuer for database serialization.
func (ids UserGroupIDs) Value() (driver.Value, error) {
	cleaned := ids.Clean()
	values := make([]uint64, 0, len(cleaned))
	for _, id := range cleaned {
		if id == nil {
			continue
		}
		values = append(values, *id)
	}
	data, errMarshal := json.Marshal(values)
	if errMarshal != nil {
		return nil, fmt.Errorf("user group ids marshal: %w", errMarshal)
	}
	return data, nil
}

// Scan implements sql.Scanner for database deserialization.
func (ids *UserGroupIDs) Scan(value any) error {
	if ids == nil {
		return fmt.Errorf("user group ids scan: nil receiver")
	}
	if value == nil {
		*ids = UserGroupIDs{}
		return nil
	}

	switch typed := value.(type) {
	case []byte:
		return parseUserGroupIDsFromBytes(ids, typed)
	case string:
		return parseUserGroupIDsFromBytes(ids, []byte(typed))
	case int64:
		idValue := uint64(typed)
		*ids = UserGroupIDs{&idValue}
		return nil
	case uint64:
		idValue := typed
		*ids = UserGroupIDs{&idValue}
		return nil
	case int:
		if typed < 0 {
			*ids = UserGroupIDs{}
			return nil
		}
		idValue := uint64(typed)
		*ids = UserGroupIDs{&idValue}
		return nil
	default:
		return fmt.Errorf("user group ids scan: unsupported type %T", value)
	}
}

func parseUserGroupIDsFromBytes(target *UserGroupIDs, data []byte) error {
	if target == nil {
		return fmt.Errorf("user group ids scan: nil target")
	}
	if len(data) == 0 {
		*target = UserGroupIDs{}
		return nil
	}

	var list []uint64
	if errList := json.Unmarshal(data, &list); errList == nil {
		out := make(UserGroupIDs, 0, len(list))
		for _, id := range list {
			idCopy := id
			out = append(out, &idCopy)
		}
		*target = out
		return nil
	}

	var listPtr []*uint64
	if errListPtr := json.Unmarshal(data, &listPtr); errListPtr == nil {
		*target = UserGroupIDs(listPtr).Clean()
		return nil
	}

	var single uint64
	if errSingle := json.Unmarshal(data, &single); errSingle == nil {
		idCopy := single
		*target = UserGroupIDs{&idCopy}
		return nil
	}

	return fmt.Errorf("user group ids scan: invalid json")
}

// Clean normalizes user group ids by removing nil/zero values and duplicates.
func (ids UserGroupIDs) Clean() UserGroupIDs {
	if len(ids) == 0 {
		return UserGroupIDs{}
	}
	seen := make(map[uint64]struct{}, len(ids))
	cleaned := make(UserGroupIDs, 0, len(ids))
	for _, id := range ids {
		if id == nil || *id == 0 {
			continue
		}
		if _, ok := seen[*id]; ok {
			continue
		}
		seen[*id] = struct{}{}
		idCopy := *id
		cleaned = append(cleaned, &idCopy)
	}
	if len(cleaned) == 0 {
		return UserGroupIDs{}
	}
	return cleaned
}

// Primary returns the first non-zero user group id if any.
func (ids UserGroupIDs) Primary() *uint64 {
	for _, id := range ids {
		if id != nil && *id != 0 {
			return id
		}
	}
	return nil
}

// Values returns unique non-zero user group ids in order.
func (ids UserGroupIDs) Values() []uint64 {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uint64]struct{}, len(ids))
	values := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == nil || *id == 0 {
			continue
		}
		if _, ok := seen[*id]; ok {
			continue
		}
		seen[*id] = struct{}{}
		values = append(values, *id)
	}
	return values
}
