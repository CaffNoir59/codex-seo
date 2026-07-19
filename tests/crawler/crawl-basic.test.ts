import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() {
  fixture = await startFixtureServer();
  return fixture;
}
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("crawler basic integration", () => {
  it("crawls the home page with status, content type and depth", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3 });
    const home = crawl.pages.find((page) => page.url === `${baseUrl}/`);
    expect(home?.statusCode).toBe(200);
    expect(home?.contentType).toContain("text/html");
    expect(home?.depth).toBe(0);
  });

  it("discovers internal links and does not crawl external links", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3 });
    expect(crawl.pages.some((page) => page.url === `${baseUrl}/category`)).toBe(true);
    expect(crawl.pages.some((page) => page.url.includes("external.example"))).toBe(false);
    expect(crawl.skipped.some((skip) => skip.reason === "outside-domain")).toBe(true);
  });

  it("records discoveredFrom for linked pages and sitemap seeds", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3 });
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/category`)?.discoveredFrom).toBe(`${baseUrl}/`);
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/orphan`)?.discoveredFrom).toBe("sitemap");
  });

  it("returns pages in deterministic depth then URL order", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 30, maxDepth: 3, concurrency: 5 });
    expect(crawl.pages.map((page) => page.url)).toEqual([...crawl.pages].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url)).map((page) => page.url));
  });

  it("never crawls the same normalized URL twice", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 3 });
    const urls = crawl.pages.map((page) => page.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
