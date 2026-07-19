import { z } from "zod";

export const GSC_SCHEMA_VERSION = "1.0.0";
export const gscSearchTypes = ["web", "image", "video", "news", "discover", "googleNews"] as const;
export const gscDimensions = ["query", "page", "country", "device", "searchAppearance", "date"] as const;
export const gscDataStates = ["final", "all", "hourly_all"] as const;
export const gscAggregationTypes = ["auto", "byPage", "byProperty"] as const;
export const gscAuthModes = ["service-account", "oauth"] as const;
export const gscMatchTypes = ["exact", "normalized", "canonical", "redirect", "unmatched", "ambiguous"] as const;
export const gscInspectionStrategies = ["important", "errors", "traffic", "sample"] as const;
export const gscConfidenceLevels = ["high", "medium", "low"] as const;

export const gscMetricDeltaSchema = z.object({
  previous: z.number(),
  current: z.number(),
  absoluteDelta: z.number(),
  relativeDelta: z.number().optional()
});

export const seoPrioritySchema = z.object({
  impactScore: z.number().min(0).max(100),
  severityScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  effortEstimate: z.enum(["low", "medium", "high"]).optional(),
  priorityScore: z.number().min(0).max(100)
});

export const gscErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });

export const gscRowKeysSchema = z.object({
  query: z.string().optional(),
  page: z.string().url().optional(),
  country: z.string().optional(),
  device: z.string().optional(),
  searchAppearance: z.string().optional(),
  date: z.string().optional()
});

export const gscSearchAnalyticsRowSchema = z.object({
  keys: gscRowKeysSchema,
  clicks: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  position: z.number().nonnegative()
});

export const gscTotalsSchema = z.object({
  clicks: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  weightedPosition: z.number().nonnegative().optional()
});

export const gscSearchAnalyticsResultSchema = z.object({
  schemaVersion: z.literal(GSC_SCHEMA_VERSION),
  property: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  searchType: z.enum(gscSearchTypes),
  dimensions: z.array(z.enum(gscDimensions)),
  dataState: z.enum(gscDataStates),
  aggregationType: z.enum(gscAggregationTypes).optional(),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(gscSearchAnalyticsRowSchema),
  totals: gscTotalsSchema,
  warnings: z.array(z.string()),
  partial: z.boolean(),
  fromCache: z.boolean().default(false),
  error: gscErrorSchema.optional()
});

export const gscPeriodSchema = z.object({ startDate: z.string(), endDate: z.string(), days: z.number().int().positive() });

export const gscPeriodComparisonSchema = z.object({
  currentPeriod: gscPeriodSchema,
  previousPeriod: gscPeriodSchema,
  compatible: z.boolean(),
  confidence: z.enum(gscConfidenceLevels),
  warnings: z.array(z.string()),
  totals: z.object({
    clicks: gscMetricDeltaSchema,
    impressions: gscMetricDeltaSchema,
    ctr: gscMetricDeltaSchema,
    position: gscMetricDeltaSchema
  }),
  winningPages: z.array(gscSearchAnalyticsRowSchema),
  losingPages: z.array(gscSearchAnalyticsRowSchema),
  winningQueries: z.array(gscSearchAnalyticsRowSchema),
  losingQueries: z.array(gscSearchAnalyticsRowSchema),
  newQueries: z.array(gscSearchAnalyticsRowSchema),
  lostQueries: z.array(gscSearchAnalyticsRowSchema)
});

export const gscUrlMatchSchema = z.object({
  rawGscUrl: z.string().url(),
  normalizedUrl: z.string().url(),
  matchedCrawlUrl: z.string().url().optional(),
  matchType: z.enum(gscMatchTypes)
});

export const gscPageAttachmentSchema = z.object({
  clicks: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  position: z.number().nonnegative(),
  topQueries: z.array(gscSearchAnalyticsRowSchema).optional(),
  matchType: z.enum(gscMatchTypes)
});

export const gscOpportunitySchema = z.object({
  ruleId: z.string(),
  type: z.string(),
  page: z.string().url().optional(),
  query: z.string().optional(),
  metrics: z.object({ clicks: z.number(), impressions: z.number(), ctr: z.number(), position: z.number() }),
  threshold: z.record(z.unknown()),
  confidence: z.enum(gscConfidenceLevels),
  heuristic: z.boolean(),
  recommendation: z.string(),
  priority: seoPrioritySchema
});

export const gscInspectionResultSchema = z.object({
  url: z.string().url(),
  verdict: z.string(),
  coverageState: z.string().optional(),
  indexingState: z.string().optional(),
  crawlAllowed: z.boolean().optional(),
  robotsTxtState: z.string().optional(),
  googleCanonical: z.string().url().optional(),
  userCanonical: z.string().url().optional(),
  lastCrawlTime: z.string().optional(),
  pageFetchState: z.string().optional(),
  mobileUsability: z.string().optional(),
  richResults: z.string().optional(),
  partial: z.boolean().default(false),
  error: gscErrorSchema.optional()
});

export const gscAuditResultSchema = z.object({
  schemaVersion: z.literal(GSC_SCHEMA_VERSION),
  enabled: z.boolean(),
  property: z.string().optional(),
  propertyCompatibility: z.enum(["compatible", "partially-compatible", "incompatible", "inaccessible", "not-checked"]).default("not-checked"),
  authMode: z.enum(gscAuthModes).optional(),
  privacyMode: z.boolean().default(false),
  source: z.enum(["api", "cache", "mock", "none"]).default("none"),
  searchAnalytics: gscSearchAnalyticsResultSchema.optional(),
  previousSearchAnalytics: gscSearchAnalyticsResultSchema.optional(),
  periodComparison: gscPeriodComparisonSchema.optional(),
  urlMatches: z.array(gscUrlMatchSchema).default([]),
  pageData: z.record(gscPageAttachmentSchema).default({}),
  inspections: z.array(gscInspectionResultSchema).default([]),
  opportunities: z.array(gscOpportunitySchema).default([]),
  score: z.number().min(0).max(100).optional(),
  warnings: z.array(z.string()).default([]),
  partial: z.boolean().default(false),
  error: gscErrorSchema.optional()
});

export type GscMetricDelta = z.infer<typeof gscMetricDeltaSchema>;
export type SeoPriority = z.infer<typeof seoPrioritySchema>;
export type GscSearchAnalyticsRow = z.infer<typeof gscSearchAnalyticsRowSchema>;
export type GscSearchAnalyticsResult = z.infer<typeof gscSearchAnalyticsResultSchema>;
export type GscPeriodComparison = z.infer<typeof gscPeriodComparisonSchema>;
export type GscUrlMatch = z.infer<typeof gscUrlMatchSchema>;
export type GscOpportunity = z.infer<typeof gscOpportunitySchema>;
export type GscInspectionResult = z.infer<typeof gscInspectionResultSchema>;
export type GscAuditResult = z.infer<typeof gscAuditResultSchema>;
export type GscDimension = (typeof gscDimensions)[number];
export type GscSearchType = (typeof gscSearchTypes)[number];
export type GscDataState = (typeof gscDataStates)[number];
export type GscAggregationType = (typeof gscAggregationTypes)[number];
export type GscAuthMode = (typeof gscAuthModes)[number];
export type GscInspectionStrategy = (typeof gscInspectionStrategies)[number];
export type GscConfidence = (typeof gscConfidenceLevels)[number];