import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCompatibility } from "../../src/diff/compatibility.js";
import { compareBaselines } from "../../src/diff/compare-reports.js";
import { seoDiffReportSchema } from "../../src/diff/diff-schema.js";
import { defaultGateOptions, evaluateQualityGate, mergeGateOptions } from "../../src/diff/quality-gate.js";
import { renderDiffHtml } from "../../src/reporting/diff-html-report.js";
import { writeDiffReport } from "../../src/reporting/diff-json-report.js";
import type { SeoBaseline } from "../../src/baseline/baseline-schema.js";

function base(extra: Partial<SeoBaseline> = {}): SeoBaseline {
  return { schemaVersion: "1.0.0", baseline: { name: "b", createdAt: "now", startUrl: "https://example.com/", normalizedOrigin: "https://example.com", auditMode: "sitewide", toolVersion: "0.1.0" }, configuration: { maxPages: 10, maxDepth: 2, renderMode: "never", includeSubdomains: false, respectRobots: true }, snapshot: { globalScore: 90, categoryScores: { technical: 90, content: 90 }, pages: [{ key: "https://example.com/", url: "https://example.com/", statusCode: 200, indexable: true, canonical: "https://example.com/", titleHash: "t", metaDescriptionHash: "m", h1Hash: "h", contentHash: "c", contentSignature: [], contentLength: 10, wordCount: 2, incomingInternalLinks: 0, outgoingInternalLinks: 1, pageScore: 100, fromSitemap: true }], issues: [], metrics: { crawledPages: 1, skippedUrls: 0, failedPages: 0, blockedByRobots: 0 } }, ...extra } as SeoBaseline;
}
const gate = defaultGateOptions;

describe("compatibility", () => {
  it("accepts matching configurations", () => { expect(checkCompatibility(base(), base()).warnings).toHaveLength(0); });
  it("warns on different budgets", () => { expect(checkCompatibility(base(), base({ configuration: { ...base().configuration, maxPages: 500 } })).warnings.some((w) => w.includes("maxPages"))).toBe(true); });
  it("warns on different depths", () => { expect(checkCompatibility(base(), base({ configuration: { ...base().configuration, maxDepth: 5 } })).warnings.some((w) => w.includes("maxDepth"))).toBe(true); });
  it("warns on render mode difference", () => { expect(checkCompatibility(base(), base({ configuration: { ...base().configuration, renderMode: "always" } })).warnings.some((w) => w.includes("renderMode"))).toBe(true); });
  it("warns on respect robots difference", () => { expect(checkCompatibility(base(), base({ configuration: { ...base().configuration, respectRobots: false } })).warnings.some((w) => w.includes("respectRobots"))).toBe(true); });
  it("marks different domains incompatible", () => { expect(checkCompatibility(base(), base({ baseline: { ...base().baseline, startUrl: "https://other.example.test/" } })).compatible).toBe(false); });
  it("marks schema differences incompatible", () => { expect(checkCompatibility(base(), { ...base(), schemaVersion: "2.0.0" } as unknown as SeoBaseline).compatible).toBe(false); });
  it("throws in strict compatibility mode", () => { expect(() => compareBaselines(base(), base({ configuration: { ...base().configuration, maxPages: 99 } }), { gate, strictCompatibility: true })).toThrow(/strict mode/i); });
  it("detects incomplete crawls via budget", () => { const current = base({ snapshot: { ...base().snapshot, metrics: { crawledPages: 10, skippedUrls: 5, failedPages: 0, blockedByRobots: 0 } } }); expect(checkCompatibility(base(), current).incomplete).toBe(true); });
});

describe("quality gate", () => {
  it("passes with no changes", () => { const report = compareBaselines(base(), base(), { gate }); expect(report.gate.passed).toBe(true); });
  it("passes with improvements only", () => { const report = compareBaselines(base({ snapshot: { ...base().snapshot, globalScore: 80 } }), base(), { gate }); expect(report.gate.passed).toBe(true); });
  it("allows tolerated score drops", () => { const report = compareBaselines(base(), base({ snapshot: { ...base().snapshot, globalScore: 88 } }), { gate: { ...gate, maxScoreDrop: 3 } }); expect(report.gate.passed).toBe(true); });
  it("fails excessive score drops", () => { const report = compareBaselines(base(), base({ snapshot: { ...base().snapshot, globalScore: 80 } }), { gate: { ...gate, maxScoreDrop: 3 } }); expect(report.gate.passed).toBe(false); });
  it("fails on new high issue", () => { const current = base({ snapshot: { ...base().snapshot, issues: [{ key: "i", ruleId: "technical.x", category: "technical", severity: "high", affectedUrl: "https://example.com/", titleHash: "t", evidenceHash: "e", recommendationHash: "r" }] } }); expect(compareBaselines(base(), current, { gate: { ...gate, maxNewHigh: 0 } }).gate.passed).toBe(false); });
  it("fails on new critical issue", () => { const current = base({ snapshot: { ...base().snapshot, issues: [{ key: "i", ruleId: "technical.x", category: "technical", severity: "critical", affectedUrl: "https://example.com/", titleHash: "t", evidenceHash: "e", recommendationHash: "r" }] } }); expect(compareBaselines(base(), current, { gate: { ...gate, maxNewCritical: 0 } }).gate.passed).toBe(false); });
  it("honors ignored rules in the gate", () => { const current = base({ snapshot: { ...base().snapshot, issues: [{ key: "i", ruleId: "technical.x", category: "technical", severity: "critical", affectedUrl: "https://example.com/", titleHash: "t", evidenceHash: "e", recommendationHash: "r" }] } }); expect(compareBaselines(base(), current, { gate: { ...gate, maxNewCritical: 0, ignoredRules: ["technical.x"] }, ignore: { ignoredRules: ["technical.x"] } }).gate.passed).toBe(true); });
  it("merges CLI options over config", () => { expect(mergeGateOptions({ maxScoreDrop: 3 }, { maxScoreDrop: 1 }).maxScoreDrop).toBe(1); });
});

describe("diff determinism and reporting", () => {
  it("generates the same diff for different input order except timestamp", () => { const prev = base({ snapshot: { ...base().snapshot, pages: [...base().snapshot.pages].reverse() } }); const a = compareBaselines(prev, base(), { gate, generatedAt: "same" }); const b = compareBaselines(base(), base(), { gate, generatedAt: "same" }); expect(a).toEqual(b); });
  it("validates diff JSON schema", () => { expect(seoDiffReportSchema.parse(compareBaselines(base(), base(), { gate })).schemaVersion).toBe("1.0.0"); });
  it("renders standalone escaped HTML", () => { const current = base({ snapshot: { ...base().snapshot, issues: [{ key: "i", ruleId: "technical.x", category: "technical", severity: "critical", affectedUrl: "https://example.com/<x>", title: "<script>x</script>", titleHash: "t", evidenceHash: "e", recommendationHash: "r" }] } }); const html = renderDiffHtml(compareBaselines(base(), current, { gate })); expect(html).toContain("<!doctype html>"); expect(html).not.toContain("<script>x</script>"); });
  it("writes JSON, HTML and PDF", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "diff-report-")); try { const files = await writeDiffReport(compareBaselines(base(), base(), { gate }), dir, { html: true, pdf: true }); expect(files.map((f) => path.basename(f))).toEqual(["diff-report.json", "diff-report.html", "diff-report.pdf"]); expect((await stat(path.join(dir, "diff-report.pdf"))).size).toBeGreaterThan(1000); } finally { await rm(dir, { recursive: true, force: true }); } });
  it("shows warnings and ignored changes", () => { const current = base({ configuration: { ...base().configuration, maxPages: 99 } }); const report = compareBaselines(base(), current, { gate }); expect(report.comparison.compatibilityWarnings.length).toBeGreaterThan(0); expect(renderDiffHtml(report)).toContain("Compatibility Warnings"); });
  it("evaluates a gate directly", () => { expect(evaluateQualityGate({ summary: { scoreDelta: -4 } as never, issues: { introduced: [] } as never, regressions: [] }, { ...gate, maxScoreDrop: 3 }).passed).toBe(false); });
});

