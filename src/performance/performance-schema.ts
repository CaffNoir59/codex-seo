import { z } from "zod";

export const PERFORMANCE_SCHEMA_VERSION = "1.0.0";
export const performanceSources = ["local", "pagespeed", "crux"] as const;
export const performanceEngines = ["lighthouse", "playwright", "pagespeed", "crux"] as const;
export const performanceScoreKinds = ["official-lighthouse", "internal-estimate", "field-data"] as const;
export const performanceExecutionEnvironments = ["local", "remote-google"] as const;
export const localPerformanceEngines = ["auto", "lighthouse", "playwright"] as const;
export const coreWebVitalsAssessments = ["passed", "failed", "insufficient-data"] as const;
export const performanceDevices = ["mobile", "desktop"] as const;
export const performanceModes = ["local", "pagespeed", "crux", "all"] as const;
export const performanceStrategies = ["important", "all", "sample"] as const;

export const performanceMetricSchema = z.object({
  fcpMs: z.number().nonnegative().optional(),
  lcpMs: z.number().nonnegative().optional(),
  cls: z.number().nonnegative().optional(),
  inpMs: z.number().nonnegative().optional(),
  tbtMs: z.number().nonnegative().optional(),
  speedIndexMs: z.number().nonnegative().optional(),
  ttfbMs: z.number().nonnegative().optional(),
  interactiveMs: z.number().nonnegative().optional()
});

export const performanceResourcesSchema = z.object({
  requestCount: z.number().int().nonnegative().optional(),
  transferBytes: z.number().int().nonnegative().optional(),
  javascriptBytes: z.number().int().nonnegative().optional(),
  cssBytes: z.number().int().nonnegative().optional(),
  imageBytes: z.number().int().nonnegative().optional(),
  fontBytes: z.number().int().nonnegative().optional(),
  thirdPartyBytes: z.number().int().nonnegative().optional()
});

export const performanceDiagnosticsSchema = z.object({
  mainThreadWorkMs: z.number().nonnegative().optional(),
  bootupTimeMs: z.number().nonnegative().optional(),
  unusedJavascriptBytes: z.number().nonnegative().optional(),
  unusedCssBytes: z.number().nonnegative().optional(),
  renderBlockingResources: z.number().int().nonnegative().optional(),
  longTaskCount: z.number().int().nonnegative().optional(),
  thirdPartyTransferBytes: z.number().nonnegative().optional(),
  thirdPartyMainThreadMs: z.number().nonnegative().optional()
});

export const performanceOpportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  score: z.number().nullable().optional(),
  numericValue: z.number().optional(),
  numericUnit: z.string().optional(),
  estimatedSavingsMs: z.number().optional(),
  estimatedSavingsBytes: z.number().optional(),
  recommendation: z.string().optional()
});

export const performanceStatisticsSchema = z.object({
  median: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  standardDeviation: z.number().optional(),
  coefficientOfVariation: z.number().optional(),
  iqr: z.number().optional()
});

export const lighthouseExecutionMetadataSchema = z.object({
  lighthouseVersion: z.string(),
  chromeVersion: z.string().optional(),
  userAgent: z.string().optional(),
  formFactor: z.enum(performanceDevices),
  throttlingMethod: z.string().optional(),
  locale: z.string().optional(),
  engine: z.literal("lighthouse")
});

export const performanceResultSchema = z.object({
  schemaVersion: z.literal(PERFORMANCE_SCHEMA_VERSION),
  url: z.string().url(),
  finalUrl: z.string().url().optional(),
  source: z.enum(performanceSources),
  engine: z.enum(performanceEngines).optional(),
  scoreKind: z.enum(performanceScoreKinds).optional(),
  executionEnvironment: z.enum(performanceExecutionEnvironments).optional(),
  scope: z.enum(["url", "origin"]),
  device: z.enum(performanceDevices),
  collectedAt: z.string(),
  runCount: z.number().int().positive().optional(),
  lighthousePerformanceScore: z.number().min(0).max(100).optional(),
  internalPerformanceScore: z.number().min(0).max(100).optional(),
  fieldPerformanceScore: z.number().min(0).max(100).optional(),
  seoGlobalScore: z.number().min(0).max(100).optional(),
  coreWebVitalsAssessment: z.enum(coreWebVitalsAssessments).optional(),
  scores: z.object({
    performance: z.number().min(0).max(100).optional(),
    accessibility: z.number().min(0).max(100).optional(),
    bestPractices: z.number().min(0).max(100).optional(),
    seo: z.number().min(0).max(100).optional()
  }).optional(),
  metrics: performanceMetricSchema,
  resources: performanceResourcesSchema.optional(),
  diagnostics: performanceDiagnosticsSchema.optional(),
  opportunities: z.array(performanceOpportunitySchema).optional(),
  statistics: performanceStatisticsSchema.optional(),
  lighthouse: lighthouseExecutionMetadataSchema.optional(),
  fieldData: z.object({
    period: z.object({ firstDate: z.string().optional(), lastDate: z.string().optional() }).optional(),
    metrics: z.record(z.string(), z.object({ p75: z.number().optional(), good: z.number().optional(), needsImprovement: z.number().optional(), poor: z.number().optional() })).optional()
  }).optional(),
  warnings: z.array(z.string()),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
  runs: z.array(z.object({ metrics: performanceMetricSchema, resources: performanceResourcesSchema.optional(), scores: z.record(z.string(), z.number()).optional(), engine: z.enum(performanceEngines).optional(), scoreKind: z.enum(performanceScoreKinds).optional(), diagnostics: performanceDiagnosticsSchema.optional(), opportunities: z.array(performanceOpportunitySchema).optional() })).optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium")
});

export const performanceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(performanceModes).default("local"),
  device: z.enum(performanceDevices).default("mobile"),
  runs: z.number().int().positive().max(5).default(1),
  concurrency: z.number().int().positive().max(4).default(1),
  timeoutMs: z.number().int().positive().default(60000),
  samplePages: z.number().int().positive().default(10),
  strategy: z.enum(performanceStrategies).default("important"),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  pagespeedApiKey: z.string().optional(),
  localEngine: z.enum(localPerformanceEngines).default("auto"),
  chromePath: z.string().optional(),
  requireOfficialLighthouse: z.boolean().default(false),
  requireFieldData: z.boolean().default(false),
  cache: z.boolean().default(true),
  cacheTtlMs: z.number().int().positive().default(86400000)
});

export type PerformanceResult = z.infer<typeof performanceResultSchema>;
export type PerformanceConfig = z.infer<typeof performanceConfigSchema>;
export type PerformanceMode = (typeof performanceModes)[number];
export type PerformanceDevice = (typeof performanceDevices)[number];
export type PerformanceEngine = (typeof performanceEngines)[number];
export type LocalPerformanceEngine = (typeof localPerformanceEngines)[number];