import { describe, expect, it } from "vitest";
import { analyzePerformanceResults } from "../../src/analyzers/performance.js";
import { evaluateQualityGate, defaultGateOptions } from "../../src/diff/quality-gate.js";
import { renderPerformanceSection, performanceStyles } from "../../src/reporting/performance-report.js";
import { performanceResultSchema, PERFORMANCE_SCHEMA_VERSION, type PerformanceResult } from "../../src/performance/performance-schema.js";

function perf(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url: "https://example.com/<x>", finalUrl: "https://example.com/%3Cx%3E", source: "local", engine: "lighthouse", scoreKind: "official-lighthouse", executionEnvironment: "local", scope: "url", device: "mobile", collectedAt: "now", runCount: 3, lighthousePerformanceScore: 80, internalPerformanceScore: 75, scores: { performance: 80 }, metrics: { lcpMs: 2600, cls: 0.12, inpMs: 220, tbtMs: 250, fcpMs: 900, speedIndexMs: 2100, ttfbMs: 500 }, resources: { transferBytes: 1000000, javascriptBytes: 300000, cssBytes: 50000, imageBytes: 400000, fontBytes: 20000, requestCount: 30 }, diagnostics: { unusedJavascriptBytes: 300000, unusedCssBytes: 120000, renderBlockingResources: 2, longTaskCount: 3, mainThreadWorkMs: 900, bootupTimeMs: 300 }, opportunities: [{ id: "unused-javascript", title: "Reduce unused JS", estimatedSavingsBytes: 100000, recommendation: "Split code" }], warnings: [], confidence: "medium", statistics: { coefficientOfVariation: 0.2 }, ...overrides });
}

function gateReport(regressions: any[]) {
  return { summary: { previousScore: 90, currentScore: 90, scoreDelta: 0, regressionCount: regressions.length, improvementCount: 0, unchangedCount: 0, pagesAdded: 0, pagesRemoved: 0, issuesIntroduced: 0, issuesResolved: 0, issuesPersisting: 0 }, issues: { changed: [], introduced: [], resolved: [], persisting: [] }, regressions };
}

describe("performance gates and report rendering", () => {
  it("emits unused JavaScript issue", () => { expect(analyzePerformanceResults([perf()]).some((issue) => issue.id === "performance.unused-javascript")).toBe(true); });
  it("emits unused CSS issue", () => { expect(analyzePerformanceResults([perf()]).some((issue) => issue.id === "performance.unused-css")).toBe(true); });
  it("emits render-blocking issue", () => { expect(analyzePerformanceResults([perf()]).some((issue) => issue.id === "performance.render-blocking-resources")).toBe(true); });
  it("emits long-task issue", () => { expect(analyzePerformanceResults([perf()]).some((issue) => issue.id === "performance.long-tasks")).toBe(true); });
  it("includes engine and scoreKind in issue evidence", () => { const issue = analyzePerformanceResults([perf()])[0]; expect(issue.evidence).toMatchObject({ engine: "lighthouse", scoreKind: "official-lighthouse" }); });
  it("fails gate for official Lighthouse missing", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.engine-scorekind-changed.x", category: "performance", severity: "medium", previousValue: "lighthouse/official-lighthouse", currentValue: "playwright/internal-estimate", explanation: "x", recommendation: "x", confidence: "medium", ignored: false }]), { ...defaultGateOptions, requireOfficialLighthouse: true }); expect(gate.passed).toBe(false); });
  it("fails gate for field data lost", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.field-data-lost.x", category: "performance", severity: "medium", previousValue: "available", currentValue: "missing", explanation: "x", recommendation: "x", confidence: "medium", ignored: false }]), { ...defaultGateOptions, requireFieldData: true }); expect(gate.passed).toBe(false); });
  it("fails gate for excessive variance", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.coefficientOfVariation.regressed.x", category: "performance", severity: "high", previousValue: 0.1, currentValue: 0.5, explanation: "x", recommendation: "x", confidence: "low", ignored: false }]), { ...defaultGateOptions, maxPerformanceVariance: 0.2 }); expect(gate.reasons.join(" ")).toContain("variance"); });
  it("fails gate for unused JavaScript", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.unusedJavascriptBytes.regressed.x", category: "performance", severity: "high", previousValue: 0, currentValue: 500000, explanation: "x", recommendation: "x", confidence: "medium", ignored: false }]), { ...defaultGateOptions, maxUnusedJavascriptBytes: 100000 }); expect(gate.reasons.join(" ")).toContain("Unused JavaScript"); });
  it("fails gate for transfer bytes", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.transferBytes.regressed.x", category: "performance", severity: "high", previousValue: 1, currentValue: 5000000, explanation: "x", recommendation: "x", confidence: "medium", ignored: false }]), { ...defaultGateOptions, maxTotalTransferBytes: 1000000 }); expect(gate.reasons.join(" ")).toContain("Total transfer"); });
  it("fails gate for request count", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.requestCount.regressed.x", category: "performance", severity: "high", previousValue: 10, currentValue: 100, explanation: "x", recommendation: "x", confidence: "medium", ignored: false }]), { ...defaultGateOptions, maxRequestCount: 50 }); expect(gate.reasons.join(" ")).toContain("Request count"); });
  it("passes gate when ignored", () => { const gate = evaluateQualityGate(gateReport([{ id: "performance.requestCount.regressed.x", category: "performance", severity: "high", previousValue: 10, currentValue: 100, explanation: "x", recommendation: "x", confidence: "medium", ignored: true }]), { ...defaultGateOptions, maxRequestCount: 50 }); expect(gate.passed).toBe(true); });
  it("renders performance section", () => { expect(renderPerformanceSection([perf()])).toContain("Performance"); });
  it("renders engine visible", () => { expect(renderPerformanceSection([perf()])).toContain("lighthouse"); });
  it("renders scoreKind visible", () => { expect(renderPerformanceSection([perf()])).toContain("official-lighthouse"); });
  it("renders Lighthouse and internal scores separately", () => { const html = renderPerformanceSection([perf()]); expect(html).toContain("Lighthouse score"); expect(html).toContain("Internal score"); });
  it("renders INP and TBT as separate cards", () => { const html = renderPerformanceSection([perf()]); expect(html.match(/<strong>INP<\/strong>/g)?.length).toBe(1); expect(html.match(/<strong>TBT<\/strong>/g)?.length).toBe(1); });
  it("renders resources", () => { expect(renderPerformanceSection([perf()])).toContain("JavaScript"); });
  it("renders diagnostics", () => { expect(renderPerformanceSection([perf()])).toContain("unusedJavascriptBytes"); });
  it("renders opportunities", () => { expect(renderPerformanceSection([perf()])).toContain("Reduce unused JS"); });
  it("escapes URLs and text", () => { expect(renderPerformanceSection([perf()])).not.toContain("<x>"); });
  it("renders autonomous SVG chart", () => { expect(renderPerformanceSection([perf({ runs: [{ metrics: {}, scores: { performance: 90 } }] })])).toContain("<svg"); });
  it("exposes performance styles", () => { expect(performanceStyles()).toContain(".perf-grid"); });
  it("renders empty section as blank", () => { expect(renderPerformanceSection([])).toBe(""); });
  it("labels TBT as not INP", () => { expect(renderPerformanceSection([perf()])).toContain("not INP"); });
});