import { gscPeriodComparisonSchema, type GscMetricDelta, type GscPeriodComparison, type GscSearchAnalyticsResult, type GscSearchAnalyticsRow } from "./gsc-schema.js";

function delta(previous: number, current: number): GscMetricDelta {
  return { previous, current, absoluteDelta: current - previous, relativeDelta: previous === 0 ? undefined : (current - previous) / previous };
}
function key(row: GscSearchAnalyticsRow, field: "page" | "query"): string | undefined { return row.keys[field]; }
function byMetric(rows: GscSearchAnalyticsRow[], metric: "clicks" | "impressions", direction: "up" | "down"): GscSearchAnalyticsRow[] {
  return [...rows].filter((row) => row.impressions >= 100).sort((a, b) => direction === "up" ? b[metric] - a[metric] : a[metric] - b[metric]).slice(0, 10);
}
function mapBy(rows: GscSearchAnalyticsRow[], field: "page" | "query"): Map<string, GscSearchAnalyticsRow> {
  const map = new Map<string, GscSearchAnalyticsRow>();
  for (const row of rows) { const item = key(row, field); if (item) map.set(item, row); }
  return map;
}
function days(start: string, end: string): number { return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1; }

export function compareGscPeriods(previous: GscSearchAnalyticsResult, current: GscSearchAnalyticsResult, minVolume = 100): GscPeriodComparison {
  const comparable = previous.property === current.property && previous.searchType === current.searchType && previous.dimensions.join(",") === current.dimensions.join(",") && days(previous.startDate, previous.endDate) === days(current.startDate, current.endDate);
  const previousQueries = mapBy(previous.rows, "query");
  const currentQueries = mapBy(current.rows, "query");
  const newQueries = [...currentQueries].filter(([query, row]) => !previousQueries.has(query) && row.impressions >= minVolume).map(([, row]) => row);
  const lostQueries = [...previousQueries].filter(([query, row]) => !currentQueries.has(query) && row.impressions >= minVolume).map(([, row]) => row);
  return gscPeriodComparisonSchema.parse({
    currentPeriod: { startDate: current.startDate, endDate: current.endDate, days: days(current.startDate, current.endDate) },
    previousPeriod: { startDate: previous.startDate, endDate: previous.endDate, days: days(previous.startDate, previous.endDate) },
    compatible: comparable,
    confidence: comparable && !previous.partial && !current.partial ? "high" : comparable ? "medium" : "low",
    warnings: comparable ? [] : ["GSC periods or dimensions are not fully comparable"],
    totals: {
      clicks: delta(previous.totals.clicks, current.totals.clicks),
      impressions: delta(previous.totals.impressions, current.totals.impressions),
      ctr: delta(previous.totals.ctr, current.totals.ctr),
      position: delta(previous.totals.weightedPosition ?? 0, current.totals.weightedPosition ?? 0)
    },
    winningPages: byMetric(current.rows, "clicks", "up"),
    losingPages: byMetric(previous.rows, "clicks", "up").filter((row) => (current.rows.find((item) => item.keys.page === row.keys.page)?.clicks ?? 0) < row.clicks * 0.8),
    winningQueries: byMetric(current.rows, "clicks", "up"),
    losingQueries: byMetric(previous.rows, "clicks", "up").filter((row) => (current.rows.find((item) => item.keys.query === row.keys.query)?.clicks ?? 0) < row.clicks * 0.8),
    newQueries,
    lostQueries
  });
}