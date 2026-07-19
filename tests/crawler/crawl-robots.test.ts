import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { getRobotsRules, clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start(robotsMode?: "normal" | "missing" | "inaccessible" | "star") { fixture = await startFixtureServer({ robotsMode }); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("crawler robots.txt", () => {
  it("allows all when robots.txt is absent", async () => {
    const { baseUrl } = await start("missing");
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 20, maxDepth: 1 });
    expect(crawl.stats.robotsErrors.some((error) => error.includes("robots-status-404"))).toBe(true);
    expect(crawl.stats.blockedByRobots).toBe(0);
  });

  it("allows all when robots.txt is inaccessible", async () => {
    const { baseUrl } = await start("inaccessible");
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 20, maxDepth: 1 });
    expect(crawl.stats.robotsErrors.some((error) => error.includes("robots-status-500"))).toBe(true);
    expect(crawl.stats.blockedByRobots).toBe(0);
  });

  it("prefers User-agent CodexSEO over other groups", async () => {
    const { baseUrl } = await start();
    const rules = await getRobotsRules(baseUrl, true);
    expect(rules.isAllowed(`${baseUrl}/category`)).toBe(true);
    expect(rules.isAllowed(`${baseUrl}/blocked`)).toBe(false);
  });

  it("falls back to User-agent star", async () => {
    const { baseUrl } = await start("star");
    const rules = await getRobotsRules(baseUrl, true);
    expect(rules.isAllowed(`${baseUrl}/blocked`)).toBe(false);
  });

  it("honors Allow under a broader Disallow using the most specific rule", async () => {
    const { baseUrl } = await start();
    const rules = await getRobotsRules(baseUrl, true);
    expect(rules.isAllowed(`${baseUrl}/blocked/allowed`)).toBe(true);
  });

  it("keeps blocked URL discovered but not visited and increments blockedByRobots", async () => {
    const { baseUrl, requestCounts } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 40, maxDepth: 2 });
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/blocked`)?.error?.code).toBe("robots-blocked");
    expect(crawl.stats.blockedByRobots).toBeGreaterThanOrEqual(1);
    expect(requestCounts.get("/blocked") ?? 0).toBe(0);
  });

  it("records sitemap declarations and crawl-delay", async () => {
    const { baseUrl } = await start();
    const rules = await getRobotsRules(baseUrl, true);
    expect(rules.sitemaps).toContain(`${baseUrl}/sitemap-index.xml`);
    expect(rules.crawlDelayMs).toBe(0);
  });
});
