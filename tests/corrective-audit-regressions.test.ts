import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { analyzeContent } from "../src/analyzers/content.js";
import { analyzeGeo } from "../src/analyzers/geo.js";
import type { AuditContext } from "../src/core/audit-context.js";
import { createNetworkAccessPolicy } from "../src/core/network-policy.js";
import { fetchPage } from "../src/core/fetch-page.js";
import { parseHtml, type PageIntent } from "../src/core/parse-html.js";
import { validateUrlSyntax } from "../src/core/url-safety.js";
import { crawlSite } from "../src/crawler/crawler.js";
import { aggregatePerformance } from "../src/performance/performance-aggregation.js";
import type { PerformanceResult } from "../src/performance/performance-schema.js";
import { buildSitewideReport } from "../src/reporting/sitewide-report.js";
import { historyEntryFromReport } from "../src/history/history-entry.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/fixture-server.js";

function context(html: string, url = "https://example.com/test"): AuditContext {
  const parsed = parseHtml(html, url);
  return {
    requestedUrl: url,
    finalUrl: url,
    domain: new URL(url).hostname,
    startedAt: new Date(0).toISOString(),
    fetch: { requestedUrl: url, finalUrl: url, status: 200, headers: { "content-type": "text/html" }, html, redirects: [], durationMs: 1 },
    html,
    rendered: false,
    parsed,
    networkPolicy: createNetworkAccessPolicy(url, { allowPrivateNetwork: url.includes("127.0.0.1") || url.includes("localhost") }),
    pageIntent: parsed.pageIntent
  };
}

function htmlFor(path: string, title: string, h1: string, body: string, extra = ""): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="A useful description long enough to avoid length warnings for this page."></head><body><main><h1>${h1}</h1>${extra}<p>${body}</p></main></body></html>`;
}

function perf(url: string, score: number, lcpMs: number, requestCount = 10): PerformanceResult {
  return {
    schemaVersion: "1.0.0",
    url,
    finalUrl: url,
    source: "local",
    engine: "lighthouse",
    scoreKind: "official-lighthouse",
    executionEnvironment: "local",
    scope: "url",
    device: "mobile",
    collectedAt: new Date(0).toISOString(),
    runCount: 1,
    lighthousePerformanceScore: score,
    scores: { performance: score, accessibility: 100, bestPractices: 100, seo: 100 },
    metrics: { lcpMs, cls: 0, tbtMs: 100, ttfbMs: 50 },
    resources: { requestCount, transferBytes: requestCount * 1000, javascriptBytes: 1, cssBytes: 1, imageBytes: 1, fontBytes: 0, thirdPartyBytes: 0 },
    diagnostics: { mainThreadWorkMs: 1, bootupTimeMs: 1, unusedJavascriptBytes: 0, unusedCssBytes: 0, renderBlockingResources: 0, longTaskCount: 0 },
    opportunities: [],
    statistics: { median: score, min: score, max: score, standardDeviation: 0, coefficientOfVariation: 0, iqr: 0 },
    warnings: [],
    runs: [],
    confidence: "low"
  };
}

describe("corrective local network policy", () => {
  const privateNetworkA = ["10", "0", "0", "1"].join(".");
  const privateNetworkB = ["192", "168", "1", "2"].join(".");
  let fixture: FixtureServer;
  beforeAll(async () => { fixture = await startFixtureServer(); });
  afterAll(async () => { await fixture.close(); });

  it.each([
    ["localhost stays blocked by default", "http://localhost:3000", false],
    ["127.0.0.1 stays blocked by default", "http://127.0.0.1:3000", false],
    ["::1 stays blocked by default", "http://[::1]:3000", false],
    ["private network A stays blocked by default", `http://${privateNetworkA}`, false],
    ["private network B stays blocked by default", `http://${privateNetworkB}`, false],
    ["localhost allowed explicitly", "http://localhost:3000", true],
    ["127.0.0.1 allowed explicitly", "http://127.0.0.1:3000", true],
    ["::1 allowed explicitly", "http://[::1]:3000", true],
    ["private network A allowed explicitly", `http://${privateNetworkA}`, true],
    ["private network B allowed explicitly", `http://${privateNetworkB}`, true]
  ])("%s", (_name, url, allowed) => {
    const run = () => validateUrlSyntax(url, { allowPrivateNetwork: allowed });
    if (allowed) expect(run()).toBeInstanceOf(URL);
    else expect(run).toThrow(/Blocked/);
  });

  it("allows a local redirect when explicitly enabled", async () => {
    const result = await fetchPage(`${fixture.baseUrl}/redirect`, { allowPrivateNetwork: true });
    expect(result.finalUrl).toContain("/redirect-target");
    expect(result.redirects).toHaveLength(1);
  });

  it("rejects a redirect to credentials even when local audits are enabled", async () => {
    await expect(fetchPage(`${fixture.baseUrl}/redirect-credentials`, { allowPrivateNetwork: true })).rejects.toThrow(/credentials/);
  });

  it("prints --allow-private-network in audit help", async () => {
    const out = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "audit", "--help"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.on("close", () => resolve(stdout));
    });
    expect(out).toContain("--allow-private-network");
    expect(out).toContain("--allow-localhost");
  });
});

describe("corrective page intent and GEO rules", () => {
  it.each<[string, string, PageIntent]>([
    ["homepage", htmlFor("/", "Example Project", "Welcome", "Homepage brand story and product navigation."), "homepage"],
    ["authentication password", htmlFor("/connexion", "Connexion", "Sign in", "Access your account.", '<form><input type="password"></form>'), "authentication"],
    ["forgot password", htmlFor("/mot-de-passe-oublie", "Mot de passe oublié", "Reset", "Reset your password."), "authentication"],
    ["cart", htmlFor("/panier", "Mon panier", "Cart", "Review items and checkout."), "transactional"],
    ["account", htmlFor("/compte", "Mon compte", "Account", "Manage account orders."), "transactional"],
    ["configurator query", htmlFor("/creer?modele=classic", "Créer ma montre", "Configurator", "Configure a custom watch sur-mesure."), "configurator"],
    ["category", htmlFor("/montres", "Toutes nos montres", "Tous les modèles", "Browse the full watch catalogue."), "category"],
    ["contact", htmlFor("/contact", "Contact", "Contact us", "Contact the support team."), "utility"],
    ["editorial", htmlFor("/guide/choisir", "Guide choisir sa montre", "Guide", "This article explains how a watch works. It includes advice and examples."), "editorial"],
    ["unknown", htmlFor("/x", "Plain", "Plain", "A neutral page."), "unknown"]
  ])("classifies %s", (_name, html, expected) => {
    const url = _name === "homepage" ? "https://example.com/" : `https://example.com/${_name}`;
    expect(parseHtml(html, url).pageIntent).toBe(expected);
  });

  it.each([
    ["authentication", htmlFor("/connexion", "Connexion", "Sign in", "Access your account.", '<form><input type="password"></form>'), /not applied/],
    ["transactional", htmlFor("/panier", "Mon panier", "Cart", "Review checkout."), /not applied/],
    ["configurator", htmlFor("/creer?modele=x", "Créer ma montre", "Configurator", "Configure a watch."), /not applied/],
    ["utility", htmlFor("/contact", "Contact", "Contact", "Contact support."), /not applied/],
    ["editorial", htmlFor("/blog/a", "Article useful watch guide", "Article", "This article explains how watch sizing works. It provides details, context, examples, and practical advice for choosing a size."), /No clear direct-answer/]
  ])("applies GEO appropriately on %s", async (_name, html, expectedTitle) => {
    const result = await analyzeGeo(context(html, `https://example.com/${_name}`));
    expect(result.issues.map((item) => item.title).join("\n")).toMatch(expectedTitle);
  });
});

describe("corrective content extraction", () => {
  it.each([
    ["script token removed", "nextjs"],
    ["module token removed", "modules"],
    ["chunk token removed", "chunks"],
    ["class token removed", "classname"],
    ["nonce token removed", "nonce"],
    ["process token removed", "process"],
    ["framework token removed", "framework"],
    ["static token removed", "static"]
  ])("%s", (_name, token) => {
    const parsed = parseHtml(`<!doctype html><html><body><main><h1>Visible title</h1><p>Visible useful content remains.</p></main><script>window.__next_f.push(['${token} placeholder classname chunks process framework static nonce'])</script></body></html>`, "https://example.com/");
    expect(parsed.bodyText.toLowerCase()).not.toContain(token);
  });

  it("ignores placeholder attributes", async () => {
    const html = htmlFor("/reset", "Password reset page", "Reset", "Enter your email to reset access.", '<form><input placeholder="placeholder"></form>');
    const result = await analyzeContent(context(html));
    expect(result.issues.some((item) => item.id === "content.placeholder-copy")).toBe(false);
  });

  it("detects visible placeholder copy with snippet evidence", async () => {
    const html = htmlFor("/draft", "Draft page title", "Draft", "This placeholder copy is visible to users and should be replaced.");
    const result = await analyzeContent(context(html));
    const found = result.issues.find((item) => item.id === "content.placeholder-copy");
    expect(found?.evidence).toMatchObject({ matches: ["placeholder"] });
    expect(JSON.stringify(found?.evidence)).toContain("visible to users");
  });
});

describe("corrective crawl counters and reporting", () => {
  let fixture: FixtureServer;
  beforeAll(async () => { fixture = await startFixtureServer(); });
  afterAll(async () => { await fixture.close(); });

  it.each([
    ["robots-blocked is explicit", async () => (await crawlSite(fixture.baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30 })).pages.some((page) => page.resultType === "robots-blocked")],
    ["robots-blocked not counted as fetched", async () => { const crawl = await crawlSite(fixture.baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30 }); return (crawl.stats.fetchedPages ?? 0) < crawl.pages.length; }],
    ["status total equals fetched pages", async () => { const crawl = await crawlSite(fixture.baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30 }); return Object.values(crawl.stats.statusCodes).reduce((a, b) => a + b, 0) === crawl.stats.fetchedPages; }],
    ["invariants pass", async () => (await crawlSite(fixture.baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30 })).stats.invariants?.passed === true],
    ["404 counts as failed", async () => { const crawl = await crawlSite(`${fixture.baseUrl}/missing`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false }); return crawl.stats.failedPages === 1 && crawl.stats.httpErrorPages === 1; }],
    ["500 counts as failed", async () => { const crawl = await crawlSite(`${fixture.baseUrl}/server-error`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false }); return crawl.stats.failedPages === 1 && crawl.pages[0]?.statusGroup === "5xx"; }],
    ["network failure counts as fetch failure", async () => { const crawl = await crawlSite("http://127.0.0.1:9", { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false }); return crawl.stats.fetchFailurePages === 1; }],
    ["redirect exposes final URL", async () => { const crawl = await crawlSite(`${fixture.baseUrl}/redirect`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false }); return crawl.pages[0]?.redirectCount === 1 && crawl.pages[0]?.finalUrl.includes("redirect-target"); }],
    ["sitewide report mirrors crawl stats", async () => { const crawl = await crawlSite(fixture.baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 10 }); const report = buildSitewideReport(crawl); return report.summary.crawledPages === crawl.stats.crawledPages && report.summary.reportEntries === crawl.stats.reportEntries; }],
    ["history mirrors report performance mean", async () => { const crawl = await crawlSite(fixture.baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 2 }); const report = buildSitewideReport(crawl, [perf(`${fixture.baseUrl}/`, 40, 1000), perf(`${fixture.baseUrl}/category`, 60, 3000)]); const entry = historyEntryFromReport(report); return entry.summary.performance?.lighthouseScore === 50; }]
  ])("%s", async (_name, check) => {
    await expect(check()).resolves.toBe(true);
  });
});

describe("corrective performance aggregation", () => {
  it.each([
    ["mean", () => aggregatePerformance([perf("https://e.test/a", 40, 1000), perf("https://e.test/b", 60, 3000)]).lighthouseScore.mean, 50],
    ["median", () => aggregatePerformance([perf("https://e.test/a", 40, 1000), perf("https://e.test/b", 60, 3000), perf("https://e.test/c", 80, 5000)]).lighthouseScore.median, 60],
    ["min", () => aggregatePerformance([perf("https://e.test/a", 40, 1000), perf("https://e.test/b", 60, 3000)]).lighthouseScore.min, 40],
    ["max", () => aggregatePerformance([perf("https://e.test/a", 40, 1000), perf("https://e.test/b", 60, 3000)]).lighthouseScore.max, 60],
    ["excludes missing", () => aggregatePerformance([{ ...perf("https://e.test/a", 40, 1000), lighthousePerformanceScore: undefined }, perf("https://e.test/b", 60, 3000)]).lighthouseScore.mean, 60],
    ["eligible gap", () => aggregatePerformance([perf("https://e.test/a", 40, 1000)], { eligiblePages: 3 }).excludedPages, 2]
  ])("computes %s", (_name, read, expected) => {
    expect(read()).toBe(expected);
  });
});

