import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBaselineFromReport } from "../../src/baseline/baseline-builder.js";
import { saveBaseline, loadBaselineByName } from "../../src/baseline/baseline-storage.js";
import { crawlSite } from "../../src/crawler/crawler.js";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { compareBaselines } from "../../src/diff/compare-reports.js";
import { defaultGateOptions } from "../../src/diff/quality-gate.js";
import { writeDiffReport } from "../../src/reporting/diff-json-report.js";
import { buildSitewideReport } from "../../src/reporting/sitewide-report.js";
import { startDiffFixtureServer, type DiffFixtureServer } from "../fixtures/diff-site-server.js";

let fixture: DiffFixtureServer | undefined;
afterEach(async () => { clearRobotsCache(); await fixture?.close(); fixture = undefined; });

describe("diff fixture v1/v2 integration", () => {
  it("audits v1 and v2 and detects regressions plus improvements", async () => {
    fixture = await startDiffFixtureServer();
    const v1 = buildSitewideReport(await crawlSite(fixture.v1Url, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4, respectRobots: false }));
    const v2 = buildSitewideReport(await crawlSite(fixture.v2Url, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4, respectRobots: false }));
    const previous = buildBaselineFromReport(v1, { name: "test", createdAt: "v1" });
    const current = buildBaselineFromReport(v2, { name: "current", createdAt: "v2" });
    const diff = compareBaselines(previous, current, { baselineName: "test", gate: { ...defaultGateOptions, failOnRegression: true, maxNewHigh: 0 } });
    expect(diff.summary.pagesAdded).toBeGreaterThan(0);
    expect(diff.summary.pagesRemoved).toBeGreaterThan(0);
    expect(diff.regressions.length).toBeGreaterThan(0);
    expect(diff.improvements.length).toBeGreaterThan(0);
    expect(diff.gate.passed).toBe(false);
  }, 20000);

  it("stores and reloads the v1 baseline before comparing v2", async () => {
    fixture = await startDiffFixtureServer();
    const dir = await mkdtemp(path.join(os.tmpdir(), "diff-baseline-"));
    try {
      const v1 = buildSitewideReport(await crawlSite(fixture.v1Url, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4, respectRobots: false }));
      const v2 = buildSitewideReport(await crawlSite(fixture.v2Url, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4, respectRobots: false }));
      await saveBaseline(buildBaselineFromReport(v1, { name: "test" }), { baselineDir: dir });
      const loaded = await loadBaselineByName(dir, v1.audit.startUrl, "test");
      const diff = compareBaselines(loaded.baseline, buildBaselineFromReport(v2, { name: "current" }), { baselineName: "test", gate: defaultGateOptions });
      expect(diff.comparison.baselineName).toBe("test");
      expect(diff.summary.currentScore).toBe(v2.summary.score);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20000);

  it("writes a fixture diff report", async () => {
    fixture = await startDiffFixtureServer();
    const dir = await mkdtemp(path.join(os.tmpdir(), "diff-fixture-"));
    try {
      const v1 = buildSitewideReport(await crawlSite(fixture.v1Url, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4, respectRobots: false }));
      const v2 = buildSitewideReport(await crawlSite(fixture.v2Url, { allowPrivateNetwork: true, render: "never", maxPages: 50, maxDepth: 4, respectRobots: false }));
      const diff = compareBaselines(buildBaselineFromReport(v1, { name: "test" }), buildBaselineFromReport(v2, { name: "current" }), { gate: defaultGateOptions });
      const files = await writeDiffReport(diff, dir, { html: true });
      expect(files.map((file) => path.basename(file))).toEqual(["diff-report.json", "diff-report.html"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20000);
});
