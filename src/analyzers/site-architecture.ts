import { issue, type SeoIssue } from "../core/issue.js";
import type { CrawlResult, CrawledPage } from "../crawler/crawl-result.js";

export type SitewideAnalyzerResult = {
  category: "site-architecture" | "internal-linking" | "indexability" | "duplicate-content";
  issues: SeoIssue[];
  summary: Record<string, unknown>;
};

function incomingCounts(pages: CrawledPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const link of page.links.internal) counts.set(link, (counts.get(link) ?? 0) + 1);
  }
  return counts;
}

export function analyzeSiteArchitecture(crawl: CrawlResult): SitewideAnalyzerResult {
  const issues: SeoIssue[] = [];
  const pages = crawl.pages.filter((page) => !page.error);
  const crawled = new Set(pages.map((page) => page.url));
  const incoming = incomingCounts(pages);
  const orphanSitemapUrls = crawl.sitemap.urls.filter((url) => !crawled.has(url));
  const deepPages = pages.filter((page) => page.depth >= Math.max(3, Number(crawl.configuration.maxDepth) - 1));
  const lowIncoming = pages.filter((page) => page.depth > 0 && (incoming.get(page.url) ?? 0) < 1);
  const tooManyOutgoing = pages.filter((page) => page.links.internal.length > 150);
  const redirectedPages = crawl.pages.filter((page) => !page.error && page.finalUrl !== page.url);
  const redirectLoops = crawl.pages.filter((page) => /too many redirects|redirect/i.test(page.error?.message ?? "") && /too many redirects/i.test(page.error?.message ?? ""));

  if (orphanSitemapUrls.length > 0) issues.push(issue({
    id: "site-architecture.orphan-sitemap-pages",
    category: "site-architecture",
    severity: "medium",
    title: "Sitemap URLs were not reached by crawl paths",
    description: "Some URLs found in sitemaps were not reached through internal links within the crawl budget.",
    evidence: { count: orphanSitemapUrls.length, examples: orphanSitemapUrls.slice(0, 10) },
    recommendation: "Add internal links from relevant hubs to important sitemap-only pages."
  }));
  if (deepPages.length > 0) issues.push(issue({
    id: "site-architecture.deep-pages",
    category: "site-architecture",
    severity: "low",
    title: "Important pages may be too deep",
    description: "Pages near the crawl depth limit are harder for users and crawlers to reach.",
    evidence: { count: deepPages.length, examples: deepPages.slice(0, 10).map((page) => ({ url: page.url, depth: page.depth })) },
    recommendation: "Expose important pages closer to the homepage through hubs, navigation, or contextual links."
  }));
  if (lowIncoming.length > 0) issues.push(issue({
    id: "site-architecture.low-incoming-links",
    category: "site-architecture",
    severity: "medium",
    title: "Pages have too few internal incoming links",
    description: "Some crawled pages have no incoming internal links counted in the crawl graph.",
    evidence: { count: lowIncoming.length, examples: lowIncoming.slice(0, 10).map((page) => page.url) },
    recommendation: "Strengthen internal linking to pages that should be discoverable and rankable."
  }));
  if (redirectedPages.length > 0) issues.push(issue({
    id: "site-architecture.redirected-pages",
    category: "site-architecture",
    severity: "low",
    title: "Crawl paths include redirected pages",
    description: "Some URLs in the crawl graph redirect before reaching final content.",
    evidence: { examples: redirectedPages.slice(0, 10).map((page) => ({ url: page.url, finalUrl: page.finalUrl })) },
    recommendation: "Link directly to final canonical destinations where possible."
  }));
  if (redirectLoops.length > 0) issues.push(issue({
    id: "site-architecture.redirect-loops",
    category: "site-architecture",
    severity: "high",
    title: "Redirect loops detected",
    description: "Some crawl paths could not resolve because redirects exceeded the configured limit.",
    evidence: { examples: redirectLoops.slice(0, 10).map((page) => ({ url: page.url, error: page.error?.message })) },
    recommendation: "Fix redirect loops and validate redirect chains after deployment."
  }));
  if (tooManyOutgoing.length > 0) issues.push(issue({
    id: "site-architecture.too-many-outgoing-internal-links",
    category: "site-architecture",
    severity: "low",
    title: "Pages contain many internal links",
    description: "Very large internal link sets can dilute navigational clarity.",
    evidence: { examples: tooManyOutgoing.slice(0, 10).map((page) => ({ url: page.url, outgoing: page.links.internal.length })) },
    recommendation: "Group links into meaningful navigation sections and avoid dumping every URL onto one page."
  }));

  return { category: "site-architecture", issues, summary: { pages: pages.length, orphanSitemapUrls: orphanSitemapUrls.length, deepPages: deepPages.length, redirectedPages: redirectedPages.length, redirectLoops: redirectLoops.length } };
}
