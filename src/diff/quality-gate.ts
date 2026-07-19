import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Regression, SeoDiffReport } from "./diff-schema.js";

export const diffConfigSchema = z.object({
  diff: z.object({
    failOnRegression: z.boolean().optional(),
    maxScoreDrop: z.number().nonnegative().optional(),
    maxNewCritical: z.number().int().nonnegative().optional(),
    maxNewHigh: z.number().int().nonnegative().optional(),
    maxBrokenLinksIncrease: z.number().int().nonnegative().optional(),
    minPerformanceScore: z.number().min(0).max(100).optional(),
    maxLcp: z.number().nonnegative().optional(),
    maxInp: z.number().nonnegative().optional(),
    maxCls: z.number().nonnegative().optional(),
    maxTbt: z.number().nonnegative().optional(),
    maxTtfb: z.number().nonnegative().optional(),
    maxPerformanceScoreDrop: z.number().nonnegative().optional(),
    maxLcpRegressionMs: z.number().nonnegative().optional(),
    maxClsRegression: z.number().nonnegative().optional(),
    requireOfficialLighthouse: z.boolean().optional(),
    requireFieldData: z.boolean().optional(),
    maxPerformanceVariance: z.number().nonnegative().optional(),
    maxUnusedJavascriptBytes: z.number().nonnegative().optional(),
    maxTotalTransferBytes: z.number().nonnegative().optional(),
    maxRequestCount: z.number().int().nonnegative().optional(),
    maxClickDropPercent: z.number().nonnegative().optional(),
    maxImpressionDropPercent: z.number().nonnegative().optional(),
    maxTrafficPagesWithErrors: z.number().int().nonnegative().optional(),
    maxHighImpactRegressions: z.number().int().nonnegative().optional(),
    minGscClicks: z.number().nonnegative().optional(),
    requireGscData: z.boolean().optional(),
    requireGscFinalData: z.boolean().optional(),
    ignoredRules: z.array(z.string()).optional(),
    ignoredUrls: z.array(z.string()).optional(),
    ignoredCategories: z.array(z.string()).optional()
  }).default({})
});

export type DiffGateOptions = {
  failOnRegression: boolean;
  maxScoreDrop: number;
  maxNewCritical: number;
  maxNewHigh: number;
  maxBrokenLinksIncrease: number;
  minPerformanceScore: number;
  maxLcp: number;
  maxInp: number;
  maxCls: number;
  maxTbt: number;
  maxTtfb: number;
  maxPerformanceScoreDrop: number;
  maxLcpRegressionMs: number;
  maxClsRegression: number;
  requireOfficialLighthouse: boolean;
  requireFieldData: boolean;
  maxPerformanceVariance: number;
  maxUnusedJavascriptBytes: number;
  maxTotalTransferBytes: number;
  maxRequestCount: number;
  maxClickDropPercent: number;
  maxImpressionDropPercent: number;
  maxTrafficPagesWithErrors: number;
  maxHighImpactRegressions: number;
  minGscClicks: number;
  requireGscData: boolean;
  requireGscFinalData: boolean;
  ignoredRules: string[];
  ignoredUrls: string[];
  ignoredCategories: string[];
  includeOnly?: string[];
  severityThreshold?: string;
  strictCompatibility?: boolean;
};

export const defaultGateOptions: DiffGateOptions = {
  failOnRegression: false,
  maxScoreDrop: Number.POSITIVE_INFINITY,
  maxNewCritical: Number.POSITIVE_INFINITY,
  maxNewHigh: Number.POSITIVE_INFINITY,
  maxBrokenLinksIncrease: Number.POSITIVE_INFINITY,
  minPerformanceScore: 0,
  maxLcp: Number.POSITIVE_INFINITY,
  maxInp: Number.POSITIVE_INFINITY,
  maxCls: Number.POSITIVE_INFINITY,
  maxTbt: Number.POSITIVE_INFINITY,
  maxTtfb: Number.POSITIVE_INFINITY,
  maxPerformanceScoreDrop: Number.POSITIVE_INFINITY,
  maxLcpRegressionMs: Number.POSITIVE_INFINITY,
  maxClsRegression: Number.POSITIVE_INFINITY,
  requireOfficialLighthouse: false,
  requireFieldData: false,
  maxPerformanceVariance: Number.POSITIVE_INFINITY,
  maxUnusedJavascriptBytes: Number.POSITIVE_INFINITY,
  maxTotalTransferBytes: Number.POSITIVE_INFINITY,
  maxRequestCount: Number.POSITIVE_INFINITY,
  maxClickDropPercent: Number.POSITIVE_INFINITY,
  maxImpressionDropPercent: Number.POSITIVE_INFINITY,
  maxTrafficPagesWithErrors: Number.POSITIVE_INFINITY,
  maxHighImpactRegressions: Number.POSITIVE_INFINITY,
  minGscClicks: 0,
  requireGscData: false,
  requireGscFinalData: false,
  ignoredRules: [],
  ignoredUrls: [],
  ignoredCategories: []
};

export async function loadDiffConfig(configPath = "codex-seo.config.json"): Promise<Partial<DiffGateOptions>> {
  try {
    const parsed = diffConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8"))).diff;
    return {
      failOnRegression: parsed.failOnRegression,
      maxScoreDrop: parsed.maxScoreDrop,
      maxNewCritical: parsed.maxNewCritical,
      maxNewHigh: parsed.maxNewHigh,
      maxBrokenLinksIncrease: parsed.maxBrokenLinksIncrease,
      minPerformanceScore: parsed.minPerformanceScore,
      maxLcp: parsed.maxLcp,
      maxInp: parsed.maxInp,
      maxCls: parsed.maxCls,
      maxTbt: parsed.maxTbt,
      maxTtfb: parsed.maxTtfb,
      maxPerformanceScoreDrop: parsed.maxPerformanceScoreDrop,
      maxLcpRegressionMs: parsed.maxLcpRegressionMs,
      maxClsRegression: parsed.maxClsRegression,
      requireOfficialLighthouse: parsed.requireOfficialLighthouse,
      requireFieldData: parsed.requireFieldData,
      maxPerformanceVariance: parsed.maxPerformanceVariance,
      maxUnusedJavascriptBytes: parsed.maxUnusedJavascriptBytes,
      maxTotalTransferBytes: parsed.maxTotalTransferBytes,
      maxRequestCount: parsed.maxRequestCount,
      maxClickDropPercent: parsed.maxClickDropPercent,
      maxImpressionDropPercent: parsed.maxImpressionDropPercent,
      maxTrafficPagesWithErrors: parsed.maxTrafficPagesWithErrors,
      maxHighImpactRegressions: parsed.maxHighImpactRegressions,
      minGscClicks: parsed.minGscClicks,
      requireGscData: parsed.requireGscData,
      requireGscFinalData: parsed.requireGscFinalData,
      ignoredRules: parsed.ignoredRules,
      ignoredUrls: parsed.ignoredUrls,
      ignoredCategories: parsed.ignoredCategories
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function mergeGateOptions(config: Partial<DiffGateOptions>, cli: Partial<DiffGateOptions>): DiffGateOptions {
  return {
    ...defaultGateOptions,
    ...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
    ...Object.fromEntries(Object.entries(cli).filter(([, value]) => value !== undefined))
  } as DiffGateOptions;
}

function active(regression: Regression): boolean {
  return !regression.ignored;
}

export function evaluateQualityGate(report: Pick<SeoDiffReport, "summary" | "issues" | "regressions">, options: DiffGateOptions): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const scoreDrop = Math.max(0, -report.summary.scoreDelta);
  const activeRegressions = report.regressions.filter(active);
  const newCritical = report.issues.introduced.filter((issue) => !issue.ignored && issue.severity === "critical").length;
  const newHigh = report.issues.introduced.filter((issue) => !issue.ignored && issue.severity === "high").length;
  const brokenLinkIncrease = activeRegressions.filter((item) => /broken|unseen-linked-targets/i.test(item.id)).length;
  const perfRegressions = activeRegressions.filter((item) => item.category === "performance");
  if (options.failOnRegression && activeRegressions.length > 0) reasons.push(`${activeRegressions.length} active SEO regression(s) detected`);
  if (scoreDrop > options.maxScoreDrop) reasons.push(`Global score dropped by ${scoreDrop} points, maximum allowed: ${options.maxScoreDrop}`);
  if (newCritical > options.maxNewCritical) reasons.push(`${newCritical} new critical issue(s) detected, maximum allowed: ${options.maxNewCritical}`);
  if (newHigh > options.maxNewHigh) reasons.push(`${newHigh} new high issue(s) detected, maximum allowed: ${options.maxNewHigh}`);
  if (brokenLinkIncrease > options.maxBrokenLinksIncrease) reasons.push(`Broken link regressions increased by ${brokenLinkIncrease}, maximum allowed: ${options.maxBrokenLinksIncrease}`);
  const numeric = (value: unknown): number | undefined => typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : undefined;
  const metricRegressions = (metric: string) => perfRegressions.filter((item) => item.id.includes(`.${metric}.`));
  if (metricRegressions("performanceScore").some((item) => (numeric(item.currentValue) ?? 100) < options.minPerformanceScore)) reasons.push(`Performance score below ${options.minPerformanceScore}`);
  if (metricRegressions("performanceScore").some((item) => (numeric(item.previousValue) ?? 0) - (numeric(item.currentValue) ?? 0) > options.maxPerformanceScoreDrop)) reasons.push(`Performance score drop exceeded ${options.maxPerformanceScoreDrop}`);
  if (metricRegressions("lcpMs").some((item) => (numeric(item.currentValue) ?? 0) > options.maxLcp)) reasons.push(`LCP exceeded ${options.maxLcp} ms`);
  if (metricRegressions("inpMs").some((item) => (numeric(item.currentValue) ?? 0) > options.maxInp)) reasons.push(`INP exceeded ${options.maxInp} ms`);
  if (metricRegressions("tbtMs").some((item) => (numeric(item.currentValue) ?? 0) > options.maxTbt)) reasons.push(`TBT exceeded ${options.maxTbt} ms`);
  if (metricRegressions("ttfbMs").some((item) => (numeric(item.currentValue) ?? 0) > options.maxTtfb)) reasons.push(`TTFB exceeded ${options.maxTtfb} ms`);
  if (metricRegressions("cls").some((item) => (numeric(item.currentValue) ?? 0) > options.maxCls)) reasons.push(`CLS exceeded ${options.maxCls}`);
  if (metricRegressions("lcpMs").some((item) => (numeric(item.currentValue) ?? 0) - (numeric(item.previousValue) ?? 0) > options.maxLcpRegressionMs)) reasons.push(`LCP regression exceeded ${options.maxLcpRegressionMs} ms`);
  if (metricRegressions("cls").some((item) => (numeric(item.currentValue) ?? 0) - (numeric(item.previousValue) ?? 0) > options.maxClsRegression)) reasons.push(`CLS regression exceeded ${options.maxClsRegression}`);
  if (options.requireOfficialLighthouse && perfRegressions.some((item) => /engine|scoreKind|result|performanceScore|lcpMs|cls|inpMs|tbtMs|ttfbMs|transferBytes|requestCount/.test(item.id) && String(item.currentValue).includes("internal-estimate"))) reasons.push("Official Lighthouse result is required but current performance data is an internal estimate");
  if (options.requireFieldData && perfRegressions.some((item) => item.id.includes("field-data-lost"))) reasons.push("Field data is required but missing");
  if (perfRegressions.some((item) => item.id.includes("coefficientOfVariation") && (numeric(item.currentValue) ?? 0) > options.maxPerformanceVariance)) reasons.push(`Performance variance exceeded ${options.maxPerformanceVariance}`);
  if (perfRegressions.some((item) => item.id.includes("unusedJavascriptBytes") && (numeric(item.currentValue) ?? 0) > options.maxUnusedJavascriptBytes)) reasons.push(`Unused JavaScript exceeded ${options.maxUnusedJavascriptBytes} bytes`);
  if (metricRegressions("transferBytes").some((item) => (numeric(item.currentValue) ?? 0) > options.maxTotalTransferBytes)) reasons.push(`Total transfer exceeded ${options.maxTotalTransferBytes} bytes`);
  if (metricRegressions("requestCount").some((item) => (numeric(item.currentValue) ?? 0) > options.maxRequestCount)) reasons.push(`Request count exceeded ${options.maxRequestCount}`);
  const gscRegressions = activeRegressions.filter((item) => item.category === "gsc");
  const gscClicksDrop = gscRegressions.find((item) => item.id === "gsc.clicks.drop");
  const gscImpressionDrop = gscRegressions.find((item) => item.id === "gsc.impressions.drop");
  const dropPercent = (item: Regression | undefined) => { const prev = numeric(item?.previousValue); const curr = numeric(item?.currentValue); return prev && prev >= options.minGscClicks && curr !== undefined ? ((prev - curr) / prev) * 100 : 0; };
  if (options.requireGscData && gscRegressions.some((item) => item.id === "gsc.data-lost")) reasons.push("GSC data is required but missing");
  if (dropPercent(gscClicksDrop) > options.maxClickDropPercent && (gscClicksDrop?.confidence ?? "low") !== "low") reasons.push(`GSC click drop exceeded ${options.maxClickDropPercent}%`);
  if (dropPercent(gscImpressionDrop) > options.maxImpressionDropPercent && (gscImpressionDrop?.confidence ?? "low") !== "low") reasons.push(`GSC impression drop exceeded ${options.maxImpressionDropPercent}%`);
  const trafficErrors = gscRegressions.filter((item) => /traffic-page-(http-error|not-indexable|canonical-conflict)/.test(item.id)).length;
  if (trafficErrors > options.maxTrafficPagesWithErrors) reasons.push(`Traffic pages with technical errors exceeded ${options.maxTrafficPagesWithErrors}`);
  const highImpact = gscRegressions.filter((item) => item.severity === "high" || item.severity === "critical").length;
  if (highImpact > options.maxHighImpactRegressions) reasons.push(`High-impact GSC regressions exceeded ${options.maxHighImpactRegressions}`);
  return { passed: reasons.length === 0, reasons };
}

