import { describe, expect, it } from "vitest";
import { seoBaselineSchema, type SeoBaseline } from "../../src/baseline/baseline-schema.js";
import { comparePerformance } from "../../src/diff/compare-performance.js";
import { compareBaselines } from "../../src/diff/compare-reports.js";
import { defaultGateOptions, evaluateQualityGate } from "../../src/diff/quality-gate.js";
import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceResult } from "../../src/performance/performance-schema.js";

function perf(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url: "https://example.com/", source: "local", scope: "url", device: "mobile", collectedAt: "2026-07-17T00:00:00.000Z", scores: { performance: 90 }, metrics: { lcpMs: 1800, cls: 0.05, inpMs: 120, tbtMs: 80, ttfbMs: 250 }, resources: { transferBytes: 200000, requestCount: 20 }, warnings: [], confidence: "medium", ...overrides });
}

function baseline(name: string, performance: PerformanceResult[]): SeoBaseline {
  return seoBaselineSchema.parse({ schemaVersion: "1.0.0", baseline: { name, createdAt: "now", startUrl: "https://example.com/", normalizedOrigin: "https://example.com/", auditMode: "sitewide", toolVersion: "0.1.0" }, configuration: {}, snapshot: { globalScore: 90, categoryScores: { technical: 90 }, pages: [], issues: [], metrics: {}, performance } });
}

describe("performance diff and quality gates", () => {
  it("detects performance score regressions", () => {
    const diff = comparePerformance(baseline("old", [perf()]), baseline("new", [perf({ scores: { performance: 70 } })]));
    expect(diff.regressions.some((item) => item.id.includes("performanceScore"))).toBe(true);
  });

  it("detects LCP regressions beyond noise", () => {
    const diff = comparePerformance(baseline("old", [perf()]), baseline("new", [perf({ metrics: { lcpMs: 3200, cls: 0.05, inpMs: 120, tbtMs: 80, ttfbMs: 250 } })]));
    expect(diff.regressions.some((item) => item.id.includes("lcpMs"))).toBe(true);
  });

  it("detects CLS regressions", () => {
    const diff = comparePerformance(baseline("old", [perf()]), baseline("new", [perf({ metrics: { lcpMs: 1800, cls: 0.3, inpMs: 120, tbtMs: 80, ttfbMs: 250 } })]));
    expect(diff.regressions.some((item) => item.id.includes("cls"))).toBe(true);
  });

  it("detects resource weight regressions", () => {
    const diff = comparePerformance(baseline("old", [perf()]), baseline("new", [perf({ resources: { transferBytes: 600000, requestCount: 20 } })]));
    expect(diff.regressions.some((item) => item.id.includes("transferBytes"))).toBe(true);
  });

  it("detects request count regressions", () => {
    const diff = comparePerformance(baseline("old", [perf()]), baseline("new", [perf({ resources: { transferBytes: 200000, requestCount: 60 } })]));
    expect(diff.regressions.some((item) => item.id.includes("requestCount"))).toBe(true);
  });

  it("detects improvements", () => {
    const diff = comparePerformance(baseline("old", [perf({ scores: { performance: 70 } })]), baseline("new", [perf({ scores: { performance: 90 } })]));
    expect(diff.improvements.some((item) => item.id.includes("performanceScore"))).toBe(true);
  });

  it("detects gained performance result entries", () => {
    const diff = comparePerformance(baseline("old", []), baseline("new", [perf()]));
    expect(diff.changes.some((item) => item.direction === "gained")).toBe(true);
  });

  it("detects lost CrUX field data as a regression", () => {
    const diff = comparePerformance(baseline("old", [perf({ source: "crux", scope: "url", fieldData: { metrics: { LCP: { p75: 1800 } } } })]), baseline("new", []));
    expect(diff.regressions.some((item) => item.id.includes("field-data-lost"))).toBe(true);
  });

  it("includes performance changes in full baseline comparisons", () => {
    const diff = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ scores: { performance: 70 } })]), { gate: defaultGateOptions });
    expect(diff.performanceChanges.length).toBeGreaterThan(0);
    expect(diff.scoreExplanation.explanation).toContain("global score");
  });

  it("fails gate on maximum performance score drop", () => {
    const report = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ scores: { performance: 70 } })]), { gate: { ...defaultGateOptions, maxPerformanceScoreDrop: 5 } });
    expect(report.gate.passed).toBe(false);
  });

  it("fails gate on minimum performance score", () => {
    const report = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ scores: { performance: 70 } })]), { gate: { ...defaultGateOptions, minPerformanceScore: 80 } });
    expect(report.gate.reasons.some((reason) => reason.includes("Performance score"))).toBe(true);
  });

  it("fails gate on LCP ceiling", () => {
    const report = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ metrics: { lcpMs: 4200, cls: 0.05, inpMs: 120, tbtMs: 80, ttfbMs: 250 } })]), { gate: { ...defaultGateOptions, maxLcp: 2500 } });
    expect(report.gate.reasons.some((reason) => reason.includes("LCP exceeded"))).toBe(true);
  });

  it("fails gate on CLS ceiling", () => {
    const report = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ metrics: { lcpMs: 1800, cls: 0.4, inpMs: 120, tbtMs: 80, ttfbMs: 250 } })]), { gate: { ...defaultGateOptions, maxCls: 0.1 } });
    expect(report.gate.reasons.some((reason) => reason.includes("CLS exceeded"))).toBe(true);
  });

  it("fails gate on INP, TBT, and TTFB ceilings", () => {
    const diff = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ metrics: { lcpMs: 1800, cls: 0.05, inpMs: 700, tbtMs: 900, ttfbMs: 2000 } })]), { gate: { ...defaultGateOptions, maxInp: 200, maxTbt: 300, maxTtfb: 800 } });
    expect(diff.gate.reasons.join("\n")).toContain("INP exceeded");
    expect(diff.gate.reasons.join("\n")).toContain("TBT exceeded");
    expect(diff.gate.reasons.join("\n")).toContain("TTFB exceeded");
  });

  it("fails gate on LCP and CLS regression deltas", () => {
    const report = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ metrics: { lcpMs: 3600, cls: 0.25, inpMs: 120, tbtMs: 80, ttfbMs: 250 } })]), { gate: { ...defaultGateOptions, maxLcpRegressionMs: 500, maxClsRegression: 0.05 } });
    expect(report.gate.reasons.join("\n")).toContain("LCP regression exceeded");
    expect(report.gate.reasons.join("\n")).toContain("CLS regression exceeded");
  });

  it("passes gate when performance regressions stay within limits", () => {
    const report = compareBaselines(baseline("old", [perf()]), baseline("new", [perf({ scores: { performance: 86 } })]), { gate: { ...defaultGateOptions, maxPerformanceScoreDrop: 10 } });
    expect(report.gate.passed).toBe(true);
  });

  it("can evaluate a synthetic performance regression report directly", () => {
    const gate = evaluateQualityGate({ summary: { previousScore: 90, currentScore: 90, scoreDelta: 0, regressionCount: 1, improvementCount: 0, unchangedCount: 0, pagesAdded: 0, pagesRemoved: 0, issuesIntroduced: 0, issuesResolved: 0, issuesPersisting: 0 }, issues: { changed: [], introduced: [], resolved: [], persisting: [] }, regressions: [{ id: "performance.lcpMs.regressed.local", category: "performance", severity: "high", previousValue: 1000, currentValue: 4000, explanation: "x", recommendation: "x", confidence: "medium", ignored: false }] }, { ...defaultGateOptions, maxLcp: 2500 });
    expect(gate.passed).toBe(false);
  });
});