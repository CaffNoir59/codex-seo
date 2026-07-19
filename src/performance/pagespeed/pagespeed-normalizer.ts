import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceDevice, type PerformanceResult } from "../performance-schema.js";
import { scoreFromLighthouse } from "../performance-normalizer.js";
import { performanceConfidence, scorePerformance } from "../performance-scoring.js";
import { pagespeedResponseSchema } from "./pagespeed-schema.js";

function metric(audits: Record<string, { numericValue?: number }> | undefined, key: string): number | undefined {
  return audits?.[key]?.numericValue;
}

function fieldData(raw: unknown): PerformanceResult["fieldData"] | undefined {
  const experience = raw as { metrics?: Record<string, { percentile?: number; distributions?: Array<{ proportion?: number }> }>; collectionPeriod?: { firstDate?: string; lastDate?: string } } | undefined;
  if (!experience?.metrics) return undefined;
  const metrics = Object.fromEntries(Object.entries(experience.metrics).map(([key, value]) => [key, { p75: value.percentile, good: value.distributions?.[0]?.proportion, needsImprovement: value.distributions?.[1]?.proportion, poor: value.distributions?.[2]?.proportion }]));
  return { period: experience.collectionPeriod, metrics };
}

export function normalizePageSpeed(url: string, device: PerformanceDevice, raw: unknown): PerformanceResult {
  const parsed = pagespeedResponseSchema.parse(raw);
  const audits = parsed.lighthouseResult?.audits;
  const result = performanceResultSchema.parse({
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    url,
    finalUrl: parsed.lighthouseResult?.finalUrl,
    source: "pagespeed",
    engine: "pagespeed",
    scoreKind: "official-lighthouse",
    executionEnvironment: "remote-google",
    scope: "url",
    device,
    collectedAt: new Date().toISOString(),
    scores: {
      performance: scoreFromLighthouse(parsed.lighthouseResult?.categories?.performance?.score),
      accessibility: scoreFromLighthouse(parsed.lighthouseResult?.categories?.accessibility?.score),
      bestPractices: scoreFromLighthouse(parsed.lighthouseResult?.categories?.["best-practices"]?.score),
      seo: scoreFromLighthouse(parsed.lighthouseResult?.categories?.seo?.score)
    },
    metrics: {
      fcpMs: metric(audits, "first-contentful-paint"),
      lcpMs: metric(audits, "largest-contentful-paint"),
      cls: metric(audits, "cumulative-layout-shift"),
      tbtMs: metric(audits, "total-blocking-time"),
      speedIndexMs: metric(audits, "speed-index"),
      interactiveMs: metric(audits, "interactive"),
      ttfbMs: metric(audits, "server-response-time")
    },
    resources: {
      requestCount: metric(audits, "network-requests"),
      transferBytes: metric(audits, "total-byte-weight"),
      javascriptBytes: metric(audits, "total-byte-weight")
    },
    fieldData: fieldData(parsed.loadingExperience) ?? fieldData(parsed.originLoadingExperience),
    warnings: parsed.loadingExperience ? [] : [parsed.originLoadingExperience ? "url-field-data-unavailable-origin-used" : "field-data-unavailable"]
  });
  return { ...result, internalPerformanceScore: scorePerformance({ ...result, scores: undefined, lighthousePerformanceScore: undefined }), confidence: performanceConfidence(result) };
}