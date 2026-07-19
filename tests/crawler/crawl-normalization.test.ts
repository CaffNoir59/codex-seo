import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { filterUrl, createUrlFilterState } from "../../src/crawler/url-filter.js";
import { isSameAllowedDomain, normalizeUrl } from "../../src/crawler/url-normalizer.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() { fixture = await startFixtureServer(); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("crawler URL normalization", () => {
  it("normalizes fragments, host case, default ports, slash and query order", () => {
    expect(normalizeUrl("HTTP://Example.COM:80/page/?b=2&a=1#frag")).toBe("http://example.com/page?a=1&b=2");
  });

  it("removes UTM, gclid, fbclid and msclkid parameters", () => {
    expect(normalizeUrl("https://example.com/page?utm_source=x&gclid=y&fbclid=z&msclkid=q")).toBe("https://example.com/page");
  });

  it("keeps unknown functional parameters distinct", () => {
    expect(normalizeUrl("https://example.com/product?id=1")).not.toBe(normalizeUrl("https://example.com/product?id=2"));
  });

  it("resolves encoded, relative and protocol-relative URLs through the filter", () => {
    const state = createUrlFilterState();
    const root = "https://example.com/";
    expect(filterUrl("/caf%C3%A9", root, { includeSubdomains: false, includePatterns: [], excludePatterns: [] } as never, state).normalizedUrl).toBe("https://example.com/caf%C3%A9");
    expect(filterUrl("//example.com/path", root, { includeSubdomains: false, includePatterns: [], excludePatterns: [] } as never, state).normalizedUrl).toBe("https://example.com/path");
  });

  it("deduplicates tracking variants during crawl", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/?utm_source=x`, { allowPrivateNetwork: true, render: "never", maxPages: 40, maxDepth: 2 });
    expect(crawl.pages.filter((page) => page.url === `${baseUrl}/product?id=1`).length).toBe(1);
    expect(crawl.pages.some((page) => page.url.includes("utm_source"))).toBe(false);
  });

  it("keeps product ids as separate pages", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 40, maxDepth: 2 });
    expect(crawl.pages.some((page) => page.url === `${baseUrl}/product?id=1`)).toBe(true);
    expect(crawl.pages.some((page) => page.url === `${baseUrl}/product?id=2`)).toBe(true);
  });

  it("allows only real subdomains when configured", () => {
    expect(isSameAllowedDomain("https://sub.example.com/a", "https://example.com", true)).toBe(true);
    expect(isSameAllowedDomain("https://example.com.evil.test/a", "https://example.com", true)).toBe(false);
    expect(isSameAllowedDomain("https://other.example.test/a", "https://example.com", true)).toBe(false);
  });
});
