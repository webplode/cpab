package handlers

import (
	"fmt"
	"strings"
	"time"

	dbutil "github.com/router-for-me/CLIProxyAPIBusiness/internal/db"
	"gorm.io/gorm"
)

const (
	adminUsageRangeAuto   = ""
	adminUsageRangeAll    = "all"
	adminUsageRangeToday  = "today"
	adminUsageRangeLast7  = "last7d"
	adminUsageRangeLast30 = "last30d"
	adminUsageRangeMTD    = "mtd"
	adminUsageRangeCustom = "custom"
)

type adminUsageFilterQuery struct {
	Range     string `form:"range"`
	StartDate string `form:"start_date"`
	EndDate   string `form:"end_date"`
	Project   string `form:"project"`
	Model     string `form:"model"`
	Provider  string `form:"provider"`
}

type adminUsageFilterState struct {
	Range          string
	Start          *time.Time
	End            *time.Time
	MonthlyBuckets bool
}

func normalizeAdminUsageRange(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return adminUsageRangeAuto
	case adminUsageRangeAll:
		return adminUsageRangeAll
	case adminUsageRangeToday:
		return adminUsageRangeToday
	case adminUsageRangeLast7, "7d", "last_7d":
		return adminUsageRangeLast7
	case adminUsageRangeLast30, "30d", "last_30d":
		return adminUsageRangeLast30
	case adminUsageRangeMTD, "month", "month_to_date":
		return adminUsageRangeMTD
	case adminUsageRangeCustom:
		return adminUsageRangeCustom
	default:
		return adminUsageRangeAuto
	}
}

func parseAdminUsageDate(value string, loc *time.Location) (*time.Time, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, false
	}
	if loc == nil {
		loc = time.Local
	}
	parsed, err := time.ParseInLocation("2006-01-02", trimmed, loc)
	if err != nil {
		return nil, false
	}
	return &parsed, true
}

func resolveAdminUsageFilterState(q adminUsageFilterQuery, loc *time.Location, now time.Time) adminUsageFilterState {
	if loc == nil {
		loc = time.Local
	}
	now = now.In(loc)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	state := adminUsageFilterState{
		Range: normalizeAdminUsageRange(q.Range),
	}

	startDate, hasStart := parseAdminUsageDate(q.StartDate, loc)
	endDate, hasEnd := parseAdminUsageDate(q.EndDate, loc)

	if hasStart || hasEnd {
		state.Range = adminUsageRangeCustom
		if hasStart {
			state.Start = startDate
		}
		if hasEnd {
			endExclusive := endDate.AddDate(0, 0, 1)
			state.End = &endExclusive
		}
	} else {
		switch state.Range {
		case adminUsageRangeAll:
			// No explicit bounds.
		case adminUsageRangeToday, adminUsageRangeAuto:
			start := todayStart
			end := start.AddDate(0, 0, 1)
			state.Start = &start
			state.End = &end
		case adminUsageRangeLast7:
			start := todayStart.AddDate(0, 0, -6)
			end := todayStart.AddDate(0, 0, 1)
			state.Start = &start
			state.End = &end
		case adminUsageRangeLast30:
			start := todayStart.AddDate(0, 0, -29)
			end := todayStart.AddDate(0, 0, 1)
			state.Start = &start
			state.End = &end
		case adminUsageRangeMTD:
			start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
			end := todayStart.AddDate(0, 0, 1)
			state.Start = &start
			state.End = &end
		}
	}

	switch {
	case state.Range == adminUsageRangeAll:
		state.MonthlyBuckets = true
	case state.Start != nil && state.End != nil && state.End.Sub(*state.Start) > 90*24*time.Hour:
		state.MonthlyBuckets = true
	default:
		state.MonthlyBuckets = false
	}

	return state
}

func applyAdminUsageFilters(query *gorm.DB, q adminUsageFilterQuery, loc *time.Location, now time.Time, skipFields ...string) (*gorm.DB, adminUsageFilterState) {
	state := resolveAdminUsageFilterState(q, loc, now)
	skip := make(map[string]struct{}, len(skipFields))
	for _, field := range skipFields {
		skip[field] = struct{}{}
	}

	if _, ok := skip["range"]; !ok {
		if state.Start != nil {
			query = query.Where("requested_at >= ?", *state.Start)
		}
		if state.End != nil {
			query = query.Where("requested_at < ?", *state.End)
		}
	}
	if _, ok := skip["project"]; !ok && strings.TrimSpace(q.Project) != "" {
		query = query.Where("source = ?", strings.TrimSpace(q.Project))
	}
	if _, ok := skip["model"]; !ok && strings.TrimSpace(q.Model) != "" {
		query = query.Where("model = ?", strings.TrimSpace(q.Model))
	}
	if _, ok := skip["provider"]; !ok && strings.TrimSpace(q.Provider) != "" {
		query = query.Where("provider = ?", strings.TrimSpace(q.Provider))
	}

	return query, state
}

func adminUsageBucketExpr(db *gorm.DB, column string, monthly bool) string {
	if monthly {
		if dbutil.IsSQLite(db) {
			return fmt.Sprintf("strftime('%%Y-%%m', %s)", column)
		}
		return fmt.Sprintf("TO_CHAR(%s, 'YYYY-MM')", column)
	}
	if dbutil.IsSQLite(db) {
		return fmt.Sprintf("strftime('%%Y-%%m-%%d', %s)", column)
	}
	return fmt.Sprintf("TO_CHAR(%s, 'YYYY-MM-DD')", column)
}

func adminUsageProviderAggExpr(db *gorm.DB, column string) string {
	if dbutil.IsSQLite(db) {
		return fmt.Sprintf("COALESCE(GROUP_CONCAT(DISTINCT NULLIF(%s, '')), '')", column)
	}
	return fmt.Sprintf("COALESCE(STRING_AGG(DISTINCT NULLIF(%s, ''), ','), '')", column)
}

func adminUsageAvgDurationMsExpr(db *gorm.DB) string {
	if dbutil.IsSQLite(db) {
		return "COALESCE(AVG(MAX((julianday(created_at) - julianday(requested_at)) * 86400000.0, 0)), 0)"
	}
	return "COALESCE(AVG(GREATEST(EXTRACT(EPOCH FROM (created_at - requested_at)) * 1000, 0)), 0)"
}

func formatAdminUsageBucketLabel(bucket string, monthly bool) string {
	if monthly {
		if parsed, err := time.Parse("2006-01", bucket); err == nil {
			return parsed.Format("Jan 2006")
		}
		return bucket
	}
	if parsed, err := time.Parse("2006-01-02", bucket); err == nil {
		return parsed.Format("Jan 02")
	}
	return bucket
}

func adminUsagePeriodComparison(state adminUsageFilterState, loc *time.Location, now time.Time) (start time.Time, end time.Time, ok bool) {
	if loc == nil {
		loc = time.Local
	}
	now = now.In(loc)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	switch state.Range {
	case adminUsageRangeAuto, adminUsageRangeToday:
		return todayStart.AddDate(0, 0, -1), todayStart, true
	case adminUsageRangeLast7:
		return todayStart.AddDate(0, 0, -13), todayStart.AddDate(0, 0, -6), true
	case adminUsageRangeLast30:
		return todayStart.AddDate(0, 0, -59), todayStart.AddDate(0, 0, -29), true
	case adminUsageRangeMTD:
		currentMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		previousMonthStart := currentMonthStart.AddDate(0, -1, 0)
		elapsedDays := todayStart.Sub(currentMonthStart)
		return previousMonthStart, previousMonthStart.Add(elapsedDays).AddDate(0, 0, 1), true
	case adminUsageRangeAll:
		return time.Time{}, time.Time{}, false
	case adminUsageRangeCustom:
		if state.Start == nil || state.End == nil {
			return time.Time{}, time.Time{}, false
		}
		duration := state.End.Sub(*state.Start)
		if duration <= 0 {
			return time.Time{}, time.Time{}, false
		}
		return state.Start.Add(-duration), *state.Start, true
	default:
		if state.Start != nil && state.End != nil {
			duration := state.End.Sub(*state.Start)
			if duration > 0 {
				return state.Start.Add(-duration), *state.Start, true
			}
		}
		return time.Time{}, time.Time{}, false
	}
}
