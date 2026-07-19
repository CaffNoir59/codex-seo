import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { performanceConfigSchema, performanceResultSchema, PERFORMANCE_SCHEMA_VERSION, type PerformanceResult } from "../../src/performance/performance-schema.js";
import { median, scoreFromLighthouse, varianceWarning } from "../../src/performance/performance-normalizer.js";
import { defaultPerformanceThresholds, performanceConfidence, scorePerformance } from "../../src/performance/performance-scoring.js";
import { readPerformanceCache, writePerformanceCache } from "../../src/performance/performance-cache.js";

function result(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url: "https://example.com/", source: "local", scope: "url", device: "mobile", collectedAt: "2026-07-17T00:00:00.000Z", metrics: { lcpMs: 1800, cls: 0.05, tbtMs: 80, ttfbMs: 300 }, resources: { requestCount: 10, transferBytes: 100000 }, scores: { performance: 90 }, warnings: [], ...overrides });
}

describe("performance schemas and scoring", () => {
  it("applies safe config defaults", () => {
    const config = performanceConfigSchema.parse({});
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe("local");
    expect(config.device).toBe("mobile");
  });

  it("accepts all configured modes and devices", () => {
    expect(performanceConfigSchema.parse({ enabled: true, mode: "all", device: "desktop" }).mode).toBe("all");
  });

  it("rejects impossible score values", () => {
    expect(() => result({ scores: { performance: 101 } })).toThrow();
  });

  it("keeps adapter errors non-fatal in the schema", () => {
    const parsed = result({ metrics: {}, error: { code: "x", message: "failed", retryable: true }, confidence: "low" });
    expect(parsed.error?.retryable).toBe(true);
  });

  it("scores explicit Lighthouse-like performance scores", () => {
    expect(scorePerformance(result({ scores: { performance: 74 } }))).toBe(74);
  });

  it("derives a score from local lab metrics when no score exists", () => {
    expect(scorePerformance(result({ scores: undefined, metrics: { lcpMs: 1000, cls: 0.01, tbtMs: 20, ttfbMs: 100 } }))).toBeGreaterThan(80);
  });

  it("penalizes slow LCP, TBT, CLS, and TTFB", () => {
    expect(scorePerformance(result({ scores: undefined, metrics: { lcpMs: 6000, cls: 0.4, tbtMs: 900, ttfbMs: 1800 } }))).toBeLessThan(60);
  });

  it("uses CrUX field data for confidence", () => {
    expect(performanceConfidence(result({ source: "crux", fieldData: { metrics: { LCP: { p75: 2000 } } } }))).toBe("high");
  });

  it("treats adapter errors as low confidence", () => {
    expect(performanceConfidence(result({ error: { code: "x", message: "x", retryable: true } }))).toBe("low");
  });

  it("marks repeated stable local runs as medium confidence", () => {
    expect(performanceConfidence(result({ runCount: 3, warnings: [] }))).toBe("medium");
  });

  it("converts Lighthouse fractional scores to whole scores", () => {
    expect(scoreFromLighthouse(0.92)).toBe(92);
  });

  it("keeps missing Lighthouse scores undefined", () => {
    expect(scoreFromLighthouse(null)).toBeUndefined();
  });

  it("computes medians for odd and even samples", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 3])).toBe(2);
  });

  it("returns undefined median for empty samples", () => {
    expect(median([])).toBeUndefined();
  });

  it("warns when metric variance is high", () => {
    expect(varianceWarning([1000, 1200, 5000], "lcpMs")).toContain("High variance");
  });

  it("does not warn for stable metric samples", () => {
    expect(varianceWarning([1000, 1050, 1100], "lcpMs")).toBeUndefined();
  });

  it("exports default threshold values", () => {
    expect(defaultPerformanceThresholds.lcpGoodMs).toBeGreaterThan(0);
  });

  it("writes and reads valid performance cache entries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "perf-cache-"));
    try {
      const key = { url: "https://example.com/", source: "local", device: "mobile", version: PERFORMANCE_SCHEMA_VERSION };
      await writePerformanceCache(dir, key, result());
      expect((await readPerformanceCache(dir, key, 10000))?.url).toBe("https://example.com/");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("ignores expired performance cache entries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "perf-cache-"));
    try {
      const key = { url: "https://example.com/", source: "local", device: "mobile", version: PERFORMANCE_SCHEMA_VERSION };
      await writePerformanceCache(dir, key, result());
      expect(await readPerformanceCache(dir, key, -1)).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("does not cache failed adapter results", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "perf-cache-"));
    try {
      const key = { url: "https://example.com/", source: "pagespeed", device: "mobile", version: PERFORMANCE_SCHEMA_VERSION };
      await writePerformanceCache(dir, key, result({ source: "pagespeed", metrics: {}, error: { code: "x", message: "x", retryable: true } }));
      expect(await readPerformanceCache(dir, key, 10000)).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});