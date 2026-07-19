import { describe, expect, it } from "vitest";
import { performanceStatistics, percentile, standardDeviation } from "../../src/performance/performance-normalizer.js";
import { assessCoreWebVitals, performanceConfidence, scorePerformance } from "../../src/performance/performance-scoring.js";
import { performanceResultSchema, PERFORMANCE_SCHEMA_VERSION, type PerformanceResult } from "../../src/performance/performance-schema.js";
import { resolveChromePath } from "../../src/performance/local/chrome-launcher.js";
import { comparePerformance } from "../../src/diff/compare-performance.js";
import { seoBaselineSchema, type SeoBaseline } from "../../src/baseline/baseline-schema.js";

function perf(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url: "https://example.com/", source: "local", engine: "lighthouse", scoreKind: "official-lighthouse", executionEnvironment: "local", scope: "url", device: "mobile", collectedAt: "now", metrics: { lcpMs: 1200, cls: 0.02, tbtMs: 50, ttfbMs: 120 }, resources: { transferBytes: 100000, requestCount: 8 }, scores: { performance: 95 }, lighthousePerformanceScore: 95, warnings: [], confidence: "medium", ...overrides });
}

function baseline(p: PerformanceResult): SeoBaseline {
  return seoBaselineSchema.parse({ schemaVersion: "1.0.0", baseline: { name: "b", createdAt: "now", startUrl: "https://example.com/", normalizedOrigin: "https://example.com/", auditMode: "sitewide", toolVersion: "0.1.0" }, configuration: {}, snapshot: { globalScore: 90, categoryScores: {}, pages: [], issues: [], metrics: {}, performance: [p] } });
}

describe("performance statistics, engines, and CWV", () => {
  it("computes standard deviation", () => { expect(Math.round((standardDeviation([1, 2, 3]) ?? 0) * 100) / 100).toBe(0.82); });
  it("computes percentile", () => { expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5); });
  it("computes median/min/max", () => { expect(performanceStatistics([4, 1, 9])?.median).toBe(4); expect(performanceStatistics([4, 1, 9])?.min).toBe(1); expect(performanceStatistics([4, 1, 9])?.max).toBe(9); });
  it("computes coefficient of variation", () => { expect(performanceStatistics([10, 20, 30])?.coefficientOfVariation).toBeGreaterThan(0); });
  it("computes interquartile range", () => { expect(performanceStatistics([1, 2, 3, 4, 5])?.iqr).toBe(2); });
  it("returns undefined statistics for empty samples", () => { expect(performanceStatistics([])).toBeUndefined(); });
  it("prefers field performance score", () => { expect(scorePerformance(perf({ source: "crux", engine: "crux", scoreKind: "field-data", fieldPerformanceScore: 81 }))).toBe(81); });
  it("prefers Lighthouse performance score over internal score", () => { expect(scorePerformance(perf({ lighthousePerformanceScore: 70, internalPerformanceScore: 99 }))).toBe(70); });
  it("uses internal score when no official score exists", () => { expect(scorePerformance(perf({ lighthousePerformanceScore: undefined, internalPerformanceScore: 66 }))).toBe(66); });
  it("does not call Playwright estimate official Lighthouse", () => { const r = perf({ engine: "playwright", scoreKind: "internal-estimate", lighthousePerformanceScore: undefined, internalPerformanceScore: 55 }); expect(r.scoreKind).toBe("internal-estimate"); });
  it("marks official Lighthouse confidence low for one run", () => { expect(performanceConfidence(perf({ runCount: 1 }))).toBe("low"); });
  it("marks official Lighthouse confidence medium for stable repeated runs", () => { expect(performanceConfidence(perf({ runCount: 3, warnings: [] }))).toBe("medium"); });
  it("marks high variance as low confidence", () => { expect(performanceConfidence(perf({ runCount: 3, warnings: ["High variance for lcpMs"] }))).toBe("low"); });
  it("passes CWV when field p75 values are good", () => { expect(assessCoreWebVitals(perf({ source: "crux", engine: "crux", scoreKind: "field-data", fieldData: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { p75: 2000 }, INTERACTION_TO_NEXT_PAINT: { p75: 100 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { p75: 0.05 } } } }))).toBe("passed"); });
  it("fails CWV on LCP", () => { expect(assessCoreWebVitals(perf({ fieldData: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { p75: 5000 }, INTERACTION_TO_NEXT_PAINT: { p75: 100 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { p75: 0.05 } } } }))).toBe("failed"); });
  it("fails CWV on INP", () => { expect(assessCoreWebVitals(perf({ fieldData: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { p75: 1000 }, INTERACTION_TO_NEXT_PAINT: { p75: 700 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { p75: 0.05 } } } }))).toBe("failed"); });
  it("fails CWV on CLS", () => { expect(assessCoreWebVitals(perf({ fieldData: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { p75: 1000 }, INTERACTION_TO_NEXT_PAINT: { p75: 100 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { p75: 0.4 } } } }))).toBe("failed"); });
  it("returns insufficient CWV data for partial fields", () => { expect(assessCoreWebVitals(perf({ fieldData: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { p75: 1000 } } } }))).toBe("insufficient-data"); });
  it("returns insufficient CWV data when absent", () => { expect(assessCoreWebVitals(perf())).toBe("insufficient-data"); });
  it("resolves explicit existing Chrome-like path", () => { expect(resolveChromePath(process.execPath).source).toBe("explicit"); });
  it("throws for missing explicit Chrome path", () => { expect(() => resolveChromePath("C:/definitely/missing/chrome.exe")).toThrow(/not found/i); });
  it("detects engine changes in performance diff", () => { const diff = comparePerformance(baseline(perf()), baseline(perf({ engine: "playwright", scoreKind: "internal-estimate", lighthousePerformanceScore: undefined, internalPerformanceScore: 80 }))); expect(diff.regressions.some((item) => item.id.includes("engine-scorekind"))).toBe(true); });
  it("detects variance changes in performance diff", () => { const diff = comparePerformance(baseline(perf({ statistics: { coefficientOfVariation: 0.01 } })), baseline(perf({ statistics: { coefficientOfVariation: 0.5 } }))); expect(diff.regressions.some((item) => item.id.includes("coefficientOfVariation"))).toBe(true); });
  it("detects unused JavaScript changes in performance diff", () => { const diff = comparePerformance(baseline(perf({ diagnostics: { unusedJavascriptBytes: 1000 } })), baseline(perf({ diagnostics: { unusedJavascriptBytes: 100000 } }))); expect(diff.regressions.some((item) => item.id.includes("unusedJavascriptBytes"))).toBe(true); });
  it("keeps small score changes within noise unchanged", () => { const diff = comparePerformance(baseline(perf({ lighthousePerformanceScore: 95 })), baseline(perf({ lighthousePerformanceScore: 93 }))); expect(diff.regressions.some((item) => item.id.includes("performanceScore"))).toBe(false); });
});