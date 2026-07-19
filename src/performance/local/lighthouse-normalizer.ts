import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceDevice, type PerformanceResult } from "../performance-schema.js";
import { scoreFromLighthouse } from "../performance-normalizer.js";
import { performanceConfidence, scorePerformance } from "../performance-scoring.js";

const opportunityIds = [
  "render-blocking-resources",
  "unused-javascript",
  "unused-css-rules",
  "modern-image-formats",
  "uses-optimized-images",
  "uses-responsive-images",
  "offscreen-images",
  "font-display",
  "third-party-summary",
  "long-tasks"
];

type Audit = { id?: string; title?: string; description?: string; score?: number | null; numericValue?: number; numericUnit?: string; details?: any };
type Lhr = { finalDisplayedUrl?: string; finalUrl?: string; requestedUrl?: string; lighthouseVersion?: string; userAgent?: string; fetchTime?: string; categories?: Record<string, { score?: number | null }>; audits?: Record<string, Audit>; configSettings?: Record<string, any>; environment?: Record<string, any> };

function audit(audits: Record<string, Audit> | undefined, id: string): Audit | undefined { return audits?.[id]; }
function numeric(audits: Record<string, Audit> | undefined, id: string): number | undefined { return audit(audits, id)?.numericValue; }
function whole(value: unknown): number | undefined { return typeof value === "number" ? Math.max(0, Math.round(value)) : undefined; }
function detailsItems(auditResult: Audit | undefined): any[] { return Array.isArray(auditResult?.details?.items) ? auditResult.details.items : []; }
function savingsBytes(item: Audit | undefined): number | undefined { return item?.details?.overallSavingsBytes ?? item?.details?.overallSavingsBytesWasted; }
function savingsMs(item: Audit | undefined): number | undefined { return item?.details?.overallSavingsMs; }

function resourceSummary(audits: Record<string, Audit> | undefined): PerformanceResult["resources"] {
  const summary = detailsItems(audit(audits, "resource-summary"));
  const byType = (type: string) => summary.find((item) => String(item.resourceType ?? "").toLowerCase() === type.toLowerCase());
  const diagnostics = audit(audits, "diagnostics")?.details?.items?.[0] ?? {};
  const networkRequests = detailsItems(audit(audits, "network-requests"));
  return {
    requestCount: whole(numeric(audits, "network-requests")) ?? (networkRequests.length || whole(diagnostics.numRequests)),
    transferBytes: whole(numeric(audits, "total-byte-weight")) ?? whole(diagnostics.totalByteWeight),
    javascriptBytes: whole(byType("script")?.transferSize),
    cssBytes: whole(byType("stylesheet")?.transferSize),
    imageBytes: whole(byType("image")?.transferSize),
    fontBytes: whole(byType("font")?.transferSize),
    thirdPartyBytes: whole(audit(audits, "third-party-summary")?.details?.summary?.wastedBytes)
  };
}

function diagnostics(audits: Record<string, Audit> | undefined): PerformanceResult["diagnostics"] {
  return {
    mainThreadWorkMs: numeric(audits, "mainthread-work-breakdown"),
    bootupTimeMs: numeric(audits, "bootup-time"),
    unusedJavascriptBytes: savingsBytes(audit(audits, "unused-javascript")),
    unusedCssBytes: savingsBytes(audit(audits, "unused-css-rules")),
    renderBlockingResources: detailsItems(audit(audits, "render-blocking-resources")).length,
    longTaskCount: detailsItems(audit(audits, "long-tasks")).length,
    thirdPartyTransferBytes: whole(audit(audits, "third-party-summary")?.details?.summary?.wastedBytes),
    thirdPartyMainThreadMs: whole(audit(audits, "third-party-summary")?.details?.summary?.wastedMs)
  };
}

function recommendation(id: string): string | undefined {
  if (id.includes("unused-javascript")) return "Reduce unused JavaScript with code splitting, tree shaking, defer, or removal.";
  if (id.includes("unused-css")) return "Purge unused CSS and inline only critical CSS where appropriate.";
  if (id.includes("render-blocking")) return "Preload critical resources, inline critical CSS, and defer non-critical blocking resources.";
  if (id.includes("image") || id.includes("offscreen")) return "Optimize image format, compression, dimensions, and lazy loading based on Lighthouse evidence.";
  if (id.includes("long-tasks")) return "Split long main-thread tasks and reduce expensive JavaScript execution.";
  if (id.includes("third-party")) return "Review third-party scripts for transfer weight and CPU cost.";
  if (id.includes("font-display")) return "Use font-display to reduce invisible text during font loading.";
  return undefined;
}

function opportunities(audits: Record<string, Audit> | undefined): PerformanceResult["opportunities"] {
  return opportunityIds.flatMap((id) => {
    const item = audit(audits, id);
    if (!item) return [];
    const estimatedSavingsMs = savingsMs(item);
    const estimatedSavingsBytes = savingsBytes(item);
    if (item.score === 1 && !estimatedSavingsMs && !estimatedSavingsBytes && !detailsItems(item).length) return [];
    return [{ id, title: item.title ?? id, description: item.description, score: item.score, numericValue: item.numericValue, numericUnit: item.numericUnit, estimatedSavingsMs, estimatedSavingsBytes, recommendation: recommendation(id) }];
  });
}

export function normalizeLighthouseResult(url: string, device: PerformanceDevice, lhr: Lhr): PerformanceResult {
  const audits = lhr.audits;
  const lighthousePerformanceScore = scoreFromLighthouse(lhr.categories?.performance?.score);
  const base = performanceResultSchema.parse({
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    url,
    finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl,
    source: "local",
    engine: "lighthouse",
    scoreKind: "official-lighthouse",
    executionEnvironment: "local",
    scope: "url",
    device,
    collectedAt: lhr.fetchTime ?? new Date().toISOString(),
    lighthousePerformanceScore,
    scores: {
      performance: lighthousePerformanceScore,
      accessibility: scoreFromLighthouse(lhr.categories?.accessibility?.score),
      bestPractices: scoreFromLighthouse(lhr.categories?.["best-practices"]?.score),
      seo: scoreFromLighthouse(lhr.categories?.seo?.score)
    },
    metrics: {
      fcpMs: numeric(audits, "first-contentful-paint"),
      lcpMs: numeric(audits, "largest-contentful-paint"),
      cls: numeric(audits, "cumulative-layout-shift"),
      tbtMs: numeric(audits, "total-blocking-time"),
      speedIndexMs: numeric(audits, "speed-index"),
      interactiveMs: numeric(audits, "interactive"),
      ttfbMs: numeric(audits, "server-response-time")
    },
    resources: resourceSummary(audits),
    diagnostics: diagnostics(audits),
    opportunities: opportunities(audits),
    lighthouse: {
      lighthouseVersion: lhr.lighthouseVersion ?? "unknown",
      chromeVersion: lhr.environment?.hostUserAgent,
      userAgent: lhr.userAgent,
      formFactor: device,
      throttlingMethod: lhr.configSettings?.throttlingMethod,
      locale: lhr.configSettings?.locale,
      engine: "lighthouse"
    },
    warnings: []
  });
  return { ...base, internalPerformanceScore: scorePerformance({ ...base, scores: undefined, lighthousePerformanceScore: undefined }), confidence: performanceConfidence(base) };
}