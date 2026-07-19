import type { HistoricalCompatibility, HistoryConfidence, HistoryEntry } from "../history/history-schema.js";
import { coefficientOfVariation, iqrOutliers } from "./trend-statistics.js";

export function trendConfidence(entries: HistoryEntry[], values: number[], compatibility: HistoricalCompatibility): HistoryConfidence {
  if (values.length < 2) return "insufficient-data";
  if (!compatibility.compatible) return "low";
  let score = values.length >= 6 ? 100 : values.length >= 3 ? 75 : 45;
  score -= entries.filter((entry) => !entry.completeness.complete).length * 10;
  score -= compatibility.level === "medium" ? 15 : compatibility.level === "low" ? 30 : 0;
  score -= coefficientOfVariation(values) > 0.35 ? 15 : 0;
  score -= iqrOutliers(values).length * 5;
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  return "low";
}