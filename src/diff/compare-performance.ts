import type { SeoBaseline } from "../baseline/baseline-schema.js";
import type { PerformanceDiff, Regression, Improvement } from "./diff-schema.js";
import { defaultPerformanceThresholds } from "../performance/performance-scoring.js";

function keyOf(result: SeoBaseline["snapshot"]["performance"][number]): string {
  return `${result.source}|${result.device}|${result.scope}|${result.url}`;
}
function metricValue(result: SeoBaseline["snapshot"]["performance"][number], metric: string): number | undefined {
  if (metric === "performanceScore") return result.lighthousePerformanceScore ?? result.internalPerformanceScore ?? result.fieldPerformanceScore ?? result.scores?.performance;
  if (metric === "coefficientOfVariation") return result.statistics?.coefficientOfVariation;
  if (metric === "unusedJavascriptBytes") return result.diagnostics?.unusedJavascriptBytes;
  if (metric === "transferBytes") return result.resources?.transferBytes;
  if (metric === "requestCount") return result.resources?.requestCount;
  return (result.metrics as Record<string, number | undefined>)[metric];
}
function threshold(metric: string, previous?: number): number {
  if (metric === "lcpMs") return defaultPerformanceThresholds.lcpDeltaMs;
  if (metric === "inpMs") return defaultPerformanceThresholds.inpDeltaMs;
  if (metric === "tbtMs") return defaultPerformanceThresholds.tbtDeltaMs;
  if (metric === "cls") return defaultPerformanceThresholds.clsDelta;
  if (metric === "ttfbMs") return defaultPerformanceThresholds.ttfbDeltaMs;
  if (metric === "performanceScore") return defaultPerformanceThresholds.performanceScoreDelta;
  if (metric === "requestCount") return defaultPerformanceThresholds.requestDelta;
  if (metric === "coefficientOfVariation") return 0.1;
  if (metric === "unusedJavascriptBytes") return 50000;
  if (metric === "transferBytes") return Math.max(1, (previous ?? 0) * defaultPerformanceThresholds.transferRatio);
  return 0;
}
function lowerIsBetter(metric: string): boolean { return metric !== "performanceScore"; }

export function comparePerformance(previous: SeoBaseline, current: SeoBaseline): { changes: PerformanceDiff[]; regressions: Regression[]; improvements: Improvement[] } {
  const previousPerformance = previous.snapshot.performance ?? [];
  const currentPerformance = current.snapshot.performance ?? [];
  const prev = new Map(previousPerformance.map((item) => [keyOf(item), item]));
  const curr = new Map(currentPerformance.map((item) => [keyOf(item), item]));
  const changes: PerformanceDiff[] = [];
  const regressions: Regression[] = [];
  const improvements: Improvement[] = [];
  const metrics = ["performanceScore", "lcpMs", "cls", "inpMs", "tbtMs", "ttfbMs", "transferBytes", "requestCount", "coefficientOfVariation", "unusedJavascriptBytes"];
  for (const [key, before] of prev) {
    const after = curr.get(key);
    if (!after) {
      changes.push({ key, source: before.source, device: before.device, url: before.url, metric: "fieldData", direction: before.source === "crux" ? "lost" : "unchanged", confidence: "medium", ignored: false });
      if (before.source === "crux") regressions.push({ id: `performance.field-data-lost.${key}`, category: "performance", severity: "medium", affectedUrl: before.url, previousValue: "available", currentValue: "missing", explanation: "Field performance data was available before but is missing now.", recommendation: "Check CrUX availability and compare with lab fallback before release decisions.", confidence: "medium", ignored: false });
      continue;
    }
    if (before.engine !== after.engine || before.scoreKind !== after.scoreKind) regressions.push({ id: `performance.engine-scorekind-changed.${key}`, category: "performance", severity: "medium", affectedUrl: after.url, previousValue: `${before.engine ?? before.source}/${before.scoreKind ?? "unknown"}`, currentValue: `${after.engine ?? after.source}/${after.scoreKind ?? "unknown"}`, explanation: "Performance engine or score kind changed between snapshots.", recommendation: "Compare only compatible official Lighthouse, internal estimate, or field-data results for release gates.", confidence: "medium", ignored: false });
    if (before.device !== after.device || before.source !== after.source) regressions.push({ id: `performance.source-device-changed.${key}`, category: "performance", severity: "medium", affectedUrl: after.url, previousValue: `${before.source}/${before.device}`, currentValue: `${after.source}/${after.device}`, explanation: "Performance source or device changed between snapshots.", recommendation: "Compare equivalent lab/field and mobile/desktop data for gate decisions.", confidence: "high", ignored: false });
    for (const metric of metrics) {
      const oldValue = metricValue(before, metric);
      const newValue = metricValue(after, metric);
      if (oldValue === undefined && newValue === undefined) continue;
      const delta = newValue !== undefined && oldValue !== undefined ? newValue - oldValue : undefined;
      const noise = threshold(metric, oldValue);
      let direction: PerformanceDiff["direction"] = "unchanged";
      if (oldValue === undefined && newValue !== undefined) direction = "gained";
      else if (oldValue !== undefined && newValue === undefined) direction = "lost";
      else if (delta !== undefined && Math.abs(delta) > noise) {
        const regressed = lowerIsBetter(metric) ? delta > 0 : delta < 0;
        direction = regressed ? "regressed" : "improved";
      }
      const change: PerformanceDiff = { key: `${key}|${metric}`, source: after.source, device: after.device, url: after.url, metric, previous: oldValue, current: newValue, delta, threshold: noise, direction, confidence: after.confidence, ignored: false };
      changes.push(change);
      if (direction === "regressed") regressions.push({ id: `performance.${metric}.regressed.${key}`, category: "performance", severity: metric === "performanceScore" ? "medium" : "high", affectedUrl: after.url, previousValue: oldValue, currentValue: newValue, explanation: `${metric} regressed beyond the noise threshold (${noise}).`, recommendation: "Inspect lab and field data, resource weight, server timing, and JavaScript execution.", confidence: after.confidence, ignored: false });
      if (direction === "improved") improvements.push({ id: `performance.${metric}.improved.${key}`, category: "performance", affectedUrl: after.url, previousValue: oldValue, currentValue: newValue, explanation: `${metric} improved beyond the noise threshold (${noise}).`, recommendation: "Keep the changes that improved this metric and monitor stability.", confidence: after.confidence, ignored: false });
    }
  }
  for (const [key, after] of curr) if (!prev.has(key)) changes.push({ key, source: after.source, device: after.device, url: after.url, metric: "result", direction: "gained", confidence: after.confidence, ignored: false });
  return { changes: changes.sort((a, b) => a.key.localeCompare(b.key)), regressions: regressions.sort((a, b) => a.id.localeCompare(b.id)), improvements: improvements.sort((a, b) => a.id.localeCompare(b.id)) };
}
