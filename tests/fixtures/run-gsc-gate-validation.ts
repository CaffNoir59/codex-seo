import { runGsc } from "../../src/gsc/gsc-runner.js";
import { evaluateQualityGate, defaultGateOptions } from "../../src/diff/quality-gate.js";
import { gscFixtureCrawl } from "./gsc-fixtures.js";

const crawl = gscFixtureCrawl();
const gsc = await runGsc({ auditUrl: "https://example.test/", crawl, enabled: true, property: "sc-domain:example.test", comparePeriod: true, inspectUrls: 3 });
const trafficErrorGate = evaluateQualityGate({ summary: { scoreDelta: 0 } as never, issues: { introduced: [] } as never, regressions: [{ id: "gsc.traffic-page-http-error", category: "gsc", severity: "high", affectedUrl: "https://example.test/error", previousValue: 0, currentValue: 1, explanation: "Traffic page has an HTTP error", recommendation: "Fix the HTTP error.", confidence: "high", ignored: false }] }, { ...defaultGateOptions, maxTrafficPagesWithErrors: 0 });
const weakConfidenceGate = evaluateQualityGate({ summary: { scoreDelta: 0 } as never, issues: { introduced: [] } as never, regressions: [{ id: "gsc.clicks.drop", category: "gsc", severity: "medium", previousValue: 1000, currentValue: 100, explanation: "Low confidence click drop", recommendation: "Review before failing.", confidence: "low", ignored: false }] }, { ...defaultGateOptions, maxClickDropPercent: 1, minGscClicks: 1 });
const privacy = await runGsc({ auditUrl: "https://example.test/", crawl, enabled: true, property: "sc-domain:example.test", privacyMode: true, redactQueries: true, redactUrlPaths: true });
console.log(JSON.stringify({
  trafficErrorGate,
  weakConfidenceGate,
  privacy: {
    query: privacy.searchAnalytics?.rows.find((row) => row.keys.query)?.keys.query,
    page: privacy.searchAnalytics?.rows.find((row) => row.keys.page)?.keys.page
  },
  inspections: gsc.inspections.map((item) => ({ url: item.url, verdict: item.verdict, coverageState: item.coverageState, googleCanonical: item.googleCanonical }))
}, null, 2));