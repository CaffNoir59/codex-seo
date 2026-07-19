import { issue, type SeoIssue } from "../core/issue.js";
import type { CrawlResult, CrawledPage } from "../crawler/crawl-result.js";

function incomingMap(pages: CrawledPage[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const page of pages) for (const link of page.links.internal) map.set(link, [...(map.get(link) ?? []), page.url]);
  return map;
}

export function analyzeInternalLinking(crawl: CrawlResult) {
  const issues: SeoIssue[] = [];
  const pages = crawl.pages.filter((page) => !page.error);
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const allKnownUrls = new Set(crawl.pages.map((page) => page.url));
  const incoming = incomingMap(pages);
  const brokenTargets = pages.flatMap((page) => page.links.internal.filter((link) => !byUrl.has(link) && !allKnownUrls.has(link) && crawl.skipped.every((skip) => skip.normalizedUrl !== link)).map((link) => ({ from: page.url, to: link })));
  const nonIndexableTargets = pages.flatMap((page) => page.links.internal.filter((link) => byUrl.get(link)?.robots?.indexable === false).map((link) => ({ from: page.url, to: link })));
  const redirectTargets = pages.flatMap((page) => page.links.internal.filter((link) => {
    const target = byUrl.get(link);
    return target && target.finalUrl !== target.url;
  }).map((link) => ({ from: page.url, to: link, finalUrl: byUrl.get(link)?.finalUrl })));
  const weakPages = pages.filter((page) => page.depth > 0 && (incoming.get(page.url)?.length ?? 0) <= 1);
  const canonicalInconsistencies = pages.filter((page) => page.canonical && page.canonical !== page.finalUrl && pages.some((source) => source.links.internal.includes(page.url)));
  const emptyAnchors = pages.flatMap((page) => (page.links.emptyAnchors ?? []).map((to) => ({ from: page.url, to })));
  const genericAnchors = pages.flatMap((page) => (page.links.genericAnchors ?? []).map((to) => ({ from: page.url, to })));

  if (emptyAnchors.length > 0) issues.push(issue({ id: "internal-linking.empty-anchor-text", category: "internal-linking", severity: "low", title: "Internal links have empty anchor text", description: "Links without accessible text are weaker for users and search engines.", evidence: { count: emptyAnchors.length, examples: emptyAnchors.slice(0, 10) }, recommendation: "Add descriptive visible or accessible anchor text." }));
  if (genericAnchors.length > 0) issues.push(issue({ id: "internal-linking.generic-anchor-text", category: "internal-linking", severity: "low", title: "Internal links use generic anchor text", description: "Generic anchors such as read more provide little topical context.", evidence: { count: genericAnchors.length, examples: genericAnchors.slice(0, 10) }, recommendation: "Use anchors that describe the destination topic." }));
  if (brokenTargets.length > 0) issues.push(issue({ id: "internal-linking.unseen-linked-targets", category: "internal-linking", severity: "medium", title: "Internal links point to uncrawled or skipped targets", description: "Some internal link targets were not successfully crawled within the configured budget.", evidence: { count: brokenTargets.length, examples: brokenTargets.slice(0, 10) }, recommendation: "Check these links for errors, filters, robots blocks, redirects, or crawl-budget issues." }));
  if (nonIndexableTargets.length > 0) issues.push(issue({ id: "internal-linking.links-to-nonindexable", category: "internal-linking", severity: "medium", title: "Internal links point to non-indexable pages", description: "Indexable pages should not prominently route equity to noindex destinations unless intentional.", evidence: { count: nonIndexableTargets.length, examples: nonIndexableTargets.slice(0, 10) }, recommendation: "Remove, nofollow, or de-emphasize links to pages that should not be indexed." }));
  if (redirectTargets.length > 0) issues.push(issue({ id: "internal-linking.links-to-redirects", category: "internal-linking", severity: "low", title: "Internal links point to redirects", description: "Internal links should usually point directly to final canonical URLs.", evidence: { count: redirectTargets.length, examples: redirectTargets.slice(0, 10) }, recommendation: "Update internal links to their final destinations." }));
  if (weakPages.length > 0) issues.push(issue({ id: "internal-linking.weak-incoming", category: "internal-linking", severity: "low", title: "Pages have weak incoming link support", description: "Some pages have one or fewer incoming links in the crawl graph.", evidence: { examples: weakPages.slice(0, 10).map((page) => ({ url: page.url, incoming: incoming.get(page.url)?.length ?? 0 })) }, recommendation: "Add contextual links from relevant pages and hub sections." }));
  if (canonicalInconsistencies.length > 0) issues.push(issue({ id: "internal-linking.canonical-link-inconsistency", category: "internal-linking", severity: "low", title: "Internal links point at URLs with different canonicals", description: "Internal links should generally point to canonical URLs directly.", evidence: { examples: canonicalInconsistencies.slice(0, 10).map((page) => ({ url: page.url, canonical: page.canonical })) }, recommendation: "Update internal links to point at canonical destinations." }));

  return { category: "internal-linking" as const, issues, summary: { pages: pages.length, weakPages: weakPages.length, brokenTargets: brokenTargets.length, redirectTargets: redirectTargets.length, emptyAnchors: emptyAnchors.length, genericAnchors: genericAnchors.length } };
}


