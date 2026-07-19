import type { CrawledPage } from "../crawler/crawl-result.js";
import type { GscAuditResult, GscOpportunity, SeoPriority } from "../gsc/gsc-schema.js";

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }
export function priority(input: { impressions: number; clicks: number; severity: number; confidence: number; effort?: "low" | "medium" | "high" }): SeoPriority {
  const impactScore = clamp(Math.log10(input.impressions + input.clicks * 20 + 10) * 22);
  const severityScore = clamp(input.severity);
  const confidenceScore = clamp(input.confidence);
  const effortWeight = input.effort === "high" ? 0.85 : input.effort === "medium" ? 0.93 : 1;
  return { impactScore, severityScore, confidenceScore, effortEstimate: input.effort, priorityScore: clamp((impactScore * 0.45 + severityScore * 0.35 + confidenceScore * 0.2) * effortWeight) };
}

function expectedSiteCtr(audit: GscAuditResult): number {
  return audit.searchAnalytics?.totals.ctr ?? 0.02;
}

export function analyzeGscOpportunities(audit: GscAuditResult, pages: CrawledPage[] = []): GscOpportunity[] {
  const result = audit.searchAnalytics;
  if (!result) return [];
  const siteCtr = expectedSiteCtr(audit);
  const pageMap = new Map(pages.map((page) => [page.finalUrl, page]));
  const opportunities: GscOpportunity[] = [];
  const byQuery = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    if (row.keys.query) byQuery.set(row.keys.query, [...(byQuery.get(row.keys.query) ?? []), row]);
    const page = row.keys.page ? pageMap.get(row.keys.page) : undefined;
    const technicalCritical = Boolean(page?.statusCode && page.statusCode >= 400) || page?.robots?.indexable === false || Boolean(page?.canonical && page.canonical !== page.finalUrl);
    if (row.position >= 4 && row.position <= 15 && row.impressions >= 1000 && row.ctr < Math.max(0.015, siteCtr * 0.75)) {
      opportunities.push({ ruleId: "gsc.position-opportunity", type: "quick-win", page: row.keys.page, query: row.keys.query, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }, threshold: { position: "4-15", impressions: 1000, ctrBelow: Math.max(0.015, siteCtr * 0.75) }, confidence: "high", heuristic: true, recommendation: "Improve title, meta description and content alignment for this visible Google Search result.", priority: priority({ impressions: row.impressions, clicks: row.clicks, severity: 65, confidence: 85, effort: "medium" }) });
    }
    if (row.impressions >= 5000 && row.ctr < siteCtr * 0.5) {
      opportunities.push({ ruleId: "gsc.high-impressions-low-ctr", type: "low-ctr", page: row.keys.page, query: row.keys.query, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }, threshold: { siteCtr, ctrBelow: siteCtr * 0.5 }, confidence: "medium", heuristic: true, recommendation: "Review SERP snippet intent and compare against pages in a similar average-position band.", priority: priority({ impressions: row.impressions, clicks: row.clicks, severity: 55, confidence: 70, effort: "low" }) });
    }
    if (technicalCritical && row.impressions >= 1000) {
      opportunities.push({ ruleId: page?.robots?.indexable === false ? "gsc.traffic-page-not-indexable" : page?.statusCode && page.statusCode >= 400 ? "gsc.traffic-page-http-error" : "gsc.traffic-page-canonical-conflict", type: "risk", page: row.keys.page, query: row.keys.query, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }, threshold: { impressions: 1000 }, confidence: "high", heuristic: false, recommendation: "Fix indexability, HTTP status or canonical conflict on a page that still has Google Search visibility.", priority: priority({ impressions: row.impressions, clicks: row.clicks, severity: 92, confidence: 90, effort: "medium" }) });
    }
    if (page && page.depth >= 4 && row.impressions >= 5000) {
      opportunities.push({ ruleId: "gsc.traffic-page-deep", type: "internal-linking", page: row.keys.page, query: row.keys.query, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }, threshold: { depth: 4, impressions: 5000 }, confidence: "medium", heuristic: true, recommendation: "Improve internal linking for a visible page buried deeply in the crawl.", priority: priority({ impressions: row.impressions, clicks: row.clicks, severity: 50, confidence: 70, effort: "medium" }) });
    }
  }
  for (const [query, rows] of byQuery) {
    if (rows.length > 1 && rows.reduce((sum, row) => sum + row.impressions, 0) >= 5000) {
      const top = [...rows].sort((a, b) => b.impressions - a.impressions)[0];
      if (top) opportunities.push({ ruleId: "gsc.query-cannibalization", type: "potential-cannibalization", page: top.keys.page, query, metrics: { clicks: top.clicks, impressions: top.impressions, ctr: top.ctr, position: top.position }, threshold: { pages: rows.length, impressions: 5000 }, confidence: "low", heuristic: true, recommendation: "Review whether several pages answer the same query intent; treat this as a heuristic, not a diagnosis.", priority: priority({ impressions: rows.reduce((sum, row) => sum + row.impressions, 0), clicks: rows.reduce((sum, row) => sum + row.clicks, 0), severity: 45, confidence: 45, effort: "high" }) });
    }
  }
  return opportunities.sort((a, b) => b.priority.priorityScore - a.priority.priorityScore || a.ruleId.localeCompare(b.ruleId)).slice(0, 50);
}