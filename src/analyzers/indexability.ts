import { issue, type SeoIssue } from "../core/issue.js";
import type { CrawlResult } from "../crawler/crawl-result.js";

export function analyzeIndexability(crawl: CrawlResult) {
  const issues: SeoIssue[] = [];
  const pages = crawl.pages.filter((page) => !page.error);
  const sitemapSet = new Set(crawl.sitemap.urls);
  const httpErrors = pages.filter((page) => (page.statusCode ?? 0) >= 400);
  const nonIndexable = pages.filter((page) => page.robots?.indexable === false);
  const nofollowPages = pages.filter((page) => page.robots?.followable === false);
  const sitemapReliable = !crawl.sitemap.reliability || crawl.sitemap.reliability === "reliable";
  const indexableMissingSitemap = sitemapReliable ? pages.filter((page) => page.robots?.indexable !== false && page.statusCode && page.statusCode < 400 && !sitemapSet.has(page.url)) : [];
  const nonIndexableInSitemap = pages.filter((page) => page.robots?.indexable === false && sitemapSet.has(page.url));
  const externalCanonical = pages.filter((page) => page.canonical && new URL(page.canonical, page.finalUrl).hostname !== new URL(crawl.startUrl).hostname);
  const canonicalTargets = new Map(pages.map((page) => [page.url, page.statusCode]));
  const badCanonicalTargets = pages.filter((page) => page.canonical && canonicalTargets.has(page.canonical) && (canonicalTargets.get(page.canonical) ?? 500) >= 400);
  const redirectCanonicalTargets = pages.filter((page) => page.canonical && canonicalTargets.has(page.canonical) && (canonicalTargets.get(page.canonical) ?? 0) >= 300 && (canonicalTargets.get(page.canonical) ?? 0) < 400);
  const canonicalByUrl = new Map(pages.map((page) => [page.url, page.canonical ?? undefined]));
  const canonicalChains = pages.filter((page) => page.canonical && canonicalByUrl.get(page.canonical));
  const canonicalNoindexConflicts = pages.filter((page) => page.canonical && page.robots?.indexable === false);

  if (httpErrors.length > 0) issues.push(issue({ id: "indexability.http-errors", category: "indexability", severity: "high", title: "Crawled pages returned HTTP errors", description: "HTTP error pages cannot reliably rank or pass link equity.", evidence: { examples: httpErrors.slice(0, 10).map((page) => ({ url: page.url, statusCode: page.statusCode })) }, recommendation: "Fix erroring URLs or redirect them to relevant live pages." }));
  if (nonIndexable.length > 0) issues.push(issue({ id: "indexability.noindex-pages", category: "indexability", severity: "info", title: "Non-indexable pages detected", description: "Some crawled pages declare noindex. This may be intentional.", evidence: { count: nonIndexable.length, examples: nonIndexable.slice(0, 10).map((page) => page.url) }, recommendation: "Confirm noindex directives are intentional for these pages." }));
  if (nofollowPages.length > 0) issues.push(issue({ id: "indexability.nofollow-pages", category: "indexability", severity: "info", title: "Nofollow pages detected", description: "Some pages declare nofollow. This may be intentional but can interrupt discovery signals.", evidence: { count: nofollowPages.length, examples: nofollowPages.slice(0, 10).map((page) => page.url) }, recommendation: "Confirm nofollow directives are intentional." }));
  if (indexableMissingSitemap.length > 0) issues.push(issue({ id: "indexability.indexable-missing-sitemap", category: "indexability", severity: "medium", title: "Indexable pages are absent from sitemap", description: "Some indexable crawled pages were not found in discovered sitemaps.", evidence: { count: indexableMissingSitemap.length, examples: indexableMissingSitemap.slice(0, 10).map((page) => page.url) }, recommendation: "Add canonical indexable pages to XML sitemaps." }));
  if (nonIndexableInSitemap.length > 0) issues.push(issue({ id: "indexability.noindex-in-sitemap", category: "indexability", severity: "medium", title: "Non-indexable pages are present in sitemap", description: "Sitemaps should list canonical indexable URLs.", evidence: { examples: nonIndexableInSitemap.slice(0, 10).map((page) => page.url) }, recommendation: "Remove noindex URLs from XML sitemaps." }));
  if (externalCanonical.length > 0) issues.push(issue({ id: "indexability.external-canonical", category: "indexability", severity: "high", title: "External canonical URLs detected", description: "Canonical tags point outside the audited domain.", evidence: { examples: externalCanonical.slice(0, 10).map((page) => ({ url: page.url, canonical: page.canonical })) }, recommendation: "Use external canonicals only when intentionally consolidating to another domain." }));
  if (badCanonicalTargets.length > 0) issues.push(issue({ id: "indexability.canonical-target-error", category: "indexability", severity: "high", title: "Canonical targets return errors", description: "Some canonicals point to crawled URLs that returned errors.", evidence: { examples: badCanonicalTargets.slice(0, 10).map((page) => ({ url: page.url, canonical: page.canonical })) }, recommendation: "Point canonicals at live 200-status URLs." }));
  if (redirectCanonicalTargets.length > 0) issues.push(issue({ id: "indexability.canonical-target-redirect", category: "indexability", severity: "medium", title: "Canonical targets redirect", description: "Some canonicals point to URLs that redirect instead of final destinations.", evidence: { examples: redirectCanonicalTargets.slice(0, 10).map((page) => ({ url: page.url, canonical: page.canonical })) }, recommendation: "Point canonicals directly at final 200-status URLs." }));
  if (canonicalChains.length > 0) issues.push(issue({ id: "indexability.canonical-chain", category: "indexability", severity: "medium", title: "Canonical chains detected", description: "Some canonical targets declare another canonical, creating a chain.", evidence: { examples: canonicalChains.slice(0, 10).map((page) => ({ url: page.url, canonical: page.canonical, nextCanonical: page.canonical ? canonicalByUrl.get(page.canonical) : undefined })) }, recommendation: "Use a single direct canonical target." }));
  if (canonicalNoindexConflicts.length > 0) issues.push(issue({ id: "indexability.canonical-noindex-conflict", category: "indexability", severity: "medium", title: "Canonical and noindex directives conflict", description: "A noindex page also declares a canonical. Search engines may ignore consolidation signals on noindex URLs.", evidence: { examples: canonicalNoindexConflicts.slice(0, 10).map((page) => ({ url: page.url, canonical: page.canonical })) }, recommendation: "Avoid combining noindex and canonical unless this behavior is intentional and tested." }));

  return { category: "indexability" as const, issues, summary: { httpErrors: httpErrors.length, nonIndexable: nonIndexable.length, nofollowPages: nofollowPages.length, indexableMissingSitemap: indexableMissingSitemap.length, redirectCanonicalTargets: redirectCanonicalTargets.length, canonicalChains: canonicalChains.length } };
}

