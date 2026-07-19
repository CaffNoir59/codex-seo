import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CrawlResult } from "../../src/crawler/crawl-result.js";
import { analyzePerformanceResults } from "../../src/analyzers/performance.js";
import { buildSitewideReport, writeSitewideReport } from "../../src/reporting/sitewide-report.js";
import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceResult } from "../../src/performance/performance-schema.js";

function perf(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url: "https://example.com/", source: "local", scope: "url", device: "mobile", collectedAt: "2026-07-17T00:00:00.000Z", scores: { performance: 92 }, metrics: { lcpMs: 1600, cls: 0.02, tbtMs: 40, ttfbMs: 200 }, resources: { transferBytes: 200000, javascriptBytes: 30000, imageBytes: 50000, requestCount: 12 }, warnings: [], confidence: "medium", ...overrides });
}

function crawl(): CrawlResult {
  return { startUrl: "https://example.com/", normalizedStartUrl: "https://example.com/", startedAt: "2026-07-17T00:00:00.000Z", completedAt: "2026-07-17T00:00:01.000Z", durationMs: 1000, configuration: { maxPages: 1, maxDepth: 0, render: "never", includeSubdomains: false, respectRobots: true }, pages: [{ url: "https://example.com/", finalUrl: "https://example.com/", depth: 0, statusCode: 200, contentType: "text/html", fetchMode: "http", title: "Home", metaDescription: "Meta", h1: "Home", robots: { indexable: true, followable: true }, links: { internal: [], external: [] }, issues: [] }], skipped: [], stats: { discoveredUrls: 1, skippedUrls: 0, blockedByRobots: 0, failedPages: 0, sitemapUrls: 0, robotsErrors: [], exclusions: {}, statusCodes: { "200": 1 }, depthDistribution: { "0": 1 } }, sitemap: { discoveredSitemaps: [], urls: [], errors: [], outsideDomain: [] } };
}

describe("performance reporting", () => {
  it("adds performance results to sitewide reports", () => {
    const report = buildSitewideReport(crawl(), [perf()]);
    expect(report.performance).toHaveLength(1);
  });

  it("adds performance category score", () => {
    const report = buildSitewideReport(crawl(), [perf({ scores: { performance: 80 } })]);
    expect(report.categoryScores.performance).toBe(80);
  });

  it("keeps performance category score averaged across sources", () => {
    const report = buildSitewideReport(crawl(), [perf({ scores: { performance: 80 } }), perf({ source: "pagespeed", scores: { performance: 60 } })]);
    expect(report.categoryScores.performance).toBe(70);
  });

  it("creates low-score performance issues", () => {
    const issues = analyzePerformanceResults([perf({ scores: { performance: 40 } })]);
    expect(issues.some((issue) => issue.id.includes("low-score"))).toBe(true);
  });

  it("creates slow LCP issues", () => {
    const issues = analyzePerformanceResults([perf({ metrics: { lcpMs: 5000, cls: 0.02, tbtMs: 40, ttfbMs: 200 } })]);
    expect(issues.some((issue) => issue.id.includes("slow-lcp"))).toBe(true);
  });

  it("creates high CLS issues", () => {
    const issues = analyzePerformanceResults([perf({ metrics: { lcpMs: 1600, cls: 0.3, tbtMs: 40, ttfbMs: 200 } })]);
    expect(issues.some((issue) => issue.id.includes("high-cls"))).toBe(true);
  });

  it("creates high TBT issues", () => {
    const issues = analyzePerformanceResults([perf({ metrics: { lcpMs: 1600, cls: 0.02, tbtMs: 900, ttfbMs: 200 } })]);
    expect(issues.some((issue) => issue.id.includes("high-tbt"))).toBe(true);
  });

  it("creates slow TTFB issues", () => {
    const issues = analyzePerformanceResults([perf({ metrics: { lcpMs: 1600, cls: 0.02, tbtMs: 40, ttfbMs: 2000 } })]);
    expect(issues.some((issue) => issue.id.includes("slow-ttfb"))).toBe(true);
  });

  it("creates resource budget issues", () => {
    const issues = analyzePerformanceResults([perf({ resources: { transferBytes: 4_000_000, javascriptBytes: 1_200_000, imageBytes: 2_500_000, requestCount: 120 } })]);
    expect(issues.some((issue) => issue.id.includes("excessive-page-weight"))).toBe(true);
    expect(issues.some((issue) => issue.id.includes("excessive-javascript"))).toBe(true);
    expect(issues.some((issue) => issue.id.includes("high-request-count"))).toBe(true);
  });

  it("creates adapter unavailable issues", () => {
    const issues = analyzePerformanceResults([perf({ metrics: {}, error: { code: "pagespeed-error", message: "failed", retryable: true } })]);
    expect(issues.some((issue) => issue.id.includes("adapter-unavailable"))).toBe(true);
  });

  it("creates variance warning issues", () => {
    const issues = analyzePerformanceResults([perf({ warnings: ["high-variance-lcpMs"] })]);
    expect(issues.some((issue) => issue.id.includes("high-variance"))).toBe(true);
  });

  it("writes performance data to JSON reports", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "perf-report-"));
    try {
      const files = await writeSitewideReport(buildSitewideReport(crawl(), [perf()]), dir, false);
      const json = JSON.parse(await readFile(files[0], "utf8"));
      expect(json.performance).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("writes performance data to HTML reports", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "perf-report-"));
    try {
      const files = await writeSitewideReport(buildSitewideReport(crawl(), [perf()]), dir, false);
      const html = await readFile(files[1], "utf8");
      expect(html).toContain("Performance");
      expect(html).toContain("LCP");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});