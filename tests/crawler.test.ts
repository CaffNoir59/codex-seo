import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite } from "../src/crawler/crawler.js";
import { normalizeUrl } from "../src/crawler/url-normalizer.js";
import { buildSitewideReport } from "../src/reporting/sitewide-report.js";

let server: http.Server;
let base = "";

function page(title: string, h1: string, body: string, links = "", extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="Description for ${title} with useful detail for testing."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="${base}/canonical-${encodeURIComponent(title)}">${extraHead}</head><body><h1>${h1}</h1><h2>Section</h2><p>${body}</p>${links}</body></html>`;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    if (url.pathname === "/robots.txt") {
      res.setHeader("content-type", "text/plain");
      res.end(`User-agent: CodexSEO\nDisallow: /blocked\nAllow: /blocked/allowed\nCrawl-delay: 0\nSitemap: ${base}/sitemap-index.xml\n`);
      return;
    }
    if (url.pathname === "/sitemap-index.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(`<sitemapindex><sitemap><loc>${base}/sitemap.xml</loc></sitemap><sitemap><loc>${base}/sitemap-index.xml</loc></sitemap></sitemapindex>`);
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/orphan</loc></url><url><loc>${base}/duplicate-a</loc></url><url><loc>https://outside.example/page</loc></url></urlset>`);
      return;
    }
    if (url.pathname === "/redirect") {
      res.statusCode = 301;
      res.setHeader("location", `${base}/deep/a`);
      res.end();
      return;
    }
    if (url.pathname === "/loop") {
      res.statusCode = 302;
      res.setHeader("location", `${base}/loop`);
      res.end();
      return;
    }
    if (url.pathname === "/missing") {
      res.statusCode = 404;
      res.end("missing");
      return;
    }
    res.setHeader("content-type", "text/html");
    if (url.pathname === "/") return res.end(page("Home", "Home", "The home page provides a clear answer for users and links to core sections.", `<a href="/deep/a?utm_source=x">Deep A</a><a href="/duplicate-a">Duplicate A</a><a href="/duplicate-b">Duplicate B</a><a href="/blocked">Blocked</a><a href="/missing">Missing</a><a href="/redirect">Redirect</a><a href="http://localhost/private">Bad localhost</a>`));
    if (url.pathname === "/deep/a") return res.end(page("Deep A", "Deep A", "A deeper page with enough text to be crawled and evaluated.", `<a href="/deep/b">Deep B</a>`));
    if (url.pathname === "/deep/b") return res.end(page("Deep B", "Deep B", "Another deeper page with useful content and internal navigation.", `<a href="/deep/c">Deep C</a>`));
    if (url.pathname === "/deep/c") return res.end(page("Deep C", "Deep C", "This page is intentionally deep for max depth testing."));
    if (url.pathname === "/duplicate-a") return res.end(page("Duplicate", "Duplicate H1", "The duplicate content body is almost the same template for testing duplicate detection."));
    if (url.pathname === "/duplicate-b") return res.end(page("Duplicate", "Duplicate H1", "The duplicate content body is almost the same template for testing duplicate detection."));
    if (url.pathname === "/orphan") return res.end(page("Orphan", "Orphan", "This page appears in the sitemap but is not linked from the home page."));
    if (url.pathname === "/external-canonical") return res.end(page("External Canonical", "External Canonical", "External canonical test.", "", `<link rel="canonical" href="https://external.example/canonical">`));
    if (url.pathname === "/blocked") return res.end(page("Blocked", "Blocked", "Robots should block this page."));
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("missing address");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("crawler", () => {
  it("normalizes URLs deterministically and removes tracking params", () => {
    expect(normalizeUrl("HTTP://Example.COM:80/a/?b=2&utm_source=x&a=1#frag")).toBe("http://example.com/a?a=1&b=2");
  });

  it("crawls multiple pages with stable ordering and robots blocking", async () => {
    const crawl = await crawlSite(base, { allowPrivateNetwork: true, render: "never", maxPages: 20, maxDepth: 4, concurrency: 3 });
    expect(crawl.pages.length).toBeGreaterThan(2);
    expect(crawl.pages.map((p) => p.url)).toEqual([...crawl.pages.map((p) => p.url)].sort((a, b) => new URL(a).pathname.localeCompare(new URL(b).pathname)).sort((a, b) => (crawl.pages.find((p) => p.url === a)?.depth ?? 0) - (crawl.pages.find((p) => p.url === b)?.depth ?? 0) || a.localeCompare(b)));
    expect(crawl.stats.blockedByRobots).toBeGreaterThanOrEqual(1);
    expect(crawl.sitemap.outsideDomain).toContain("https://outside.example/page");
  });

  it("respects max depth and page budget", async () => {
    const crawl = await crawlSite(base, { allowPrivateNetwork: true, render: "never", maxPages: 2, maxDepth: 1, concurrency: 4 });
    expect(crawl.pages.filter((page) => !page.error || page.error.code !== "robots-blocked").length).toBeLessThanOrEqual(2);
    expect(Math.max(...crawl.pages.map((page) => page.depth))).toBeLessThanOrEqual(1);
  });

  it("expands sitemap indexes and records outside-domain sitemap URLs", async () => {
    const crawl = await crawlSite(base, { allowPrivateNetwork: true, render: "never", maxPages: 10, maxDepth: 2 });
    expect(crawl.sitemap.discoveredSitemaps.some((url) => url.endsWith("/sitemap-index.xml"))).toBe(true);
    expect(crawl.sitemap.outsideDomain).toContain("https://outside.example/page");
  });

  it("builds a sitewide report with duplicate and indexability findings", async () => {
    const crawl = await crawlSite(base, { allowPrivateNetwork: true, render: "never", maxPages: 20, maxDepth: 4 });
    const report = buildSitewideReport(crawl);
    expect(report.summary.crawledPages).toBeGreaterThan(0);
    expect(report.issues.some((item) => item.id === "duplicate-content.duplicate-title")).toBe(true);
    expect(report.issues.some((item) => item.id === "indexability.indexable-missing-sitemap")).toBe(true);
  });
});