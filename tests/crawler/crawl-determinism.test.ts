import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { buildSitewideReport } from "../../src/reporting/sitewide-report.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start(delayMs = 0) { fixture = await startFixtureServer({ delayMs }); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });
function stable(crawl: Awaited<ReturnType<typeof crawlSite>>) {
  const report = buildSitewideReport(crawl);
  return {
    urls: crawl.pages.map((page) => [page.url, page.depth, page.statusCode, page.error?.code ?? ""]),
    issues: report.issues.map((issue) => issue.id),
    score: report.summary.score,
    stats: { ...crawl.stats, robotsErrors: crawl.stats.robotsErrors.map((error) => error.replace(/:\d+/g, ":PORT")) }
  };
}

describe("crawler determinism and concurrency", () => {
  it("keeps the same result with concurrency 1 and 2", async () => {
    const { baseUrl } = await start();
    const one = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3, concurrency: 1 });
    clearRobotsCache();
    const two = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3, concurrency: 2 });
    expect(stable(two)).toEqual(stable(one));
  });

  it("keeps the same result with concurrency 5", async () => {
    const { baseUrl } = await start();
    const one = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3, concurrency: 1 });
    clearRobotsCache();
    const five = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3, concurrency: 5 });
    expect(stable(five)).toEqual(stable(one));
  });

  it("does not download the same normalized URL simultaneously", async () => {
    const { baseUrl, requestCounts } = await start(20);
    await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 3, concurrency: 5 });
    expect(requestCounts.get("/product?id=1") ?? 0).toBe(1);
  });
});
