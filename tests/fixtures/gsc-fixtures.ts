import type { CrawledPage, CrawlResult } from "../../src/crawler/crawl-result.js";

function page(path: string, overrides: Partial<CrawledPage> = {}): CrawledPage {
  const url = `https://example.test${path}`;
  return {
    url,
    finalUrl: url,
    depth: path === "/deep" ? 5 : 1,
    statusCode: path === "/error" ? 500 : 200,
    fetchMode: "http",
    title: path,
    metaDescription: `Meta ${path}`,
    h1: path,
    canonical: path === "/canonical" ? "https://example.test/preferred" : url,
    robots: { indexable: path !== "/noindex", followable: true },
    links: { internal: [], external: [] },
    issues: [],
    ...overrides
  };
}

export function gscFixtureCrawl(): CrawlResult {
  const pages = [page("/"), page("/low-ctr"), page("/slow"), page("/noindex"), page("/deep"), page("/canonical"), page("/cannibal-a"), page("/cannibal-b")];
  return {
    startUrl: "https://example.test/",
    normalizedStartUrl: "https://example.test/",
    startedAt: "2026-06-29T00:00:00Z",
    completedAt: "2026-06-29T00:00:01Z",
    durationMs: 1000,
    configuration: { maxPages: 20, maxDepth: 5, render: "never" },
    pages,
    skipped: [],
    stats: { discoveredUrls: pages.length, skippedUrls: 0, blockedByRobots: 0, failedPages: 0, sitemapUrls: 0, robotsErrors: [], exclusions: {}, statusCodes: { "200": pages.length }, depthDistribution: { "1": 7, "5": 1 } },
    sitemap: { discoveredSitemaps: [], urls: [], errors: [], outsideDomain: [] }
  };
}