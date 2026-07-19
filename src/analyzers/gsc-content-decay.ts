import type { GscPeriodComparison, GscOpportunity } from "../gsc/gsc-schema.js";
import { priority } from "./gsc-opportunities.js";

export function analyzeGscContentDecay(comparison?: GscPeriodComparison): GscOpportunity[] {
  if (!comparison || !comparison.compatible) return [];
  const items: GscOpportunity[] = [];
  for (const row of comparison.losingPages) {
    if (row.impressions < 1000) continue;
    items.push({ ruleId: "gsc.content-decay", type: "content-decay", page: row.keys.page, query: row.keys.query, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }, threshold: { minImpressions: 1000, significantDrop: 0.2 }, confidence: comparison.confidence, heuristic: true, recommendation: "Investigate content freshness, competing SERP intent and recent technical changes; this is an observed association, not proof of cause.", priority: priority({ impressions: row.impressions, clicks: row.clicks, severity: 70, confidence: comparison.confidence === "high" ? 85 : 55, effort: "medium" }) });
  }
  return items;
}