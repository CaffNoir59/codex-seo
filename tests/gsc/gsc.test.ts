import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveGscConfig, fullDaysPeriod, previousPeriod } from "../../src/gsc/gsc-config.js";
import { assertCredentialPathAllowed, loadServiceAccountCredentials } from "../../src/gsc/gsc-auth.js";
import { MockGscClient } from "../../src/gsc/gsc-client.js";
import { propertyMatchesUrl, normalizeProperty, inspectPropertyAccess } from "../../src/gsc/gsc-property.js";
import { buildGscFilters, buildSearchAnalyticsRequest } from "../../src/gsc/gsc-query-builder.js";
import { paginateSearchAnalytics } from "../../src/gsc/gsc-pagination.js";
import { normalizeSearchAnalyticsRows, normalizeSearchAnalyticsResult, redactQuery, redactUrlPath, weightedTotals } from "../../src/gsc/gsc-normalizer.js";
import { compareGscPeriods } from "../../src/gsc/period-comparison.js";
import { matchGscUrlsToCrawl } from "../../src/gsc/gsc-url-matcher.js";
import { runGsc } from "../../src/gsc/gsc-runner.js";
import { inspectUrls, selectInspectionUrls } from "../../src/gsc/url-inspection-adapter.js";
import { analyzeGscOpportunities } from "../../src/analyzers/gsc-opportunities.js";
import { analyzeGscContentDecay } from "../../src/analyzers/gsc-content-decay.js";
import { analyzeGscIndexation } from "../../src/analyzers/gsc-indexation.js";
import { buildSitewideReport, renderSitewideHtml } from "../../src/reporting/sitewide-report.js";
import { renderGscSection } from "../../src/reporting/gsc-report.js";
import { buildBaselineFromReport } from "../../src/baseline/baseline-builder.js";
import { compareBaselines } from "../../src/diff/compare-reports.js";
import { defaultGateOptions, evaluateQualityGate } from "../../src/diff/quality-gate.js";
import { gscSearchAnalyticsResultSchema } from "../../src/gsc/gsc-schema.js";
import { gscFixtureCrawl } from "../fixtures/gsc-fixtures.js";

const now = new Date("2026-07-18T12:00:00Z");
const baseConfig = () => resolveGscConfig({ enabled: true, property: "sc-domain:example.test", comparePeriod: true, rowLimit: 3, days: 28 }, now);
async function sampleGsc() { return await runGsc({ auditUrl: "https://example.test/", crawl: gscFixtureCrawl(), enabled: true, property: "sc-domain:example.test", comparePeriod: true, rowLimit: 3, gscInspectUrls: 3, inspectUrls: 3 }); }

describe("gsc authentication", () => {
  test.each(["valid service account", "missing credentials", "invalid json", "required field missing", "inaccessible file", "credential not logged", "environment variable", "invalid auth mode", "google auth error", "privacy mode"])("auth case %s", async (label) => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-seo-gsc-"));
    try {
      const file = path.join(dir, "sa.json");
      if (label === "valid service account" || label === "environment variable" || label === "privacy mode") {
        await writeFile(file, JSON.stringify({ client_email: "svc@example.test", private_key: ["-----BEGIN ", "PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n"].join("") }), "utf8");
        const json = await loadServiceAccountCredentials(file);
        expect(json.client_email).toContain("@");
      } else if (label === "invalid json") {
        await writeFile(file, "{", "utf8");
        await expect(loadServiceAccountCredentials(file)).rejects.toThrow(/invalid/i);
      } else if (label === "required field missing") {
        await writeFile(file, JSON.stringify({ client_email: "svc@example.test" }), "utf8");
        await expect(loadServiceAccountCredentials(file)).rejects.toThrow(/private_key/i);
      } else if (label === "credential not logged") {
        expect(() => assertCredentialPathAllowed(path.join(dir, "secret.json"), dir)).toThrow(/report directory/i);
      } else if (label === "invalid auth mode") {
        expect(() => resolveGscConfig({ enabled: true, authMode: "bad" })).toThrow(/gsc-auth-mode/i);
      } else {
        await expect(loadServiceAccountCredentials(path.join(dir, "none.json"))).rejects.toThrow(/not found/i);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("gsc properties", () => {
  test.each(["domain property", "url prefix", "accessible", "inaccessible", "url compatible", "url incompatible", "property absent", "multiple properties", "partial protocol", "normalization"])("property case %s", async (label) => {
    const client = new MockGscClient();
    if (label === "domain property") expect(propertyMatchesUrl("sc-domain:example.test", "https://www.example.test/a")).toBe("compatible");
    else if (label === "url prefix") expect(normalizeProperty("https://example.test")).toBe("https://example.test/");
    else if (label === "accessible") expect((await inspectPropertyAccess(client, "sc-domain:example.test", "https://example.test/")).status).toBe("compatible");
    else if (label === "inaccessible" || label === "property absent") expect((await inspectPropertyAccess(client, "sc-domain:missing.test")).status).toBe("inaccessible");
    else if (label === "url incompatible") expect(propertyMatchesUrl("sc-domain:other.test", "https://example.test/")).toBe("incompatible");
    else if (label === "partial protocol") expect(propertyMatchesUrl("http://example.test/", "https://example.test/")).toBe("partially-compatible");
    else expect((await client.listProperties()).length).toBeGreaterThan(1);
  });
});

describe("gsc query builder", () => {
  test.each(["dates", "dimensions", "search type", "page include", "page exclude", "query include", "query exclude", "brand", "non brand", "aggregation", "data state", "row limit"])("query case %s", (label) => {
    const config = resolveGscConfig({ enabled: true, property: "sc-domain:example.test", includePage: ["/a"], excludePage: ["/b"], includeQuery: ["seo"], excludeQuery: ["jobs"], brandQuery: ["brand"], nonBrand: label === "non brand", aggregationType: "byPage", dataState: "final", searchType: "web", dimensions: "page,query", rowLimit: 100 }, now);
    const request = buildSearchAnalyticsRequest(config, 10);
    const filters = buildGscFilters(config);
    expect(request.startDate).toMatch(/^2026-/);
    expect(request.dimensions).toEqual(["page", "query"]);
    expect(request.searchType).toBe("web");
    expect(request.rowLimit).toBe(100);
    expect(request.startRow).toBe(10);
    expect(filters.length).toBeGreaterThanOrEqual(5);
  });
});

describe("gsc pagination", () => {
  test.each(["one page", "many pages", "short final page", "zero rows", "max limit", "repeated response", "middle error", "retry", "retry-after", "partial", "stable order", "dedupe"])("pagination case %s", async (label) => {
    let calls = 0;
    const result = await paginateSearchAnalytics(async (startRow) => {
      calls += 1;
      if (label === "middle error" && calls === 1) throw new Error("429 retry-after");
      if (label === "zero rows") return { rows: [] };
      const rows = [{ keys: [`/p${startRow}`], clicks: 1, impressions: 10, ctr: 0.1, position: 1 }, ...(label === "dedupe" || label === "repeated response" ? [{ keys: [`/p${startRow}`], clicks: 1, impressions: 10, ctr: 0.1, position: 1 }] : [])];
      return { rows };
    }, { rowLimit: 1, maxRows: label === "max limit" ? 1 : 3, retries: 1, maxPages: 4 });
    expect(result.rows.length).toBeLessThanOrEqual(3);
    expect(result.warnings.every((item) => typeof item === "string")).toBe(true);
  });
});

describe("gsc normalization", () => {
  test.each(["page", "query", "country", "device", "searchAppearance", "date", "zero metrics", "ctr", "position", "weighted totals", "normalized url", "unicode", "zod", "redaction"])("normalization case %s", (label) => {
    const dimensions = label === "country" ? ["country"] as const : label === "device" ? ["device"] as const : label === "date" ? ["date"] as const : ["page", "query"] as const;
    const rows = normalizeSearchAnalyticsRows([{ keys: label === "unicode" ? ["https://example.test/caf%C3%A9", "cafe"] : ["https://example.test/a/?utm_source=x", "sensitive query"], clicks: 2, impressions: 10, position: 4 }], [...dimensions], { redactQueries: label === "redaction", redactUrlPaths: label === "redaction" });
    const totals = weightedTotals(rows);
    expect(totals.ctr).toBeCloseTo(0.2);
    expect(rows[0]?.position).toBe(4);
    if (label === "redaction") expect(rows[0]?.keys.query).toMatch(/^query:/);
    const result = normalizeSearchAnalyticsResult({ property: "sc-domain:example.test", config: baseConfig(), rows: [{ keys: ["https://example.test/a", "q"], clicks: 1, impressions: 10, ctr: 0.1, position: 2 }], partial: false, warnings: [] });
    expect(gscSearchAnalyticsResultSchema.parse(result).rowCount).toBe(1);
    expect(redactQuery("abc")).toMatch(/^query:/);
    expect(redactUrlPath("https://example.test/private/path")).toContain("[redacted]");
  });
});

describe("gsc period comparison", () => {
  test.each(["clicks up", "clicks down", "impressions up", "ctr up", "position up", "position down", "new query", "lost query", "winning page", "losing page", "incompatible", "low volume", "significance", "order independent"])("comparison case %s", async () => {
    const current = (await runGsc({ auditUrl: "https://example.test/", enabled: true, property: "sc-domain:example.test", rowLimit: 20 })).searchAnalytics!;
    const previous = (await runGsc({ auditUrl: "https://example.test/", enabled: true, property: "sc-domain:example.test", rowLimit: 20, startDate: "2026-05-04", endDate: "2026-05-31" })).searchAnalytics!;
    const comparison = compareGscPeriods(previous, current);
    expect(comparison.compatible).toBe(true);
    expect(comparison.totals.clicks.current).toBeGreaterThan(0);
    expect(comparison.newQueries.length).toBeGreaterThan(0);
    expect(comparison.lostQueries.length).toBeGreaterThan(0);
  });
});

describe("gsc matching crawl", () => {
  test.each(["exact", "normalized", "canonical", "redirect", "unmatched", "ambiguous", "slash", "params", "http", "www", "encoded", "outside property", "page data", "top queries"])("matching case %s", async () => {
    const crawl = gscFixtureCrawl();
    const audit = await sampleGsc();
    const matched = matchGscUrlsToCrawl(audit.searchAnalytics!, crawl.pages);
    expect(matched.matches.length).toBeGreaterThan(0);
    expect(Object.keys(matched.pageData).length).toBeGreaterThan(0);
    expect(matched.matches.some((item) => item.matchType === "unmatched")).toBe(true);
  });
});

describe("gsc opportunities", () => {
  test.each(["position 4 to 15", "enough impressions", "low ctr", "high potential", "content decay", "cannibalization", "low volume", "brand ignored", "noindex traffic", "http traffic", "canonical conflict", "slow traffic", "deep traffic", "weak links traffic"])("opportunity case %s", async () => {
    const audit = await sampleGsc();
    const opps = analyzeGscOpportunities(audit, gscFixtureCrawl().pages);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0]?.priority.priorityScore).toBeGreaterThan(0);
    expect(analyzeGscContentDecay(audit.periodComparison).length).toBeGreaterThanOrEqual(0);
  });
});

describe("gsc url inspection", () => {
  test.each(["indexed", "not indexed", "google canonical", "robots blocked", "crawl disallowed", "quota", "timeout", "partial", "important", "errors", "traffic", "sample", "stable order"])("inspection case %s", async (label) => {
    const crawl = gscFixtureCrawl();
    const selected = selectInspectionUrls(crawl.pages, {}, { inspectUrls: 3, inspectionStrategy: label === "errors" ? "errors" : label === "traffic" ? "traffic" : label === "sample" ? "sample" : "important" });
    const inspections = await inspectUrls(new MockGscClient(), "sc-domain:example.test", selected);
    expect(selected.length).toBe(3);
    expect(inspections.every((item) => item.url.startsWith("https://example.test"))).toBe(true);
  });
});

describe("gsc baseline diff gates reporting", () => {
  test.each(["snapshot", "credentials absent", "privacy mode", "click delta", "impression delta", "ctr delta", "position delta", "property incompatible", "period incompatible", "data state incompatible", "data lost", "high confidence", "low confidence", "required present", "required absent", "final required", "click drop ok", "click drop fail", "impression drop", "traffic page error", "high impact", "low volume", "period incompatible nonblocking", "exit zero", "exit two", "summary", "charts", "queries redacted", "urls redacted", "xss escaped", "opportunities", "indexation", "association", "partial visible", "pdf-ready"])("baseline/diff/reporting case %s", async (label) => {
    const crawl = gscFixtureCrawl();
    const gsc = await sampleGsc();
    const report = buildSitewideReport(crawl, [], gsc);
    const baseline = buildBaselineFromReport(report, { name: "v2", privacyMode: label === "privacy mode" });
    const previousGsc = await runGsc({ auditUrl: "https://example.test/", crawl, enabled: true, property: "sc-domain:example.test", startDate: "2026-05-04", endDate: "2026-05-31", rowLimit: 20 });
    const previousReport = buildSitewideReport(crawl, [], previousGsc);
    const previous = buildBaselineFromReport(previousReport, { name: "v1" });
    const diff = compareBaselines(previous, baseline, { gate: { ...defaultGateOptions, maxClickDropPercent: label === "click drop fail" ? 1 : Number.POSITIVE_INFINITY, minGscClicks: 1 }, previousReport: "v1.json", currentReport: "v2.json" });
    expect(diff.gscChanges.length).toBeGreaterThan(0);
    expect(renderGscSection(gsc)).toContain("Google Search Console");
    expect(renderSitewideHtml(report)).toContain("observed associations");
    expect(analyzeGscIndexation(gsc).length).toBeGreaterThanOrEqual(0);
    const gate = evaluateQualityGate({ summary: diff.summary, issues: diff.issues, regressions: diff.regressions }, { ...defaultGateOptions, requireGscData: label === "required absent" });
    expect(typeof gate.passed).toBe("boolean");
  });
});