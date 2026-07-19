import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBaselineFromReport } from "../../src/baseline/baseline-builder.js";
import { baselinePath, loadBaselineByName, loadBaselineFile, safeBaselineName, saveBaseline } from "../../src/baseline/baseline-storage.js";
import { seoBaselineSchema } from "../../src/baseline/baseline-schema.js";
import type { SitewideAuditReport } from "../../src/schemas/sitewide-report-schema.js";

function report(): SitewideAuditReport {
  return { audit: { startUrl: "https://example.com/", startedAt: "a", completedAt: "b", durationMs: 1, configuration: { maxPages: 5, maxDepth: 2, render: "never", includeSubdomains: false, respectRobots: true } }, summary: { score: 90, crawledPages: 2, discoveredUrls: 2, skippedUrls: 0, blockedByRobots: 0, failedPages: 0 }, categoryScores: { technical: 90, content: 100 }, crawlStats: { sitemapUrls: 1 }, sitemap: { discoveredSitemaps: [], urls: ["https://example.com/"], errors: [], outsideDomain: [] }, pages: [{ url: "https://example.com/", finalUrl: "https://example.com/", depth: 0, statusCode: 200, contentType: "text/html", fetchMode: "http", title: "Home", metaDescription: "Meta", h1: "Home", contentFingerprint: "abc", contentSignature: ["home"], robots: { indexable: true, followable: true }, links: { internal: ["https://example.com/a"], external: [] }, issues: [] }, { url: "https://example.com/a", finalUrl: "https://example.com/a", depth: 1, statusCode: 200, contentType: "text/html", fetchMode: "http", title: "A", metaDescription: "A meta", h1: "A", contentFingerprint: "def", contentSignature: ["alpha"], robots: { indexable: true, followable: true }, links: { internal: [], external: [] }, issues: [] }], issues: [{ id: "technical.title-length", category: "technical", severity: "high", title: "Bad", description: "Bad", recommendation: "Fix", affectedUrl: "https://example.com/a", evidence: { durationMs: 10, stable: true } }] };
}

describe("baseline builder and storage", () => {
  it("creates a versioned baseline", () => {
    const baseline = buildBaselineFromReport(report(), { name: "production", createdAt: "now" });
    expect(baseline.schemaVersion).toBe("1.0.0");
    expect(baseline.baseline.name).toBe("production");
  });
  it("loads a saved baseline", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "baseline-"));
    try { const file = await saveBaseline(buildBaselineFromReport(report(), { name: "prod" }), { baselineDir: dir }); expect((await loadBaselineByName(dir, "https://example.com/", "prod")).path).toBe(file); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("errors for a missing baseline", async () => { await expect(loadBaselineByName("missing-dir", "https://example.com/", "prod")).rejects.toThrow(/not found/i); });
  it("rejects invalid names", () => { expect(() => safeBaselineName("bad/name")).toThrow(/invalid/i); });
  it("rejects path traversal names", () => { expect(() => safeBaselineName("../prod")).toThrow(/invalid/i); });
  it("keeps baseline paths inside the baseline directory", () => { expect(baselinePath(".codex-seo/baselines", "https://Example.com/", "prod")).toContain("example.com"); });
  it("refuses silent overwrite", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "baseline-")); try { const b = buildBaselineFromReport(report(), { name: "prod" }); await saveBaseline(b, { baselineDir: dir }); await expect(saveBaseline(b, { baselineDir: dir })).rejects.toThrow(/already exists/i); } finally { await rm(dir, { recursive: true, force: true }); } });
  it("allows explicit overwrite", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "baseline-")); try { const b = buildBaselineFromReport(report(), { name: "prod" }); await saveBaseline(b, { baselineDir: dir }); await expect(saveBaseline(b, { baselineDir: dir, overwrite: true })).resolves.toContain("prod.json"); } finally { await rm(dir, { recursive: true, force: true }); } });
  it("rejects invalid schema files", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "baseline-")); try { const file = path.join(dir, "bad.json"); await writeFile(file, "{}", "utf8"); await expect(loadBaselineFile(file)).rejects.toThrow(); } finally { await rm(dir, { recursive: true, force: true }); } });
  it("supports privacy mode", () => { const baseline = buildBaselineFromReport(report(), { name: "private", privacyMode: true }); expect(baseline.snapshot.pages[0].title).toBeUndefined(); expect(baseline.snapshot.pages[0].titleHash).toHaveLength(64); });
  it("sorts pages and issues deterministically", () => { const baseline = buildBaselineFromReport(report(), { name: "prod" }); expect(baseline.snapshot.pages.map((p) => p.key)).toEqual([...baseline.snapshot.pages.map((p) => p.key)].sort()); expect(baseline.snapshot.issues.map((i) => i.key)).toEqual([...baseline.snapshot.issues.map((i) => i.key)].sort()); });
  it("validates the generated baseline with Zod", () => { expect(seoBaselineSchema.parse(buildBaselineFromReport(report(), { name: "prod" })).baseline.auditMode).toBe("sitewide"); });
});
