import { z } from "zod";
import { seoCategories, seoIssueSchema } from "../core/issue.js";
import { crawledPageSchema } from "../crawler/crawl-result.js";
import { performanceResultSchema } from "../performance/performance-schema.js";
import { gscAuditResultSchema } from "../gsc/gsc-schema.js";

const numericStatsSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  mean: z.number().optional(),
  median: z.number().optional()
});

const performanceAggregationSchema = z.object({
  analyzedPages: z.number().int().nonnegative(),
  eligiblePages: z.number().int().nonnegative(),
  excludedPages: z.number().int().nonnegative(),
  aggregationMethod: z.string(),
  score: numericStatsSchema,
  lighthouseScore: numericStatsSchema,
  internalScore: numericStatsSchema,
  lcpMs: numericStatsSchema,
  cls: numericStatsSchema,
  inpMs: numericStatsSchema,
  tbtMs: numericStatsSchema,
  ttfbMs: numericStatsSchema,
  transferBytes: numericStatsSchema,
  requestCount: numericStatsSchema
});

export const sitewideAuditReportSchema = z.object({
  audit: z.object({
    tool: z.literal("codex-seo").optional(),
    version: z.string().optional(),
    startUrl: z.string().url(),
    startedAt: z.string(),
    completedAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    configuration: z.record(z.string(), z.unknown())
  }),
  summary: z.object({
    score: z.number().min(0).max(100),
    crawledPages: z.number().int().nonnegative(),
    attemptedPages: z.number().int().nonnegative().optional(),
    fetchedPages: z.number().int().nonnegative().optional(),
    successfulPages: z.number().int().nonnegative().optional(),
    failedPages: z.number().int().nonnegative(),
    httpErrorPages: z.number().int().nonnegative().optional(),
    fetchFailurePages: z.number().int().nonnegative().optional(),
    renderFailurePages: z.number().int().nonnegative().optional(),
    reportEntries: z.number().int().nonnegative().optional(),
    discoveredUrls: z.number().int().nonnegative(),
    skippedUrls: z.number().int().nonnegative(),
    blockedByRobots: z.number().int().nonnegative()
  }),
  categoryScores: z.record(z.string(), z.number().min(0).max(100)),
  crawlStats: z.record(z.string(), z.unknown()),
  pages: z.array(crawledPageSchema),
  issues: z.array(seoIssueSchema),
  issueSummary: z.array(z.object({
    id: z.string(),
    title: z.string(),
    severity: z.string(),
    category: z.string(),
    count: z.number().int().nonnegative(),
    affectedPages: z.number().int().nonnegative(),
    examples: z.array(z.string()),
    siteShare: z.number()
  })).optional(),
  performance: z.array(performanceResultSchema).optional(),
  performanceAggregation: performanceAggregationSchema.optional(),
  gsc: gscAuditResultSchema.optional(),
  sitemap: z.object({
    discoveredSitemaps: z.array(z.string()),
    urls: z.array(z.string()),
    errors: z.array(z.string()),
    outsideDomain: z.array(z.string()),
    reliability: z.string().optional(),
    warnings: z.array(z.string()).optional()
  })
});

export type SitewideAuditReport = z.infer<typeof sitewideAuditReportSchema>;
export const sitewideCategories = seoCategories;

