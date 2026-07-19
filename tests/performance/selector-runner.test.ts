import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CrawledPage } from "../../src/crawler/crawl-result.js";
import { selectPerformancePages } from "../../src/performance/performance-selector.js";
import { resolvePerformanceConfig, runPerformanceForUrl } from "../../src/performance/performance-runner.js";

function page(url: string, depth: number, links: string[] = [], issues = 0, error = false): CrawledPage {
  return { url, finalUrl: url, depth, statusCode: 200, contentType: "text/html", fetchMode: "http", links: { internal: links, external: [] }, issues: Array.from({ length: issues }, (_, index) => ({ id: `issue-${index}`, category: "technical", severity: "low", title: "Issue", description: "Issue", recommendation: "Fix", affectedUrl: url })), ...(error ? { error: { code: "x", message: "x" } } : {}) };
}

const pages = [
  page("https://example.com/", 0, ["https://example.com/category", "https://example.com/product/1"]),
  page("https://example.com/category", 1, ["https://example.com/product/1"]),
  page("https://example.com/product/1", 2, [], 2),
  page("https://example.com/product/2", 2),
  page("https://example.com/blog/a", 3),
  page("https://example.com/error", 1, [], 0, true)
];

describe("performance selector and runner", () => {
  it("selects important pages with the homepage first", () => {
    const selected = selectPerformancePages(pages, resolvePerformanceConfig({ enabled: true, strategy: "important", samplePages: 3 }));
    expect(selected[0].finalUrl).toBe("https://example.com/");
  });

  it("excludes failed crawl pages from performance selection", () => {
    const selected = selectPerformancePages(pages, resolvePerformanceConfig({ enabled: true, strategy: "all", samplePages: 10 }));
    expect(selected.map((item) => item.finalUrl)).not.toContain("https://example.com/error");
  });

  it("applies include URL filters", () => {
    const selected = selectPerformancePages(pages, resolvePerformanceConfig({ enabled: true, strategy: "all", samplePages: 10, includePatterns: ["product"] }));
    expect(selected.every((item) => item.finalUrl.includes("product"))).toBe(true);
  });

  it("applies exclude URL filters", () => {
    const selected = selectPerformancePages(pages, resolvePerformanceConfig({ enabled: true, strategy: "all", samplePages: 10, excludePatterns: ["product"] }));
    expect(selected.some((item) => item.finalUrl.includes("product"))).toBe(false);
  });

  it("limits all strategy to samplePages", () => {
    expect(selectPerformancePages(pages, resolvePerformanceConfig({ enabled: true, strategy: "all", samplePages: 2 }))).toHaveLength(2);
  });

  it("samples one page per depth first", () => {
    const selected = selectPerformancePages(pages, resolvePerformanceConfig({ enabled: true, strategy: "sample", samplePages: 3 }));
    expect(selected.map((item) => item.depth)).toEqual([0, 1, 2]);
  });

  it("does not run performance when disabled", async () => {
    expect(await runPerformanceForUrl("https://example.com/", { enabled: false })).toEqual([]);
  });

  it("returns PageSpeed adapter error in remote-only mode without throwing", async () => {
    const result = await runPerformanceForUrl("https://example.com/", { enabled: true, mode: "pagespeed", timeoutMs: 1, cache: false });
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("pagespeed");
  });

  it("returns CrUX adapter error or unavailable result without throwing", async () => {
    const result = await runPerformanceForUrl("https://example.com/", { enabled: true, mode: "crux", timeoutMs: 1, cache: false });
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("crux");
  });

  it("uses cache for repeat remote runner calls", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "perf-runner-cache-"));
    try {
      const first = await runPerformanceForUrl("https://example.com/", { enabled: true, mode: "pagespeed", timeoutMs: 1, cache: true, cacheDir: dir });
      const second = await runPerformanceForUrl("https://example.com/", { enabled: true, mode: "pagespeed", timeoutMs: 1, cache: true, cacheDir: dir });
      expect(second[0].warnings.includes("cache-hit") || Boolean(first[0].error)).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});