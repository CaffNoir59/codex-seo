import { compareHistoryCompatibility } from "../history/history-compatibility.js";
import type { HistoryEntry } from "../history/history-schema.js";
import { detectRecurringIssues } from "../analyzers/recurring-issues.js";
import { buildTrendSeries } from "./trend-series.js";
import { trendMetrics, type TrendMetric } from "./trend-metrics.js";
import { TREND_SCHEMA_VERSION, trendReportSchema, type TrendReport } from "./trend-schema.js";

export type TrendOptions = { metrics?: TrendMetric[]; since?: string; until?: string; minConfidence?: "low" | "medium" | "high"; thresholds?: Partial<Record<TrendMetric, number>> };

export function buildTrendReport(entries: HistoryEntry[], options: TrendOptions = {}): TrendReport {
  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const compatibility = compareHistoryCompatibility(ordered);
  const metrics = options.metrics ?? ["seo.score", "performance.lighthouseScore", "performance.lcpMs", "gsc.clicks"];
  const series = metrics.map((metric) => buildTrendSeries(ordered, metric, options.thresholds)).filter((item) => item.points.length > 0);
  const confidenceOrder = { "insufficient-data": 0, low: 1, medium: 2, high: 3 };
  const confidence = series.length ? series.reduce((lowest, item) => confidenceOrder[item.confidence] < confidenceOrder[lowest] ? item.confidence : lowest, "high" as TrendReport["confidence"]) : "insufficient-data";
  return trendReportSchema.parse({ schemaVersion: TREND_SCHEMA_VERSION, generatedAt: new Date().toISOString(), period: { since: options.since, until: options.until }, entries: ordered.length, compatibleEntries: compatibility.compatible ? ordered.length : 0, compatibility, confidence, series, recurringIssues: detectRecurringIssues(ordered) });
}

export { trendMetrics };