import { describe, expect, it } from "vitest";
import { normalizeLighthouseResult } from "../../src/performance/local/lighthouse-normalizer.js";
import { performanceResultSchema } from "../../src/performance/performance-schema.js";

function lhr(overrides: Record<string, unknown> = {}) {
  return {
    finalDisplayedUrl: "https://example.com/final",
    fetchTime: "2026-07-17T00:00:00.000Z",
    lighthouseVersion: "13.4.0",
    userAgent: "Chrome Test",
    environment: { hostUserAgent: "Chrome/130" },
    configSettings: { throttlingMethod: "simulate", locale: "en-US" },
    categories: { performance: { score: 0.76 }, accessibility: { score: 0.91 }, "best-practices": { score: 0.82 }, seo: { score: 0.99 } },
    audits: {
      "first-contentful-paint": { numericValue: 1000, numericUnit: "millisecond" },
      "largest-contentful-paint": { numericValue: 2500, numericUnit: "millisecond" },
      "cumulative-layout-shift": { numericValue: 0.12, numericUnit: "unitless" },
      "total-blocking-time": { numericValue: 300, numericUnit: "millisecond" },
      "speed-index": { numericValue: 2100, numericUnit: "millisecond" },
      interactive: { numericValue: 3500, numericUnit: "millisecond" },
      "server-response-time": { numericValue: 450, numericUnit: "millisecond" },
      "network-requests": { details: { items: [{ url: "a" }, { url: "b" }] } },
      "total-byte-weight": { numericValue: 500000 },
      "resource-summary": { details: { items: [{ resourceType: "script", transferSize: 120000 }, { resourceType: "stylesheet", transferSize: 30000 }, { resourceType: "image", transferSize: 200000 }, { resourceType: "font", transferSize: 20000 }] } },
      "bootup-time": { numericValue: 250 },
      "mainthread-work-breakdown": { numericValue: 900 },
      "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0, numericValue: 500, numericUnit: "millisecond", details: { overallSavingsMs: 500, items: [{ url: "style.css" }] } },
      "unused-javascript": { title: "Reduce unused JavaScript", score: 0.5, numericValue: 800, numericUnit: "millisecond", details: { overallSavingsBytes: 75000, items: [{ url: "app.js" }] } },
      "unused-css-rules": { title: "Reduce unused CSS", score: 0.6, details: { overallSavingsBytes: 25000, items: [{ url: "style.css" }] } },
      "third-party-summary": { title: "Reduce third-party impact", score: 0.4, details: { summary: { wastedBytes: 12345, wastedMs: 222 }, items: [{ entity: "Third" }] } },
      "long-tasks": { title: "Avoid long tasks", score: null, details: { items: [{ duration: 150 }, { duration: 90 }] } },
      diagnostics: { details: { items: [{ numRequests: 9, totalByteWeight: 500000 }] } }
    },
    ...overrides
  };
}

describe("official Lighthouse normalizer", () => {
  it("creates a valid normalized result", () => { expect(performanceResultSchema.parse(normalizeLighthouseResult("https://example.com/", "mobile", lhr())).engine).toBe("lighthouse"); });
  it("marks official Lighthouse score kind", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).scoreKind).toBe("official-lighthouse"); });
  it("normalizes performance score 0-1 to 0-100", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).lighthousePerformanceScore).toBe(76); });
  it("normalizes accessibility score", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).scores?.accessibility).toBe(91); });
  it("normalizes best practices score", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).scores?.bestPractices).toBe(82); });
  it("normalizes SEO score", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).scores?.seo).toBe(99); });
  it("keeps null score undefined", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr({ categories: { performance: { score: null } } })).scores?.performance).toBeUndefined(); });
  it("extracts FCP", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.fcpMs).toBe(1000); });
  it("extracts LCP", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.lcpMs).toBe(2500); });
  it("extracts CLS", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.cls).toBe(0.12); });
  it("extracts TBT", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.tbtMs).toBe(300); });
  it("extracts Speed Index", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.speedIndexMs).toBe(2100); });
  it("extracts TTI when available", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.interactiveMs).toBe(3500); });
  it("extracts TTFB", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).metrics.ttfbMs).toBe(450); });
  it("extracts resource bytes by type", () => { const r = normalizeLighthouseResult("https://example.com/", "mobile", lhr()); expect(r.resources?.javascriptBytes).toBe(120000); expect(r.resources?.cssBytes).toBe(30000); expect(r.resources?.imageBytes).toBe(200000); expect(r.resources?.fontBytes).toBe(20000); });
  it("extracts request count from details", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).resources?.requestCount).toBe(2); });
  it("extracts total transfer bytes", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).resources?.transferBytes).toBe(500000); });
  it("extracts main thread diagnostics", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).diagnostics?.mainThreadWorkMs).toBe(900); });
  it("extracts bootup diagnostics", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).diagnostics?.bootupTimeMs).toBe(250); });
  it("extracts unused JavaScript bytes", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).diagnostics?.unusedJavascriptBytes).toBe(75000); });
  it("extracts unused CSS bytes", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).diagnostics?.unusedCssBytes).toBe(25000); });
  it("extracts render blocking resource count", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).diagnostics?.renderBlockingResources).toBe(1); });
  it("extracts long task count", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).diagnostics?.longTaskCount).toBe(2); });
  it("extracts third-party diagnostics", () => { const r = normalizeLighthouseResult("https://example.com/", "mobile", lhr()); expect(r.diagnostics?.thirdPartyTransferBytes).toBe(12345); expect(r.diagnostics?.thirdPartyMainThreadMs).toBe(222); });
  it("creates structured opportunities", () => { expect(normalizeLighthouseResult("https://example.com/", "mobile", lhr()).opportunities?.some((item) => item.id === "unused-javascript")).toBe(true); });
  it("ignores unknown audits", () => { expect(() => normalizeLighthouseResult("https://example.com/", "mobile", lhr({ audits: { ...lhr().audits, unknown: { numericValue: 1 } } }))).not.toThrow(); });
  it("handles absent audits", () => { expect(normalizeLighthouseResult("https://example.com/", "desktop", lhr({ audits: {} })).metrics.lcpMs).toBeUndefined(); });
  it("stores execution metadata", () => { const r = normalizeLighthouseResult("https://example.com/", "desktop", lhr()); expect(r.lighthouse?.lighthouseVersion).toBe("13.4.0"); expect(r.lighthouse?.formFactor).toBe("desktop"); });
});