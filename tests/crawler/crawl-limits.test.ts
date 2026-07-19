import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() { fixture = await startFixtureServer(); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });
const counted = (crawl: Awaited<ReturnType<typeof crawlSite>>) => crawl.pages.filter((page) => !page.error || page.error.code !== "robots-blocked").length;

describe("crawler limits", () => {
  it("stops exactly at max-pages 1", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 1, maxDepth: 4, concurrency: 5 });
    expect(counted(crawl)).toBe(1);
    expect(crawl.skipped.some((skip) => skip.reason === "page-budget")).toBe(true);
  });

  it("stops exactly at max-pages 5 without concurrency overflow", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 5, maxDepth: 4, concurrency: 5 });
    expect(counted(crawl)).toBe(5);
    expect(crawl.stats.skippedUrls).toBe(crawl.skipped.length);
  });

  it("crawls all reachable pages when budget equals reachable page count", async () => {
    const { baseUrl } = await start();
    const full = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 100, maxDepth: 4, concurrency: 4 });
    const exact = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: counted(full), maxDepth: 4, concurrency: 4 });
    expect(counted(exact)).toBe(counted(full));
  });

  it("respects max-depth and marks beyond-limit links", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 2 });
    expect(Math.max(...crawl.pages.map((page) => page.depth))).toBeLessThanOrEqual(2);
    expect(crawl.skipped.some((skip) => skip.reason === "max-depth")).toBe(true);
  });

  it("records each page at its minimum discovered depth", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4 });
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/short-target`)?.depth).toBe(1);
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/deep/level-2`)?.depth).toBe(2);
  });

  it("keeps depth distribution coherent", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 3 });
    const total = Object.values(crawl.stats.depthDistribution).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(crawl.pages.length);
  });
});
