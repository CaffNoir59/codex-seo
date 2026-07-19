import type { PerformanceResult } from "./performance-schema.js";
import { scorePerformance } from "./performance-scoring.js";

export type NumericStats = { min?: number; max?: number; mean?: number; median?: number };

export type PerformanceAggregation = {
  analyzedPages: number;
  eligiblePages: number;
  excludedPages: number;
  aggregationMethod: "mean-of-analyzed-results";
  score: NumericStats;
  lighthouseScore: NumericStats;
  internalScore: NumericStats;
  lcpMs: NumericStats;
  cls: NumericStats;
  inpMs: NumericStats;
  tbtMs: NumericStats;
  ttfbMs: NumericStats;
  transferBytes: NumericStats;
  requestCount: NumericStats;
};

function round(value: number): number {
  return Number(value.toFixed(3));
}

function stats(values: Array<number | undefined>): NumericStats {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  if (!clean.length) return {};
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return {
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    mean: round(clean.reduce((sum, value) => sum + value, 0) / clean.length),
    median: round(median)
  };
}

export function aggregatePerformance(results: PerformanceResult[], options: { eligiblePages?: number } = {}): PerformanceAggregation {
  const analyzedPages = results.filter((result) => !result.error).length;
  const eligiblePages = options.eligiblePages ?? analyzedPages;
  return {
    analyzedPages,
    eligiblePages,
    excludedPages: Math.max(0, eligiblePages - analyzedPages),
    aggregationMethod: "mean-of-analyzed-results",
    score: stats(results.map((item) => item.error ? undefined : scorePerformance(item))),
    lighthouseScore: stats(results.map((item) => item.error ? undefined : item.lighthousePerformanceScore)),
    internalScore: stats(results.map((item) => item.error ? undefined : item.internalPerformanceScore)),
    lcpMs: stats(results.map((item) => item.error ? undefined : item.metrics.lcpMs)),
    cls: stats(results.map((item) => item.error ? undefined : item.metrics.cls)),
    inpMs: stats(results.map((item) => item.error ? undefined : item.metrics.inpMs)),
    tbtMs: stats(results.map((item) => item.error ? undefined : item.metrics.tbtMs)),
    ttfbMs: stats(results.map((item) => item.error ? undefined : item.metrics.ttfbMs)),
    transferBytes: stats(results.map((item) => item.error ? undefined : item.resources?.transferBytes)),
    requestCount: stats(results.map((item) => item.error ? undefined : item.resources?.requestCount))
  };
}

