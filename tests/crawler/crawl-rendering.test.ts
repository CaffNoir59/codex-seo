import { afterEach, describe, expect, it } from "vitest";
import { crawlSite } from "../../src/crawler/crawler.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
async function start() { fixture = await startFixtureServer({ robotsMode: "missing" }); return fixture; }
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("crawler JavaScript rendering", () => {
  it("render never does not see dynamic links", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/js`, { allowPrivateNetwork: true, render: "never", maxPages: 20, maxDepth: 1, respectRobots: false });
    expect(crawl.pages[0].fetchMode).toBe("http");
    expect(crawl.pages.some((page) => page.url === `${baseUrl}/js-target`)).toBe(false);
  });

  it("render always sees dynamic links", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/js`, { allowPrivateNetwork: true, render: "always", maxPages: 20, maxDepth: 1, respectRobots: false });
    expect(crawl.pages[0].fetchMode).toBe("browser");
    expect(crawl.pages.some((page) => page.url === `${baseUrl}/js-target`)).toBe(true);
  }, 15000);

  it("render auto switches to browser for an app shell", async () => {
    const { baseUrl } = await start();
    const crawl = await crawlSite(`${baseUrl}/js`, { allowPrivateNetwork: true, render: "auto", maxPages: 20, maxDepth: 1, respectRobots: false });
    expect(crawl.pages[0].fetchMode).toBe("browser");
    expect(crawl.pages.some((page) => page.url === `${baseUrl}/js-target`)).toBe(true);
  }, 15000);
});


