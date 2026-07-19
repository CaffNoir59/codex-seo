import type { SeoBaseline } from "../baseline/baseline-schema.js";
import type { GscMetricDelta, GscSearchAnalyticsRow } from "../gsc/gsc-schema.js";
import type { Improvement, Regression } from "./diff-schema.js";

export type GscDiff = {
  changes: Array<{ key: string; metric: string; previous?: number; current?: number; delta?: number; direction: "improved" | "regressed" | "unchanged" | "lost" | "gained"; confidence: "high" | "medium" | "low" }>;
  regressions: Regression[];
  improvements: Improvement[];
  compatibilityWarnings: string[];
};

function delta(previous: number, current: number): GscMetricDelta { return { previous, current, absoluteDelta: current - previous, relativeDelta: previous === 0 ? undefined : (current - previous) / previous }; }
function rowKey(row: GscSearchAnalyticsRow): string { return row.keys.page ?? row.keys.query ?? JSON.stringify(row.keys); }
function metricRegression(id: string, metric: string, d: GscMetricDelta, confidence: "high" | "medium" | "low"): Regression {
  return { id, category: "gsc", severity: Math.abs(d.relativeDelta ?? 0) > 0.3 ? "high" : "medium", previousValue: d.previous, currentValue: d.current, explanation: `${metric} changed by ${d.absoluteDelta}.`, recommendation: "Review GSC and technical changes for an observed association; do not infer causality without corroborating evidence.", confidence, ignored: false };
}

export function compareGsc(previous: SeoBaseline, current: SeoBaseline): GscDiff {
  const prev = previous.snapshot.gsc;
  const curr = current.snapshot.gsc;
  const changes: GscDiff["changes"] = [];
  const regressions: Regression[] = [];
  const improvements: Improvement[] = [];
  const compatibilityWarnings: string[] = [];
  if (!prev && !curr) return { changes, regressions, improvements, compatibilityWarnings };
  if (prev && !curr) {
    regressions.push({ id: "gsc.data-lost", category: "gsc", severity: "medium", previousValue: "present", currentValue: "missing", explanation: "GSC data disappeared from the current snapshot.", recommendation: "Verify credentials, property selection and data availability before interpreting traffic changes.", confidence: "medium", ignored: false });
    return { changes, regressions, improvements, compatibilityWarnings: ["GSC data is missing from current snapshot"] };
  }
  if (!prev || !curr || !prev.searchAnalytics || !curr.searchAnalytics) return { changes, regressions, improvements, compatibilityWarnings };
  const confidence: "high" | "medium" | "low" = prev.searchAnalytics.partial || curr.searchAnalytics.partial ? "medium" : "high";
  if (prev.property !== curr.property) compatibilityWarnings.push("GSC property changed");
  if (prev.searchAnalytics.searchType !== curr.searchAnalytics.searchType) compatibilityWarnings.push("GSC search type changed");
  if (prev.searchAnalytics.dimensions.join(",") !== curr.searchAnalytics.dimensions.join(",")) compatibilityWarnings.push("GSC dimensions changed");
  const totals = {
    clicks: delta(prev.searchAnalytics.totals.clicks, curr.searchAnalytics.totals.clicks),
    impressions: delta(prev.searchAnalytics.totals.impressions, curr.searchAnalytics.totals.impressions),
    ctr: delta(prev.searchAnalytics.totals.ctr, curr.searchAnalytics.totals.ctr),
    position: delta(prev.searchAnalytics.totals.weightedPosition ?? 0, curr.searchAnalytics.totals.weightedPosition ?? 0)
  };
  for (const [metric, d] of Object.entries(totals)) {
    const direction = metric === "position" ? d.absoluteDelta > 0.2 ? "regressed" : d.absoluteDelta < -0.2 ? "improved" : "unchanged" : d.absoluteDelta < 0 ? "regressed" : d.absoluteDelta > 0 ? "improved" : "unchanged";
    changes.push({ key: `gsc.total.${metric}`, metric, previous: d.previous, current: d.current, delta: d.absoluteDelta, direction, confidence });
    if (direction === "regressed" && Math.abs(d.relativeDelta ?? d.absoluteDelta) > (metric === "ctr" ? 0.1 : 0.15)) regressions.push(metricRegression(`gsc.${metric}.drop`, metric, d, confidence));
    if (direction === "improved" && Math.abs(d.relativeDelta ?? d.absoluteDelta) > 0.15) improvements.push({ id: `gsc.${metric}.improved`, category: "gsc", previousValue: d.previous, currentValue: d.current, explanation: `${metric} improved in GSC data.`, recommendation: "Keep monitoring to confirm this observed association is sustained.", confidence, ignored: false });
  }
  const prevRows = new Map(prev.searchAnalytics.rows.map((row) => [rowKey(row), row]));
  const currRows = new Map(curr.searchAnalytics.rows.map((row) => [rowKey(row), row]));
  for (const [key, row] of currRows) if (!prevRows.has(key)) changes.push({ key: `gsc.gained.${key}`, metric: "row", current: row.clicks, direction: "gained", confidence });
  for (const [key, row] of prevRows) if (!currRows.has(key)) changes.push({ key: `gsc.lost.${key}`, metric: "row", previous: row.clicks, direction: "lost", confidence });
  return { changes, regressions, improvements, compatibilityWarnings };
}