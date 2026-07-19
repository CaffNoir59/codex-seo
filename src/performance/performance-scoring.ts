import type { PerformanceResult } from "./performance-schema.js";

export const defaultPerformanceThresholds = {
  lcpGoodMs: 2500,
  lcpPoorMs: 4000,
  inpGoodMs: 200,
  inpPoorMs: 500,
  clsGood: 0.1,
  clsPoor: 0.25,
  tbtGoodMs: 200,
  tbtPoorMs: 600,
  ttfbGoodMs: 800,
  ttfbPoorMs: 1800,
  performanceScoreDelta: 3,
  lcpDeltaMs: 250,
  inpDeltaMs: 50,
  tbtDeltaMs: 100,
  clsDelta: 0.02,
  ttfbDeltaMs: 100,
  transferRatio: 0.1,
  requestDelta: 10
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreMetric(value: number | undefined, good: number, poor: number, lowerIsBetter = true): number | undefined {
  if (value === undefined) return undefined;
  if (lowerIsBetter) {
    if (value <= good) return 100;
    if (value > poor) return 0;
    return clamp(100 - ((value - good) / (poor - good)) * 100);
  }
  if (value >= good) return 100;
  if (value < poor) return 0;
  return clamp(((value - poor) / (good - poor)) * 100);
}

export function scorePerformance(result: PerformanceResult): number {
  if (result.error) return 0;
  if (result.fieldPerformanceScore !== undefined) return clamp(result.fieldPerformanceScore);
  if (result.source === "crux" && result.fieldData?.metrics) {
    const data = result.fieldData.metrics;
    const parts = [
      scoreMetric(data.LARGEST_CONTENTFUL_PAINT_MS?.p75, defaultPerformanceThresholds.lcpGoodMs, defaultPerformanceThresholds.lcpPoorMs),
      scoreMetric(data.INTERACTION_TO_NEXT_PAINT?.p75, defaultPerformanceThresholds.inpGoodMs, defaultPerformanceThresholds.inpPoorMs),
      scoreMetric(data.CUMULATIVE_LAYOUT_SHIFT_SCORE?.p75, defaultPerformanceThresholds.clsGood, defaultPerformanceThresholds.clsPoor),
      scoreMetric(data.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.p75, defaultPerformanceThresholds.ttfbGoodMs, defaultPerformanceThresholds.ttfbPoorMs)
    ].filter((value): value is number => value !== undefined);
    return parts.length ? clamp(parts.reduce((sum, value) => sum + value, 0) / parts.length) : 0;
  }
  if (result.lighthousePerformanceScore !== undefined) return clamp(result.lighthousePerformanceScore);
  if (result.internalPerformanceScore !== undefined) return clamp(result.internalPerformanceScore);
  if (result.scores?.performance !== undefined) return clamp(result.scores.performance);
  const parts = [
    scoreMetric(result.metrics.lcpMs, defaultPerformanceThresholds.lcpGoodMs, defaultPerformanceThresholds.lcpPoorMs),
    scoreMetric(result.metrics.tbtMs, defaultPerformanceThresholds.tbtGoodMs, defaultPerformanceThresholds.tbtPoorMs),
    scoreMetric(result.metrics.cls, defaultPerformanceThresholds.clsGood, defaultPerformanceThresholds.clsPoor),
    scoreMetric(result.metrics.ttfbMs, defaultPerformanceThresholds.ttfbGoodMs, defaultPerformanceThresholds.ttfbPoorMs)
  ].filter((value): value is number => value !== undefined);
  return parts.length ? clamp(parts.reduce((sum, value) => sum + value, 0) / parts.length) : 0;
}

export function performanceConfidence(result: PerformanceResult): "high" | "medium" | "low" {
  if (result.error) return "low";
  if (result.source === "crux") return result.fieldData?.metrics ? "high" : "low";
  if ((result.runCount ?? 1) >= 3 && !result.warnings.some((warning) => /variance/i.test(warning))) return "medium";
  return "low";
}

export function assessCoreWebVitals(result: PerformanceResult): "passed" | "failed" | "insufficient-data" {
  const data = result.fieldData?.metrics;
  if (!data) return "insufficient-data";
  const lcp = data.LARGEST_CONTENTFUL_PAINT_MS?.p75 ?? result.metrics.lcpMs;
  const inp = data.INTERACTION_TO_NEXT_PAINT?.p75 ?? result.metrics.inpMs;
  const cls = data.CUMULATIVE_LAYOUT_SHIFT_SCORE?.p75 ?? result.metrics.cls;
  if (lcp === undefined || inp === undefined || cls === undefined) return "insufficient-data";
  return lcp <= defaultPerformanceThresholds.lcpGoodMs && inp <= defaultPerformanceThresholds.inpGoodMs && cls <= defaultPerformanceThresholds.clsGood ? "passed" : "failed";
}