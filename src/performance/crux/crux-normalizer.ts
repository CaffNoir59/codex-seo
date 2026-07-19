import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceDevice, type PerformanceResult } from "../performance-schema.js";
import { assessCoreWebVitals, performanceConfidence, scorePerformance } from "../performance-scoring.js";
import { cruxResponseSchema } from "./crux-schema.js";

export function normalizeCrux(url: string, device: PerformanceDevice, raw: unknown, scope: "url" | "origin"): PerformanceResult {
  const parsed = cruxResponseSchema.parse(raw);
  const rawMetrics = parsed.record?.metrics ?? {};
  const metrics = Object.fromEntries(Object.entries(rawMetrics).map(([key, value]) => [key, { p75: value.percentiles?.p75, good: value.histogram?.[0]?.density, needsImprovement: value.histogram?.[1]?.density, poor: value.histogram?.[2]?.density }]));
  const result = performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url, source: "crux", engine: "crux", scoreKind: "field-data", scope, device, collectedAt: new Date().toISOString(), metrics: { lcpMs: metrics.LARGEST_CONTENTFUL_PAINT_MS?.p75, inpMs: metrics.INTERACTION_TO_NEXT_PAINT?.p75, cls: metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.p75, fcpMs: metrics.FIRST_CONTENTFUL_PAINT_MS?.p75, ttfbMs: metrics.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.p75 }, fieldData: { period: parsed.record?.collectionPeriod, metrics }, warnings: Object.keys(metrics).length ? [] : ["crux-data-unavailable"] });
  return { ...result, fieldPerformanceScore: scorePerformance(result), coreWebVitalsAssessment: assessCoreWebVitals(result), confidence: performanceConfidence(result) };
}
