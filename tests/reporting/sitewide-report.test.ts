import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { buildSitewideReport, renderSitewideHtml, writeSitewideReport } from "../../src/reporting/sitewide-report.js";
import { sitewideAuditReportSchema } from "../../src/schemas/sitewide-report-schema.js";
import { issue, sortIssues } from "../../src/core/issue.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() { fixture = await startFixtureServer(); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("sitewide report", () => {
  it("validates the complete JSON report with Zod", async () => {
    const { baseUrl } = await start();
    const report = buildSitewideReport(await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 40, maxDepth: 3 }));
    expect(sitewideAuditReportSchema.parse(report).summary.crawledPages).toBe(report.summary.crawledPages);
  });

  it("keeps page counts, category scores, stats and configuration coherent", async () => {
    const { baseUrl } = await start();
    const report = buildSitewideReport(await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 40, maxDepth: 3, concurrency: 2, cache: false }));
    expect(report.summary.crawledPages).toBeGreaterThanOrEqual(15);
    expect(Object.keys(report.categoryScores).length).toBeGreaterThan(0);
    expect(report.crawlStats.discoveredUrls).toBeGreaterThanOrEqual(report.summary.crawledPages);
    expect(report.audit.configuration).toMatchObject({ maxPages: 40, maxDepth: 3, concurrency: 2, cache: false });
  });

  it("receives pages and issues in deterministic order from crawl and report", async () => {
    const { baseUrl } = await start();
    const report = buildSitewideReport(await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 40, maxDepth: 3 }));
    expect(report.pages.map((page) => page.url)).toEqual([...report.pages].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url)).map((page) => page.url));
    expect(report.issues.map((item) => item.id)).toEqual(sortIssues(report.issues).map((item) => item.id));
  });

  it("preserves crawl errors", async () => {
    const { baseUrl } = await start();
    const report = buildSitewideReport(await crawlSite(`${baseUrl}/redirect-loop`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false }));
    expect(report.pages[0].error?.message).toContain("Too many redirects");
  });

  it("generates standalone escaped HTML", async () => {
    const { baseUrl } = await start();
    const report = buildSitewideReport(await crawlSite(`${baseUrl}/xss`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false }));
    report.issues.push(issue({ id: "technical.xss", category: "technical", severity: "high", title: '<script>alert("xss")</script>', description: "<img src=x onerror=alert(1)>", recommendation: "Escape output" }));
    const html = renderSitewideHtml(report);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("writes JSON, HTML and PDF for a small local site", async () => {
    const { baseUrl } = await start();
    const report = buildSitewideReport(await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 5, maxDepth: 1 }));
    const dir = await mkdtemp(path.join(os.tmpdir(), "codex-seo-report-"));
    try {
      const files = await writeSitewideReport(report, dir, true);
      expect(files.map((file) => path.basename(file))).toEqual(["sitewide-report.json", "sitewide-report.html", "sitewide-report.pdf"]);
      expect((await stat(path.join(dir, "sitewide-report.pdf"))).size).toBeGreaterThan(1000);
      expect(await readFile(path.join(dir, "sitewide-report.html"), "utf8")).toContain("Codex SEO Sitewide Report");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

