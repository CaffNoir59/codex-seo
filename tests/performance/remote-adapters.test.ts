import { describe, expect, it } from "vitest";
import { normalizeCrux } from "../../src/performance/crux/crux-normalizer.js";
import { runCrux } from "../../src/performance/crux/crux-adapter.js";
import { runPageSpeed } from "../../src/performance/pagespeed/pagespeed-adapter.js";
import { normalizePageSpeed } from "../../src/performance/pagespeed/pagespeed-normalizer.js";

const pageSpeedPayload = {
  loadingExperience: { collectionPeriod: { firstDate: "2026-06-01", lastDate: "2026-06-28" }, metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, distributions: [{ proportion: 0.8 }, { proportion: 0.15 }, { proportion: 0.05 }] } } },
  lighthouseResult: {
    finalUrl: "https://example.com/final",
    categories: { performance: { score: 0.88 }, accessibility: { score: 1 }, "best-practices": { score: 0.9 }, seo: { score: 0.95 } },
    audits: {
      "first-contentful-paint": { numericValue: 900 },
      "largest-contentful-paint": { numericValue: 2100 },
      "cumulative-layout-shift": { numericValue: 0.06 },
      "total-blocking-time": { numericValue: 120 },
      "speed-index": { numericValue: 1800 },
      interactive: { numericValue: 2600 },
      "server-response-time": { numericValue: 250 },
      "network-requests": { numericValue: 34 },
      "total-byte-weight": { numericValue: 450000 }
    }
  }
};

const cruxPayload = {
  record: {
    collectionPeriod: { firstDate: "2026-06-01", lastDate: "2026-06-28" },
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentiles: { p75: 2200 }, histogram: [{ density: 0.7 }, { density: 0.2 }, { density: 0.1 }] },
      INTERACTION_TO_NEXT_PAINT: { percentiles: { p75: 180 }, histogram: [{ density: 0.8 }, { density: 0.1 }, { density: 0.1 }] },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentiles: { p75: 0.05 }, histogram: [{ density: 0.9 }, { density: 0.07 }, { density: 0.03 }] },
      FIRST_CONTENTFUL_PAINT_MS: { percentiles: { p75: 1000 } },
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentiles: { p75: 300 } }
    }
  }
};

describe("PageSpeed and CrUX adapters", () => {
  it("normalizes PageSpeed lab and field data", () => {
    const result = normalizePageSpeed("https://example.com/", "mobile", pageSpeedPayload);
    expect(result.scores?.performance).toBe(88);
    expect(result.metrics.lcpMs).toBe(2100);
    expect(result.resources?.transferBytes).toBe(450000);
    expect(result.fieldData?.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.p75).toBe(2100);
  });

  it("falls back to origin field data warning when URL data is absent", () => {
    const result = normalizePageSpeed("https://example.com/", "desktop", { ...pageSpeedPayload, loadingExperience: undefined, originLoadingExperience: pageSpeedPayload.loadingExperience });
    expect(result.warnings).toContain("url-field-data-unavailable-origin-used");
  });

  it("emits field-data-unavailable when no PageSpeed field data exists", () => {
    const result = normalizePageSpeed("https://example.com/", "desktop", { lighthouseResult: pageSpeedPayload.lighthouseResult });
    expect(result.warnings).toContain("field-data-unavailable");
  });

  it("runs PageSpeed with a mock fetch implementation", async () => {
    let requested: URL | undefined;
    const result = await runPageSpeed("https://example.com/", { device: "mobile", timeoutMs: 1000, apiKey: "secret", fetchImpl: async (url) => { requested = url; return { status: 200, ok: true, json: async () => pageSpeedPayload }; } });
    expect(result.metrics.fcpMs).toBe(900);
    expect(requested?.searchParams.get("strategy")).toBe("mobile");
    expect(requested?.searchParams.get("key")).toBe("secret");
  });

  it("redacts PageSpeed API keys in errors", async () => {
    const result = await runPageSpeed("https://example.com/", { device: "mobile", timeoutMs: 1000, apiKey: "topsecret", fetchImpl: async () => { throw new Error("topsecret failed"); } });
    expect(result.error?.message).not.toContain("topsecret");
  });

  it("classifies PageSpeed quota errors", async () => {
    const result = await runPageSpeed("https://example.com/", { device: "mobile", timeoutMs: 1000, fetchImpl: async () => ({ status: 429, ok: false, json: async () => ({}) }) });
    expect(result.error?.code).toBe("pagespeed-quota");
  });

  it("normalizes CrUX URL-level field data", () => {
    const result = normalizeCrux("https://example.com/", "mobile", cruxPayload, "url");
    expect(result.source).toBe("crux");
    expect(result.scope).toBe("url");
    expect(result.metrics.inpMs).toBe(180);
    expect(result.confidence).toBe("high");
  });

  it("normalizes CrUX origin-level field data", () => {
    const result = normalizeCrux("https://example.com/page", "desktop", cruxPayload, "origin");
    expect(result.scope).toBe("origin");
    expect(result.metrics.ttfbMs).toBe(300);
  });

  it("runs CrUX URL query with PHONE form factor", async () => {
    const bodies: unknown[] = [];
    const result = await runCrux("https://example.com/", { device: "mobile", timeoutMs: 1000, fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return { status: 200, ok: true, json: async () => cruxPayload }; } });
    expect(result.scope).toBe("url");
    expect(bodies).toEqual([{ url: "https://example.com/", formFactor: "PHONE" }]);
  });

  it("falls back from missing CrUX URL data to origin data", async () => {
    const bodies: unknown[] = [];
    const result = await runCrux("https://example.com/path", { device: "desktop", timeoutMs: 1000, fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? { status: 404, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => cruxPayload }; } });
    expect(result.scope).toBe("origin");
    expect(bodies).toEqual([{ url: "https://example.com/path", formFactor: "DESKTOP" }, { origin: "https://example.com", formFactor: "DESKTOP" }]);
  });

  it("returns unavailable CrUX result after URL and origin misses", async () => {
    const result = await runCrux("https://example.com/path", { device: "desktop", timeoutMs: 1000, fetchImpl: async () => ({ status: 404, ok: false, json: async () => ({}) }) });
    expect(result.warnings).toContain("crux-data-unavailable");
  });

  it("redacts CrUX API keys in errors", async () => {
    const result = await runCrux("https://example.com/", { device: "mobile", timeoutMs: 1000, apiKey: "cruxsecret", fetchImpl: async () => { throw new Error("cruxsecret failed"); } });
    expect(result.error?.message).not.toContain("cruxsecret");
  });

  it("classifies CrUX quota failures as retryable errors", async () => {
    const result = await runCrux("https://example.com/", { device: "mobile", timeoutMs: 1000, fetchImpl: async () => ({ status: 429, ok: false, json: async () => ({}) }) });
    expect(result.error?.code).toBe("crux-error");
    expect(result.error?.retryable).toBe(true);
  });
});