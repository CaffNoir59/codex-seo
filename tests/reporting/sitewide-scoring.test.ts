import { describe, expect, it } from "vitest";
import { buildSitewideReport } from "../../src/reporting/sitewide-report.js";
import { issue } from "../../src/core/issue.js";
import type { CrawlResult, CrawledPage } from "../../src/crawler/crawl-result.js";

function page(url: string, issues: CrawledPage["issues"] = []): CrawledPage {
  return { url, finalUrl: url, depth: 0, statusCode: 200, contentType: "text/html", fetchMode: "http", title: url, h1: url, contentFingerprint: url, contentSignature: [url], robots: { indexable: true, followable: true }, links: { internal: [], external: [] }, issues };
}
function crawl(pages: CrawledPage[]): CrawlResult {
  return { startUrl: "https://example.com/", normalizedStartUrl: "https://example.com/", startedAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(), durationMs: 1, configuration: { maxDepth: 4 }, pages, skipped: [], stats: { discoveredUrls: pages.length, skippedUrls: 0, blockedByRobots: 0, failedPages: 0, sitemapUrls: 0, robotsErrors: [], exclusions: {}, statusCodes: {}, depthDistribution: {} }, sitemap: { discoveredSitemaps: [], urls: pages.map((p) => p.url), errors: [], outsideDomain: [] } };
}
const critical = issue({ id: "technical.critical", category: "technical", severity: "critical", title: "Critical", description: "Critical", recommendation: "Fix" });
const medium = issue({ id: "content.medium", category: "content", severity: "medium", title: "Medium", description: "Medium", recommendation: "Fix" });

describe("sitewide scoring", () => {
  it("is stable regardless of page order", () => {
    const a = buildSitewideReport(crawl([page("https://example.com/a", [medium]), page("https://example.com/b", [critical])])).summary.score;
    const b = buildSitewideReport(crawl([page("https://example.com/b", [critical]), page("https://example.com/a", [medium])])).summary.score;
    expect(a).toBe(b);
  });

  it("is stable regardless of issue order", () => {
    const a = buildSitewideReport(crawl([page("https://example.com/a", [medium, critical])])).summary.score;
    const b = buildSitewideReport(crawl([page("https://example.com/a", [critical, medium])])).summary.score;
    expect(a).toBe(b);
  });

  it("is bounded between 0 and 100 and never NaN", () => {
    const score = buildSitewideReport(crawl([page("https://example.com/a", Array.from({ length: 200 }, (_, i) => ({ ...critical, id: `technical.critical-${i}` })))] )).summary.score;
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("does not produce an artificially positive score without data", () => {
    expect(buildSitewideReport(crawl([])).summary.score).toBe(0);
  });

  it("caps massive repetition of the same issue", () => {
    const repeated = buildSitewideReport(crawl([page("https://example.com/a", Array.from({ length: 100 }, (_, i) => ({ ...medium, id: `content.medium-${i}` })))] )).summary.score;
    expect(repeated).toBeGreaterThanOrEqual(55);
  });

  it("counts a critical issue on one important page", () => {
    const report = buildSitewideReport(crawl([page("https://example.com/", [critical]), page("https://example.com/a"), page("https://example.com/b")]));
    expect(report.summary.score).toBeLessThan(100);
  });

  it("accounts for the proportion of the site affected through repeated page issues", () => {
    const oneAffected = buildSitewideReport(crawl([page("https://example.com/a", [medium]), page("https://example.com/b"), page("https://example.com/c")])).summary.score;
    const threeAffected = buildSitewideReport(crawl([page("https://example.com/a", [medium]), page("https://example.com/b", [medium]), page("https://example.com/c", [medium])])).summary.score;
    expect(threeAffected).toBeLessThan(oneAffected);
  });
});
