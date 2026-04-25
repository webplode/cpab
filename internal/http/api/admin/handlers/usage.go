package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPIBusiness/internal/models"
	"gorm.io/gorm"
)

// AdminUsageHandler serves filtered admin usage analytics.
type AdminUsageHandler struct {
	db *gorm.DB
}

// NewAdminUsageHandler constructs an AdminUsageHandler.
func NewAdminUsageHandler(db *gorm.DB) *AdminUsageHandler {
	return &AdminUsageHandler{db: db}
}

type adminUsageSummary struct {
	Requests         int64   `json:"requests"`
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	CachedTokens     int64   `json:"cached_tokens"`
	ReasoningTokens  int64   `json:"reasoning_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	CostMicros       int64   `json:"cost_micros"`
	AvgRequestTimeMs int64   `json:"avg_request_time_ms"`
	ErrorRate        float64 `json:"error_rate"`
}

type adminUsageTrendPoint struct {
	Label       string `json:"label"`
	Bucket      string `json:"bucket"`
	Requests    int64  `json:"requests"`
	TotalTokens int64  `json:"total_tokens"`
	CostMicros  int64  `json:"cost_micros"`
	FailedCount int64  `json:"failed_count"`
}

type adminUsageBreakdownItem struct {
	Name             string  `json:"name"`
	Requests         int64   `json:"requests"`
	TotalTokens      int64   `json:"total_tokens"`
	CostMicros       int64   `json:"cost_micros"`
	FailedCount      int64   `json:"failed_count"`
	ErrorRate        float64 `json:"error_rate"`
	AvgRequestTimeMs int64   `json:"avg_request_time_ms"`
}

type adminUsageRecentItem struct {
	Label            string  `json:"label"`
	Bucket           string  `json:"bucket"`
	Model            string  `json:"model"`
	Provider         string  `json:"provider"`
	Requests         int64   `json:"requests"`
	TotalTokens      int64   `json:"total_tokens"`
	CostMicros       int64   `json:"cost_micros"`
	FailedCount      int64   `json:"failed_count"`
	ErrorRate        float64 `json:"error_rate"`
	AvgRequestTimeMs int64   `json:"avg_request_time_ms"`
}

// Overview returns filtered usage analytics for the admin usage dashboard.
func (h *AdminUsageHandler) Overview(c *gin.Context) {
	var q adminUsageFilterQuery
	if errBind := c.ShouldBindQuery(&q); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid query"})
		return
	}

	ctx := c.Request.Context()
	loc := time.Local
	now := time.Now().In(loc)

	baseQuery, state := applyAdminUsageFilters(
		h.db.WithContext(ctx).Model(&models.Usage{}),
		q,
		loc,
		now,
	)

	type summaryRow struct {
		Requests         int64
		InputTokens      int64
		OutputTokens     int64
		CachedTokens     int64
		ReasoningTokens  int64
		TotalTokens      int64
		CostMicros       int64
		FailedCount      int64
		AvgRequestTimeMs float64
	}

	var summaryData summaryRow
	if errSummary := baseQuery.Session(&gorm.Session{}).
		Select(fmt.Sprintf(`
			COUNT(*) AS requests,
			COALESCE(SUM(input_tokens), 0) AS input_tokens,
			COALESCE(SUM(output_tokens), 0) AS output_tokens,
			COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
			COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
			COALESCE(SUM(total_tokens), 0) AS total_tokens,
			COALESCE(SUM(cost_micros), 0) AS cost_micros,
			COALESCE(SUM(CASE WHEN failed THEN 1 ELSE 0 END), 0) AS failed_count,
			%s AS avg_request_time_ms
		`, adminUsageAvgDurationMsExpr(h.db))).
		Scan(&summaryData).Error; errSummary != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query usage summary failed"})
		return
	}

	summary := adminUsageSummary{
		Requests:         summaryData.Requests,
		InputTokens:      summaryData.InputTokens,
		OutputTokens:     summaryData.OutputTokens,
		CachedTokens:     summaryData.CachedTokens,
		ReasoningTokens:  summaryData.ReasoningTokens,
		TotalTokens:      summaryData.TotalTokens,
		CostMicros:       summaryData.CostMicros,
		AvgRequestTimeMs: int64(math.Round(summaryData.AvgRequestTimeMs)),
		ErrorRate:        calcErrorRate(summaryData.FailedCount, summaryData.Requests),
	}

	bucketExpr := adminUsageBucketExpr(h.db, "requested_at", state.MonthlyBuckets)

	type trendRow struct {
		Bucket      string
		Requests    int64
		TotalTokens int64
		CostMicros  int64
		FailedCount int64
	}
	var trendRows []trendRow
	if errTrend := baseQuery.Session(&gorm.Session{}).
		Select(fmt.Sprintf(`
			%s AS bucket,
			COUNT(*) AS requests,
			COALESCE(SUM(total_tokens), 0) AS total_tokens,
			COALESCE(SUM(cost_micros), 0) AS cost_micros,
			COALESCE(SUM(CASE WHEN failed THEN 1 ELSE 0 END), 0) AS failed_count
		`, bucketExpr)).
		Group(bucketExpr).
		Order(bucketExpr).
		Scan(&trendRows).Error; errTrend != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query usage trend failed"})
		return
	}

	trend := make([]adminUsageTrendPoint, 0, len(trendRows))
	for _, row := range trendRows {
		trend = append(trend, adminUsageTrendPoint{
			Label:       formatAdminUsageBucketLabel(row.Bucket, state.MonthlyBuckets),
			Bucket:      row.Bucket,
			Requests:    row.Requests,
			TotalTokens: row.TotalTokens,
			CostMicros:  row.CostMicros,
			FailedCount: row.FailedCount,
		})
	}

	type breakdownRow struct {
		Name             string
		Requests         int64
		TotalTokens      int64
		CostMicros       int64
		FailedCount      int64
		AvgRequestTimeMs float64
	}
	buildBreakdown := func(column string) ([]adminUsageBreakdownItem, error) {
		var rows []breakdownRow
		if errScan := baseQuery.Session(&gorm.Session{}).
			Where(column + " <> ''").
			Select(fmt.Sprintf(`
				%s AS name,
				COUNT(*) AS requests,
				COALESCE(SUM(total_tokens), 0) AS total_tokens,
				COALESCE(SUM(cost_micros), 0) AS cost_micros,
				COALESCE(SUM(CASE WHEN failed THEN 1 ELSE 0 END), 0) AS failed_count,
				%s AS avg_request_time_ms
			`, column, adminUsageAvgDurationMsExpr(h.db))).
			Group(column).
			Order("cost_micros DESC, requests DESC").
			Limit(8).
			Scan(&rows).Error; errScan != nil {
			return nil, errScan
		}
		items := make([]adminUsageBreakdownItem, 0, len(rows))
		for _, row := range rows {
			items = append(items, adminUsageBreakdownItem{
				Name:             row.Name,
				Requests:         row.Requests,
				TotalTokens:      row.TotalTokens,
				CostMicros:       row.CostMicros,
				FailedCount:      row.FailedCount,
				ErrorRate:        calcErrorRate(row.FailedCount, row.Requests),
				AvgRequestTimeMs: int64(math.Round(row.AvgRequestTimeMs)),
			})
		}
		return items, nil
	}

	topModels, errModels := buildBreakdown("model")
	if errModels != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query top models failed"})
		return
	}
	topProviders, errProviders := buildBreakdown("provider")
	if errProviders != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query top providers failed"})
		return
	}

	type recentRow struct {
		Bucket           string
		Model            string
		Providers        string
		Requests         int64
		TotalTokens      int64
		CostMicros       int64
		FailedCount      int64
		AvgRequestTimeMs float64
	}
	var recentRows []recentRow
	if errRecent := baseQuery.Session(&gorm.Session{}).
		Select(fmt.Sprintf(`
			%s AS bucket,
			model,
			%s AS providers,
			COUNT(*) AS requests,
			COALESCE(SUM(total_tokens), 0) AS total_tokens,
			COALESCE(SUM(cost_micros), 0) AS cost_micros,
			COALESCE(SUM(CASE WHEN failed THEN 1 ELSE 0 END), 0) AS failed_count,
			%s AS avg_request_time_ms
		`, bucketExpr, adminUsageProviderAggExpr(h.db, "provider"), adminUsageAvgDurationMsExpr(h.db))).
		Group(bucketExpr + ", model").
		Order(bucketExpr + " DESC, requests DESC").
		Limit(12).
		Scan(&recentRows).Error; errRecent != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query recent usage failed"})
		return
	}

	recent := make([]adminUsageRecentItem, 0, len(recentRows))
	for _, row := range recentRows {
		recent = append(recent, adminUsageRecentItem{
			Label:            formatAdminUsageBucketLabel(row.Bucket, state.MonthlyBuckets),
			Bucket:           row.Bucket,
			Model:            row.Model,
			Provider:         strings.ReplaceAll(row.Providers, ",", ", "),
			Requests:         row.Requests,
			TotalTokens:      row.TotalTokens,
			CostMicros:       row.CostMicros,
			FailedCount:      row.FailedCount,
			ErrorRate:        calcErrorRate(row.FailedCount, row.Requests),
			AvgRequestTimeMs: int64(math.Round(row.AvgRequestTimeMs)),
		})
	}

	modelOptions := make([]string, 0)
	if errModelOptions := applyAdminUsageModelOptions(
		h.db.WithContext(ctx).Model(&models.Usage{}),
		q,
		loc,
		now,
	).Distinct("model").Where("model <> ''").Order("model").Pluck("model", &modelOptions).Error; errModelOptions != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query usage models failed"})
		return
	}

	providerOptions := make([]string, 0)
	if errProviderOptions := applyAdminUsageProviderOptions(
		h.db.WithContext(ctx).Model(&models.Usage{}),
		q,
		loc,
		now,
	).Distinct("provider").Where("provider <> ''").Order("provider").Pluck("provider", &providerOptions).Error; errProviderOptions != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query usage providers failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"summary":       summary,
		"trend":         trend,
		"top_models":    topModels,
		"top_providers": topProviders,
		"recent":        recent,
		"filters": gin.H{
			"range":               state.Range,
			"monthly_buckets":     state.MonthlyBuckets,
			"start_date":          strings.TrimSpace(q.StartDate),
			"end_date":            strings.TrimSpace(q.EndDate),
			"model":               strings.TrimSpace(q.Model),
			"provider":            strings.TrimSpace(q.Provider),
			"project":             strings.TrimSpace(q.Project),
			"available_models":    modelOptions,
			"available_providers": providerOptions,
		},
	})
}

func applyAdminUsageModelOptions(query *gorm.DB, q adminUsageFilterQuery, loc *time.Location, now time.Time) *gorm.DB {
	filtered, _ := applyAdminUsageFilters(query, q, loc, now, "model")
	return filtered
}

func applyAdminUsageProviderOptions(query *gorm.DB, q adminUsageFilterQuery, loc *time.Location, now time.Time) *gorm.DB {
	filtered, _ := applyAdminUsageFilters(query, q, loc, now, "provider")
	return filtered
}
