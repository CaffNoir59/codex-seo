import { describe, expect, it } from "vitest";
import { analyzeDuplicateContent, DEFAULT_NEAR_DUPLICATE_THRESHOLD } from "../../src/analyzers/duplicate-content.js";
import { analyzeIndexability } from "../../src/analyzers/indexability.js";
import { analyzeInternalLinking } from "../../src/analyzers/internal-linking.js";
import { analyzeSiteArchitecture } from "../../src/analyzers/site-architecture.js";
import type { CrawlResult, CrawledPage } from "../../src/crawler/crawl-result.js";

function page(path: string, overrides: Partial<CrawledPage> = {}): CrawledPage {
  const url = `https://example.com${path}`;
  return {
    url,
    finalUrl: overrides.finalUrl ?? url,
    depth: overrides.depth ?? 1,
    statusCode: overrides.statusCode ?? 200,
    contentType: "text/html",
    fetchMode: "http",
    title: overrides.title ?? path,
    metaDescription: overrides.metaDescription ?? `Meta ${path}`,
    h1: overrides.h1 ?? path,
    contentFingerprint: overrides.contentFingerprint ?? `fp-${path}`,
    contentSignature: overrides.contentSignature ?? [path.replace(/\W/g, ""), "alpha", "beta"],
    canonical: overrides.canonical,
    robots: overrides.robots ?? { indexable: true, followable: true },
    links: overrides.links ?? { internal: [], external: [] },
    issues: overrides.issues ?? [],
    error: overrides.error,
    discoveredFrom: overrides.discoveredFrom
  };
}

function crawl(pages: CrawledPage[], extra: Partial<CrawlResult> = {}): CrawlResult {
  return {
    startUrl: "https://example.com/",
    normalizedStartUrl: "https://example.com/",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    durationMs: 10,
    configuration: { maxDepth: 4, duplicateSimilarityThreshold: DEFAULT_NEAR_DUPLICATE_THRESHOLD, ...(extra.configuration ?? {}) },
    pages,
    skipped: extra.skipped ?? [],
    stats: { discoveredUrls: pages.length, skippedUrls: 0, blockedByRobots: 0, failedPages: 0, sitemapUrls: 0, robotsErrors: [], exclusions: {}, statusCodes: {}, depthDistribution: {}, ...(extra.stats ?? {}) },
    sitemap: extra.sitemap ?? { discoveredSitemaps: [], urls: [], errors: [], outsideDomain: [] }
  };
}

const ids = (result: { issues: Array<{ id: string }> }) => result.issues.map((issue) => issue.id);

describe("site architecture analyzer", () => {
  it("reports depth distribution problems, orphan sitemap URLs and low incoming pages", () => {
    const c = crawl([page("/", { depth: 0 }), page("/deep", { depth: 4 })], { sitemap: { discoveredSitemaps: [], urls: ["https://example.com/orphan"], errors: [], outsideDomain: [] } });
    expect(ids(analyzeSiteArchitecture(c))).toEqual(expect.arrayContaining(["site-architecture.orphan-sitemap-pages", "site-architecture.deep-pages", "site-architecture.low-incoming-links"]));
  });

  it("reports too many outgoing internal links", () => {
    const links = Array.from({ length: 151 }, (_, i) => `https://example.com/p-${i}`);
    expect(ids(analyzeSiteArchitecture(crawl([page("/", { depth: 0, links: { internal: links, external: [] } })])))).toContain("site-architecture.too-many-outgoing-internal-links");
  });

  it("reports redirected pages and redirect loops", () => {
    const result = analyzeSiteArchitecture(crawl([page("/redirect", { finalUrl: "https://example.com/final" }), page("/loop", { error: { code: "fetch-error", message: "Too many redirects; limit is 5" } })]));
    expect(ids(result)).toEqual(expect.arrayContaining(["site-architecture.redirected-pages", "site-architecture.redirect-loops"]));
  });
});

describe("internal linking analyzer", () => {
  it("reports incoming/outgoing weak pages and broken links", () => {
    const home = page("/", { depth: 0, links: { internal: ["https://example.com/a", "https://example.com/missing"], external: [] } });
    const a = page("/a", { depth: 1 });
    expect(ids(analyzeInternalLinking(crawl([home, a])))).toEqual(expect.arrayContaining(["internal-linking.unseen-linked-targets", "internal-linking.weak-incoming"]));
  });

  it("reports empty and generic anchors", () => {
    const home = page("/", { depth: 0, links: { internal: ["https://example.com/a"], external: [], emptyAnchors: ["https://example.com/a"], genericAnchors: ["https://example.com/a"] } });
    const a = page("/a", { depth: 1 });
    expect(ids(analyzeInternalLinking(crawl([home, a])))).toEqual(expect.arrayContaining(["internal-linking.empty-anchor-text", "internal-linking.generic-anchor-text"]));
  });

  it("reports links to redirects, non-indexable pages and non-canonical URLs", () => {
    const home = page("/", { depth: 0, links: { internal: ["https://example.com/r", "https://example.com/no", "https://example.com/noncanonical"], external: [] } });
    const redirected = page("/r", { finalUrl: "https://example.com/final" });
    const no = page("/no", { robots: { indexable: false, followable: true } });
    const noncanonical = page("/noncanonical", { canonical: "https://example.com/canonical" });
    expect(ids(analyzeInternalLinking(crawl([home, redirected, no, noncanonical])))).toEqual(expect.arrayContaining(["internal-linking.links-to-redirects", "internal-linking.links-to-nonindexable", "internal-linking.canonical-link-inconsistency"]));
  });
});

describe("indexability analyzer", () => {
  it("detects 404, 500, noindex and nofollow pages", () => {
    const result = analyzeIndexability(crawl([page("/ok"), page("/404", { statusCode: 404 }), page("/500", { statusCode: 500 }), page("/no", { robots: { indexable: false, followable: false } })]));
    expect(ids(result)).toEqual(expect.arrayContaining(["indexability.http-errors", "indexability.noindex-pages", "indexability.nofollow-pages"]));
  });

  it("detects external canonical, canonical to 404, canonical to redirect and canonical chains", () => {
    const result = analyzeIndexability(crawl([
      page("/external", { canonical: "https://external.example/page" }),
      page("/bad", { canonical: "https://example.com/404" }),
      page("/404", { statusCode: 404 }),
      page("/redir-source", { canonical: "https://example.com/redir" }),
      page("/redir", { statusCode: 301 }),
      page("/chain-a", { canonical: "https://example.com/chain-b" }),
      page("/chain-b", { canonical: "https://example.com/chain-c" })
    ]));
    expect(ids(result)).toEqual(expect.arrayContaining(["indexability.external-canonical", "indexability.canonical-target-error", "indexability.canonical-target-redirect", "indexability.canonical-chain"]));
  });

  it("detects canonical/noindex conflicts and sitemap mismatches", () => {
    const result = analyzeIndexability(crawl([page("/missing-sitemap"), page("/noindex", { canonical: "https://example.com/noindex", robots: { indexable: false, followable: true } })], { sitemap: { discoveredSitemaps: [], urls: ["https://example.com/noindex"], errors: [], outsideDomain: [] } }));
    expect(ids(result)).toEqual(expect.arrayContaining(["indexability.indexable-missing-sitemap", "indexability.noindex-in-sitemap", "indexability.canonical-noindex-conflict"]));
  });
});

describe("duplicate content analyzer", () => {
  it("detects duplicate title, meta description and H1", () => {
    const result = analyzeDuplicateContent(crawl([page("/a", { title: "Same", h1: "Same H1", metaDescription: "Same meta" }), page("/b", { title: "Same", h1: "Same H1", metaDescription: "Same meta" })]));
    expect(ids(result)).toEqual(expect.arrayContaining(["duplicate-content.duplicate-title", "duplicate-content.duplicate-h1", "duplicate-content.duplicate-meta-description"]));
  });

  it("detects exact and near duplicate content", () => {
    const result = analyzeDuplicateContent(crawl([
      page("/exact-a", { contentFingerprint: "same" }),
      page("/exact-b", { contentFingerprint: "same" }),
      page("/near-a", { contentSignature: ["alpha", "beta", "gamma", "delta", "epsilon"] }),
      page("/near-b", { contentSignature: ["alpha", "beta", "gamma", "delta", "zeta"] })
    ], { configuration: { duplicateSimilarityThreshold: 0.6 } }));
    expect(ids(result)).toEqual(expect.arrayContaining(["duplicate-content.exact-content-match", "duplicate-content.near-duplicate-content"]));
  });

  it("does not mark shared templates with different main content as near duplicates", () => {
    const result = analyzeDuplicateContent(crawl([
      page("/template-a", { contentSignature: ["header", "footer", "nav", "analytics", "migration", "enterprise"] }),
      page("/template-b", { contentSignature: ["header", "footer", "nav", "catalog", "merchandising", "ecommerce"] })
    ], { configuration: { duplicateSimilarityThreshold: 0.86 } }));
    expect(ids(result)).not.toContain("duplicate-content.near-duplicate-content");
  });

  it("documents the near-duplicate threshold in the issue evidence", () => {
    const result = analyzeDuplicateContent(crawl([page("/a", { contentSignature: ["a", "b", "c"] }), page("/b", { contentSignature: ["a", "b", "c"] })], { configuration: { duplicateSimilarityThreshold: 0.86 } }));
    expect(result.issues.find((issue) => issue.id === "duplicate-content.near-duplicate-content")?.evidence?.threshold).toBe(0.86);
  });
});
