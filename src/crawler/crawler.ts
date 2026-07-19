import { analyzeContent } from "../analyzers/content.js";
import { analyzeGeo } from "../analyzers/geo.js";
import { analyzeImages } from "../analyzers/images.js";
import { analyzeSchema } from "../analyzers/schema.js";
import { analyzeTechnical } from "../analyzers/technical.js";
import type { AuditContext } from "../core/audit-context.js";
import { fetchPage, type FetchPageResult } from "../core/fetch-page.js";
import { createNetworkAccessPolicy, assertPolicyUrl } from "../core/network-policy.js";
import { sortIssues, type AnalyzerResult } from "../core/issue.js";
import crypto from "node:crypto";
import { parseHtml } from "../core/parse-html.js";
import { renderPage, shouldRenderWithBrowser } from "../core/render-page.js";
import { resolveCrawlConfig, type CrawlConfig } from "./crawl-config.js";
import { CrawlQueue } from "./crawl-queue.js";
import { createUrlFilterState, filterUrl } from "./url-filter.js";
import { extractLinks } from "./link-extractor.js";
import { getRobotsRules } from "./robots.js";
import { discoverSitemaps } from "./sitemap-discovery.js";
import { normalizeUrl } from "./url-normalizer.js";
import { crawledPageSchema, type CrawledPage, type CrawlResult, type SkippedUrl } from "./crawl-result.js";

const pageAnalyzers = [analyzeTechnical, analyzeContent, analyzeSchema, analyzeImages, analyzeGeo];

const CONTENT_STOP_WORDS = new Set(["about", "after", "also", "because", "before", "codex", "content", "from", "have", "into", "more", "page", "pages", "section", "that", "their", "there", "this", "with", "your"]);

function isHtmlLikeContentType(contentType: string | undefined): boolean {
  const value = (contentType ?? "").toLowerCase();
  return value === "" || value.includes("text/html") || value.includes("application/xhtml+xml");
}

function statusGroup(status: number | undefined): "2xx" | "3xx" | "4xx" | "5xx" | "none" {
  if (!status) return "none";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

function contentSignature(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (CONTENT_STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([tokenA, countA], [tokenB, countB]) => countB - countA || tokenA.localeCompare(tokenB))
    .slice(0, 120)
    .map(([token]) => token)
    .sort();
}

type CrawlInternalState = {
  cache: Map<string, FetchPageResult>;
  skipped: SkippedUrl[];
  exclusions: Map<string, number>;
  lastHostFetch: Map<string, number>;
  robotsErrors: Set<string>;
  blockedByRobots: number;
  discoveredUrls: Set<string>;
};

function addExclusion(state: CrawlInternalState, url: string, normalizedUrl: string, reason: string, depth: number, discoveredFrom?: string): void {
  state.exclusions.set(reason, (state.exclusions.get(reason) ?? 0) + 1);
  state.skipped.push({ url, normalizedUrl, reason, depth, discoveredFrom });
}

async function politeDelay(url: string, crawlDelayMs: number, state: CrawlInternalState): Promise<void> {
  const host = new URL(url).host;
  const last = state.lastHostFetch.get(host) ?? 0;
  const wait = Math.max(0, last + crawlDelayMs - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  state.lastHostFetch.set(host, Date.now());
}

async function fetchWithCache(url: string, config: CrawlConfig, state: CrawlInternalState, crawlDelayMs: number): Promise<FetchPageResult> {
  const cached = config.cache ? state.cache.get(url) : undefined;
  if (cached) return cached;
  await politeDelay(url, crawlDelayMs, state);
  const result = await fetchPage(url, { timeoutMs: 15000, maxRedirects: 5, networkPolicy: config.networkPolicy, allowPrivateNetwork: config.allowPrivateNetwork });
  if (config.cache) state.cache.set(url, result);
  return result;
}

async function analyzePage(context: AuditContext): Promise<AnalyzerResult[]> {
  const results = await Promise.all(pageAnalyzers.map(async (analyzer) => {
    try {
      return await analyzer(context);
    } catch (error) {
      return {
        category: "technical",
        issues: [],
        summary: {},
        errors: [error instanceof Error ? error.message : String(error)]
      } satisfies AnalyzerResult;
    }
  }));
  return results.sort((a, b) => a.category.localeCompare(b.category));
}

async function crawlOne(item: { url: string; depth: number; discoveredFrom?: string }, startUrl: string, config: CrawlConfig, state: CrawlInternalState): Promise<CrawledPage> {
  const robots = await getRobotsRules(item.url, config.networkPolicy ?? config.allowPrivateNetwork);
  for (const error of robots.errors) state.robotsErrors.add(`${robots.origin}: ${error}`);
  if (config.respectRobots && !robots.isAllowed(item.url)) {
    state.blockedByRobots += 1;
    return crawledPageSchema.parse({
      url: item.url,
      requestedUrl: item.url,
      finalUrl: item.url,
      depth: item.depth,
      resultType: "robots-blocked",
      statusGroup: "none",
      fetchMode: "http",
      discoveredFrom: item.discoveredFrom,
      links: { internal: [], external: [] },
      issues: [],
      error: { code: "robots-blocked", message: "Blocked by robots.txt" }
    });
  }

  try {
    const fetched = await fetchWithCache(item.url, config, state, robots.crawlDelayMs);
    let html = fetched.html;
    let finalUrl = fetched.finalUrl;
    let fetchMode: "http" | "browser" = "http";
    const redirects = fetched.redirects;
    if (!isHtmlLikeContentType(fetched.headers["content-type"])) {
      return crawledPageSchema.parse({
        url: item.url,
        requestedUrl: item.url,
        finalUrl,
        depth: item.depth,
        resultType: "non-html",
        statusCode: fetched.status,
        statusGroup: statusGroup(fetched.status),
        contentType: fetched.headers["content-type"],
        fetchMode,
        discoveredFrom: item.discoveredFrom,
        redirectCount: redirects.length,
        redirectChain: redirects,
        links: { internal: [], external: [] },
        issues: [],
        error: { code: "non-html-content-type", message: `Non-HTML content type: ${fetched.headers["content-type"] ?? "unknown"}` }
      });
    }
    if (config.render === "always" || (config.render === "auto" && shouldRenderWithBrowser(html))) {
      const rendered = await renderPage(finalUrl, { networkPolicy: config.networkPolicy, allowPrivateNetwork: config.allowPrivateNetwork });
      html = rendered.html;
      finalUrl = rendered.finalUrl;
      fetchMode = "browser";
    }
    const parsed = parseHtml(html, finalUrl);
    const links = extractLinks(parsed, startUrl, config.includeSubdomains);
    const context: AuditContext = {
      requestedUrl: item.url,
      finalUrl,
      domain: new URL(startUrl).hostname,
      startedAt: new Date().toISOString(),
      fetch: { ...fetched, finalUrl, html },
      html,
      rendered: fetchMode === "browser",
      parsed,
      networkPolicy: config.networkPolicy ?? createNetworkAccessPolicy(startUrl, { allowPrivateNetwork: config.allowPrivateNetwork }),
      pageIntent: parsed.pageIntent
    };
    const analyzerResults = await analyzePage(context);
    const issues = sortIssues(analyzerResults.flatMap((result) => result.issues));
    const robotsMeta = parsed.robots ?? "";
    return crawledPageSchema.parse({
      url: item.url,
      requestedUrl: item.url,
      finalUrl,
      depth: item.depth,
      resultType: fetched.status >= 400 ? "http-error" : "success",
      statusCode: fetched.status,
      statusGroup: statusGroup(fetched.status),
      contentType: fetched.headers["content-type"],
      fetchMode,
      discoveredFrom: item.discoveredFrom,
      redirectCount: redirects.length,
      redirectChain: redirects,
      redirectType: redirects.length ? `${fetched.status}` : undefined,
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      h1: parsed.h1s[0],
      pageIntent: parsed.pageIntent,
      contentFingerprint: crypto.createHash("sha1").update(parsed.bodyText.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex"),
      contentSignature: contentSignature(parsed.bodyText),
      canonical: parsed.canonical,
      robots: {
        indexable: !/noindex/i.test(robotsMeta),
        followable: !/nofollow/i.test(robotsMeta)
      },
      timings: { durationMs: fetched.durationMs },
      links: { internal: links.internal, external: links.external, emptyAnchors: links.emptyAnchors, genericAnchors: links.genericAnchors },
      issues
    });
  } catch (error) {
    return crawledPageSchema.parse({
      url: item.url,
      requestedUrl: item.url,
      finalUrl: item.url,
      depth: item.depth,
      resultType: "fetch-error",
      statusGroup: "none",
      fetchMode: "http",
      discoveredFrom: item.discoveredFrom,
      links: { internal: [], external: [] },
      issues: [],
      error: { code: "fetch-error", message: error instanceof Error ? error.message : String(error) }
    });
  }
}

function buildStats(pages: CrawledPage[], state: CrawlInternalState, sitemapUrlCount: number): CrawlResult["stats"] {
  const statusCodes: Record<string, number> = {};
  const depthDistribution: Record<string, number> = {};
  const resultTypes: Record<string, number> = {};
  for (const page of pages) {
    if (page.statusCode) statusCodes[String(page.statusCode)] = (statusCodes[String(page.statusCode)] ?? 0) + 1;
    depthDistribution[String(page.depth)] = (depthDistribution[String(page.depth)] ?? 0) + 1;
    const type = page.resultType ?? "success";
    resultTypes[type] = (resultTypes[type] ?? 0) + 1;
  }
  const attemptedPages = pages.filter((page) => page.resultType !== "robots-blocked" && page.resultType !== "filtered").length;
  const fetchedPages = pages.filter((page) => page.statusCode !== undefined).length;
  const successfulPages = pages.filter((page) => page.resultType === "success").length;
  const httpErrorPages = pages.filter((page) => page.resultType === "http-error" || (page.statusCode ?? 0) >= 400).length;
  const fetchFailurePages = pages.filter((page) => page.resultType === "fetch-error").length;
  const renderFailurePages = pages.filter((page) => page.resultType === "render-error").length;
  const failedPages = httpErrorPages + fetchFailurePages + renderFailurePages;
  const crawledPages = fetchedPages;
  const invariants: string[] = [];
  const statusTotal = Object.values(statusCodes).reduce((sum, value) => sum + value, 0);
  if (crawledPages !== fetchedPages) invariants.push("crawledPages must equal fetchedPages");
  if (state.blockedByRobots !== (resultTypes["robots-blocked"] ?? 0)) invariants.push("blockedByRobots must match robots-blocked result entries");
  if (statusTotal !== fetchedPages) invariants.push("statusCodes total must equal fetchedPages");
  if (failedPages !== httpErrorPages + fetchFailurePages + renderFailurePages) invariants.push("failedPages must equal HTTP, fetch, and render failures");
  return {
    discoveredUrls: state.discoveredUrls.size,
    attemptedPages,
    fetchedPages,
    successfulPages,
    failedPages,
    httpErrorPages,
    fetchFailurePages,
    renderFailurePages,
    crawledPages,
    reportEntries: pages.length,
    skippedUrls: state.skipped.length,
    blockedByRobots: state.blockedByRobots,
    sitemapUrls: sitemapUrlCount,
    robotsErrors: [...state.robotsErrors].sort(),
    exclusions: Object.fromEntries([...state.exclusions.entries()].sort(([a], [b]) => a.localeCompare(b))),
    statusCodes,
    resultTypes,
    depthDistribution,
    invariants: { passed: invariants.length === 0, errors: invariants }
  };
}

export async function crawlSite(startUrlRaw: string, inputConfig: Partial<CrawlConfig> = {}): Promise<CrawlResult> {
  const networkPolicy = inputConfig.networkPolicy ?? createNetworkAccessPolicy(startUrlRaw, { allowPrivateNetwork: inputConfig.allowPrivateNetwork });
  const config = resolveCrawlConfig({ ...inputConfig, networkPolicy, allowPrivateNetwork: networkPolicy.allowPrivateNetwork });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const startUrl = normalizeUrl(startUrlRaw);
  await assertPolicyUrl(startUrl, config.networkPolicy);
  const queue = new CrawlQueue();
  const filterState = createUrlFilterState();
  const state: CrawlInternalState = {
    cache: new Map(),
    skipped: [],
    exclusions: new Map(),
    lastHostFetch: new Map(),
    robotsErrors: new Set(),
    blockedByRobots: 0,
    discoveredUrls: new Set([startUrl])
  };
  const pages: CrawledPage[] = [];
  const sitemap = await discoverSitemaps(startUrl, config);
  for (const error of sitemap.errors) state.robotsErrors.add(error);

  queue.add(startUrl, 0);
  for (const sitemapUrl of sitemap.urls) {
    state.discoveredUrls.add(sitemapUrl);
    const decision = filterUrl(sitemapUrl, startUrl, config, filterState);
    if (decision.allowed && decision.normalizedUrl) queue.add(decision.normalizedUrl, 1, "sitemap");
    else addExclusion(state, sitemapUrl, decision.normalizedUrl ?? sitemapUrl, decision.reason ?? "filtered", 1, "sitemap");
  }

  const attemptedOrFetched = () => pages.filter((page) => page.resultType !== "robots-blocked" && page.resultType !== "filtered").length;
  while (queue.size > 0 && attemptedOrFetched() < config.maxPages) {
    const remaining = config.maxPages - attemptedOrFetched();
    const batch = queue.nextBatch(Math.min(config.concurrency, remaining));
    for (const item of batch) queue.markSeen(item.url);
    const crawled = await Promise.all(batch.map((item) => crawlOne(item, startUrl, config, state)));
    crawled.sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
    for (const page of crawled) {
      pages.push(page);
      if (page.resultType !== "success" && page.resultType !== "http-error") continue;
      if (page.depth >= config.maxDepth) {
        for (const link of page.links.internal) addExclusion(state, link, normalizeUrl(link), "max-depth", page.depth + 1, page.finalUrl);
        for (const link of page.links.external) addExclusion(state, link, normalizeUrl(link), "outside-domain", page.depth + 1, page.finalUrl);
        continue;
      }
      for (const link of page.links.external) addExclusion(state, link, normalizeUrl(link), "outside-domain", page.depth + 1, page.finalUrl);
      for (const link of page.links.internal) {
        state.discoveredUrls.add(link);
        const decision = filterUrl(link, startUrl, config, filterState);
        if (!decision.allowed || !decision.normalizedUrl) {
          addExclusion(state, link, decision.normalizedUrl ?? link, decision.reason ?? "filtered", page.depth + 1, page.finalUrl);
          continue;
        }
        if (page.depth + 1 <= config.maxDepth && !queue.hasSeen(decision.normalizedUrl)) {
          queue.add(decision.normalizedUrl, page.depth + 1, page.finalUrl);
        } else if (page.depth + 1 > config.maxDepth) {
          addExclusion(state, link, decision.normalizedUrl, "max-depth", page.depth + 1, page.finalUrl);
        }
      }
    }
  }

  if (queue.size > 0) {
    for (const item of queue.pendingItems()) addExclusion(state, item.url, item.url, "page-budget", item.depth, item.discoveredFrom);
  }

  const completedAt = new Date().toISOString();
  const pagesSorted = pages.sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const stats = buildStats(pagesSorted, state, sitemap.urls.length);
  const { networkPolicy: _policy, ...publicConfiguration } = config;
  return {
    startUrl,
    normalizedStartUrl: startUrl,
    startedAt,
    completedAt,
    durationMs: Date.now() - started,
    configuration: { ...publicConfiguration, allowPrivateNetwork: config.allowPrivateNetwork || undefined },
    pages: pagesSorted,
    skipped: state.skipped.sort((a, b) => a.depth - b.depth || a.normalizedUrl.localeCompare(b.normalizedUrl)),
    stats,
    sitemap
  };
}

