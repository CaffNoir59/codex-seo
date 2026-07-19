import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLocalPerformance } from "../../src/performance/local/lighthouse-adapter.js";
import { startPerformanceFixtureServer, type PerformanceFixtureServer } from "../fixtures/performance-fixture-server.js";

let fixture: PerformanceFixtureServer;
let fast: Awaited<ReturnType<typeof runLocalPerformance>>;
let medium: Awaited<ReturnType<typeof runLocalPerformance>>;
let slow: Awaited<ReturnType<typeof runLocalPerformance>>;
let verySlow: Awaited<ReturnType<typeof runLocalPerformance>>;

beforeAll(async () => {
  fixture = await startPerformanceFixtureServer();
  fast = await runLocalPerformance(fixture.fastUrl, { device: "mobile", runs: 1, timeoutMs: 90000, allowPrivateNetwork: true, localEngine: "lighthouse" });
  medium = await runLocalPerformance(fixture.mediumUrl, { device: "mobile", runs: 1, timeoutMs: 90000, allowPrivateNetwork: true, localEngine: "lighthouse" });
  slow = await runLocalPerformance(fixture.slowUrl, { device: "mobile", runs: 1, timeoutMs: 120000, allowPrivateNetwork: true, localEngine: "lighthouse" });
  verySlow = await runLocalPerformance(fixture.verySlowUrl, { device: "mobile", runs: 1, timeoutMs: 120000, allowPrivateNetwork: true, localEngine: "lighthouse" });
}, 360000);

afterAll(async () => { await fixture?.close(); });

describe("official Lighthouse integration calibration", () => {
  it("extracts an official Lighthouse score", () => { expect(fast.scoreKind).toBe("official-lighthouse"); expect(fast.lighthousePerformanceScore).toBeGreaterThan(0); });
  it("records Lighthouse version", () => { expect(fast.lighthouse?.lighthouseVersion).toMatch(/^\d+/); });
  it("keeps fast score above medium", () => { expect(fast.lighthousePerformanceScore ?? 0).toBeGreaterThan(medium.lighthousePerformanceScore ?? 0); });
  it("keeps medium score above slow", () => { expect(medium.lighthousePerformanceScore ?? 0).toBeGreaterThan(slow.lighthousePerformanceScore ?? 0); });
  it("keeps slow score above or equal very slow", () => { expect(slow.lighthousePerformanceScore ?? 0).toBeGreaterThanOrEqual(verySlow.lighthousePerformanceScore ?? 0); });
  it("keeps fast LCP lower than slow LCP", () => { expect(fast.metrics.lcpMs ?? 0).toBeLessThan(slow.metrics.lcpMs ?? Number.POSITIVE_INFINITY); });
  it("keeps fast TBT lower than slow TBT", () => { expect(fast.metrics.tbtMs ?? 0).toBeLessThan(slow.metrics.tbtMs ?? Number.POSITIVE_INFINITY); });
  it("keeps slow transfer weight above fast", () => { expect(slow.resources?.transferBytes ?? 0).toBeGreaterThan(fast.resources?.transferBytes ?? 0); });
  it("keeps very slow request count above fast", () => { expect(verySlow.resources?.requestCount ?? 0).toBeGreaterThan(fast.resources?.requestCount ?? 0); });
  it("detects opportunities on slow pages", () => { expect((slow.opportunities ?? []).length).toBeGreaterThan(0); });
  it("supports explicit Playwright fallback mode", async () => { const result = await runLocalPerformance(fixture.fastUrl, { device: "mobile", runs: 1, timeoutMs: 30000, allowPrivateNetwork: true, localEngine: "playwright" }); expect(result.scoreKind).toBe("internal-estimate"); });
  it("supports auto mode with official Lighthouse when available", async () => { const result = await runLocalPerformance(fixture.fastUrl, { device: "desktop", runs: 1, timeoutMs: 90000, allowPrivateNetwork: true, localEngine: "auto" }); expect(result.scoreKind).toBe("official-lighthouse"); }, 120000);
});