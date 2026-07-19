import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { discoverSitemaps } from "../../src/crawler/sitemap-discovery.js";
import { resolveCrawlConfig } from "../../src/crawler/crawl-config.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() { fixture = await startFixtureServer(); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("crawler sitemap discovery", () => {
  it("discovers simple, nested, circular and gzipped sitemaps", async () => {
    const { baseUrl } = await start();
    const sitemap = await discoverSitemaps(baseUrl, resolveCrawlConfig({ allowPrivateNetwork: true }));
    expect(sitemap.discoveredSitemaps).toContain(`${baseUrl}/sitemap.xml`);
    expect(sitemap.discoveredSitemaps).toContain(`${baseUrl}/nested-sitemap-index.xml`);
    expect(sitemap.discoveredSitemaps).toContain(`${baseUrl}/sitemap.xml.gz`);
    expect(new Set(sitemap.discoveredSitemaps).size).toBe(sitemap.discoveredSitemaps.length);
  });

  it("deduplicates sitemap URLs across multiple sitemaps", async () => {
    const { baseUrl } = await start();
    const sitemap = await discoverSitemaps(baseUrl, resolveCrawlConfig({ allowPrivateNetwork: true }));
    expect(sitemap.urls.filter((url) => url === `${baseUrl}/orphan`).length).toBe(1);
  });

  it("records sitemap errors and outside-domain URLs", async () => {
    const { baseUrl } = await start();
    const sitemap = await discoverSitemaps(baseUrl, resolveCrawlConfig({ allowPrivateNetwork: true }));
    expect(sitemap.errors.some((error) => error.includes("missing-sitemap.xml"))).toBe(true);
    expect(sitemap.outsideDomain).toContain("https://outside.example/page");
  });

  it("uses sitemap-only URLs as crawl seeds", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 2 });
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/orphan`)?.discoveredFrom).toBe("sitemap");
    expect(crawl.pages.find((page) => page.url === `${baseUrl}/gzip-only`)?.discoveredFrom).toBe("sitemap");
  });

  it("reports indexable pages absent from sitemap and noindex pages in sitemap", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 2 });
    expect(crawl.sitemap.urls).toContain(`${baseUrl}/noindex`);
    expect(crawl.sitemap.urls).not.toContain(`${baseUrl}/missing`);
  });
});
