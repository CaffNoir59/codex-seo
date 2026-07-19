import type { HistoryEntry } from "../history/history-schema.js";
import { compareHistoryCompatibility } from "../history/history-compatibility.js";
import { defaultNoiseThresholds, metricDirections, metricValue, type TrendMetric } from "./trend-metrics.js";
import { absoluteDelta, coefficientOfVariation, iqrOutliers, linearSlope, max, mean, median, min, relativeDelta } from "./trend-statistics.js";
import { trendConfidence } from "./trend-confidence.js";
import { trendSeriesSchema, type TrendDirection, type TrendSeries } from "./trend-schema.js";

function classify(metric: TrendMetric, values: number[], threshold = defaultNoiseThresholds[metric]): TrendDirection {
  if (values.length < 3) return values.length < 2 ? "insufficient-data" : "stable";
  const first = values[0]!;
  const latest = values.at(-1)!;
  const delta = latest - first;
  const relative = Math.abs(first) > 1 && threshold < 1 ? Math.abs(delta / first) : Math.abs(delta);
  const slope = linearSlope(values);
  const cv = coefficientOfVariation(values);
  if (cv > 0.45 && Math.abs(delta) < Math.abs(first || 1) * 0.2) return "volatile";
  const signed = metricDirections[metric] === "higher-is-better" ? delta : -delta;
  const meaningful = threshold < 1 ? relative >= threshold : Math.abs(delta) >= threshold;
  if (!meaningful) return "stable";
  if (signed > 0 && Math.abs(slope) >= Math.abs(delta) / Math.max(1, values.length) * 0.45) return relative > (threshold < 1 ? threshold * 2 : threshold * 2) ? "strong-improvement" : "improvement";
  if (signed < 0 && Math.abs(slope) >= Math.abs(delta) / Math.max(1, values.length) * 0.45) return relative > (threshold < 1 ? threshold * 2 : threshold * 2) ? "strong-degradation" : "degradation";
  return signed > 0 ? "improvement" : "degradation";
}

export function buildTrendSeries(entries: HistoryEntry[], metric: TrendMetric, thresholds: Partial<Record<TrendMetric, number>> = {}): TrendSeries {
  const points = entries.map((entry) => ({ entry, value: metricValue(entry, metric) })).filter((item): item is { entry: HistoryEntry; value: number } => item.value !== undefined).map(({ entry, value }) => ({ historyId: entry.historyId, date: entry.createdAt, value, environment: entry.identity.environment, release: entry.identity.release, branch: entry.identity.branch, complete: entry.completeness.complete }));
  const values = points.map((point) => point.value);
  const compatibility = compareHistoryCompatibility(entries);
  return trendSeriesSchema.parse({ metric, points, first: values[0], latest: values.at(-1), min: min(values), max: max(values), mean: mean(values), median: median(values), absoluteDelta: absoluteDelta(values[0], values.at(-1)), relativeDelta: relativeDelta(values[0], values.at(-1)), slope: linearSlope(values), coefficientOfVariation: coefficientOfVariation(values), outliers: iqrOutliers(values), direction: classify(metric, values, thresholds[metric] ?? defaultNoiseThresholds[metric]), confidence: trendConfidence(entries, values, compatibility), warnings: values.length === 2 ? ["Only two points available; classify as comparison, not a statistically reliable trend."] : [] });
}