import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLocalPerformance } from "../../src/performance/local/lighthouse-adapter.js";
import { startPerformanceFixtureServer, type PerformanceFixtureServer } from "../fixtures/performance-fixture-server.js";
import type { PerformanceResult } from "../../src/performance/performance-schema.js";

let fixture: PerformanceFixtureServer;
let light: PerformanceResult;
let heavy: PerformanceResult;

beforeAll(async () => {
  fixture = await startPerformanceFixtureServer();
  light = await runLocalPerformance(fixture.lightUrl, { device: "mobile", runs: 1, timeoutMs: 15000, allowPrivateNetwork: true });
  heavy = await runLocalPerformance(fixture.heavyUrl, { device: "mobile", runs: 1, timeoutMs: 15000, allowPrivateNetwork: true });
}, 60000);

afterAll(async () => { await fixture?.close(); });

describe("local Playwright performance adapter", () => {
  it("collects a local performance result without an external API", () => {
    expect(light.source).toBe("local");
    expect(light.error).toBeUndefined();
  });

  it("records final URL and device", () => {
    expect(light.finalUrl).toBe(fixture.lightUrl);
    expect(light.device).toBe("mobile");
  });

  it("collects timing metrics", () => {
    expect(light.metrics.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(light.metrics.speedIndexMs).toBeGreaterThanOrEqual(0);
  });

  it("collects resource counts and byte buckets", () => {
    expect(heavy.resources?.requestCount).toBeGreaterThan(light.resources?.requestCount ?? 0);
    expect(heavy.resources?.imageBytes).toBeGreaterThan(0);
  });

  it("collects JavaScript bytes", () => {
    expect(heavy.resources?.javascriptBytes).toBeGreaterThan(0);
  });

  it("computes a bounded approximate performance score", () => {
    expect(heavy.scores?.performance).toBeGreaterThanOrEqual(0);
    expect(heavy.scores?.performance).toBeLessThanOrEqual(100);
  });

  it("supports repeated runs and median aggregation", async () => {
    const result = await runLocalPerformance(fixture.lightUrl, { device: "desktop", runs: 3, timeoutMs: 15000, allowPrivateNetwork: true });
    expect(result.runCount).toBe(3);
    expect(result.runs).toHaveLength(3);
    expect(result.confidence).not.toBe("high");
  }, 60000);

  it("follows redirects and reports the final URL", async () => {
    const result = await runLocalPerformance(`${fixture.baseUrl}/redirect`, { device: "mobile", runs: 1, timeoutMs: 15000, allowPrivateNetwork: true });
    expect(result.finalUrl).toBe(fixture.lightUrl);
  }, 30000);

  it("returns non-fatal errors for blocked private-network URLs without allowance", async () => {
    const result = await runLocalPerformance(fixture.lightUrl, { device: "mobile", runs: 1, timeoutMs: 1000 });
    expect(result.error?.code).toBe("local-performance-error");
  }, 30000);

  it("can run multiple local audits sequentially without leaking browser state", async () => {
    const first = await runLocalPerformance(fixture.lightUrl, { device: "mobile", runs: 1, timeoutMs: 15000, allowPrivateNetwork: true });
    const second = await runLocalPerformance(fixture.lightUrl, { device: "mobile", runs: 1, timeoutMs: 15000, allowPrivateNetwork: true });
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
  }, 60000);
});