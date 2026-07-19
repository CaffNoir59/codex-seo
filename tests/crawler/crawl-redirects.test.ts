import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { assertSafeRedirectTarget, validateUrlSyntax } from "../../src/core/url-safety.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() { fixture = await startFixtureServer(); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("crawler redirects and resource types", () => {
  it("follows a relative redirect and records the final URL", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/redirect`, { allowPrivateNetwork: true, render: "never", maxPages: 3, maxDepth: 1, respectRobots: false });
    expect(crawl.pages[0].finalUrl).toBe(`${baseUrl}/redirect-target`);
    expect(crawl.pages[0].statusCode).toBe(200);
  });

  it("follows a redirect chain", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/redirect-chain`, { allowPrivateNetwork: true, render: "never", maxPages: 3, maxDepth: 1, respectRobots: false });
    expect(crawl.pages[0].finalUrl).toBe(`${baseUrl}/redirect-target`);
  });

  it("reports redirect loops as fetch errors", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/redirect-loop`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false });
    expect(crawl.pages[0].error?.message).toContain("Too many redirects");
  });

  it("blocks redirect targets with credentials even in fixture mode", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/redirect-credentials`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false });
    expect(crawl.pages[0].error?.message).toContain("credentials");
  });

  it("production redirect safety blocks private and local targets", async () => {
    const privateTarget = ["10", "0", "0", "1"].join(".");
    const linkLocalTarget = ["169", "254", "1", "1"].join(".");
    await expect(assertSafeRedirectTarget("https://example.com/a", `http://${privateTarget}/x`)).rejects.toThrow(/blocked/i);
    await expect(assertSafeRedirectTarget("https://example.com/a", "http://[::1]/x")).rejects.toThrow(/blocked/i);
    await expect(assertSafeRedirectTarget("https://example.com/a", `http://${linkLocalTarget}/x`)).rejects.toThrow(/blocked/i);
  });

  it("production URL syntax blocks credentials", () => {
    expect(() => validateUrlSyntax("https://user:pass@example.com/")).toThrow(/credentials/);
  });

  it("filters binary resources by extension before fetching", async () => {
    const { baseUrl, requestCounts } = await start();
    const crawl = await crawlSite(baseUrl, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 1 });
    for (const path of ["/asset.jpg", "/asset.png", "/asset.svg", "/asset.webp", "/file.pdf", "/archive.zip", "/video.mp4", "/font.woff2", "/binary.exe"]) {
      expect(crawl.skipped.some((skip) => skip.normalizedUrl === `${baseUrl}${path}` && skip.reason === "non-html-resource")).toBe(true);
      expect(requestCounts.get(path) ?? 0).toBe(0);
    }
  });

  it("marks extensionless non-HTML endpoints as non-page errors", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/api-data`, { allowPrivateNetwork: true, render: "never", maxPages: 1, respectRobots: false });
    expect(crawl.pages[0].error?.code).toBe("non-html-content-type");
    expect(crawl.pages[0].contentType).toContain("application/json");
  });
});
