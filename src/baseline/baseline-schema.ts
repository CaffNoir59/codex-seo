import { z } from "zod";
import { seoCategories, seoSeverities } from "../core/issue.js";
import { performanceResultSchema } from "../performance/performance-schema.js";
import { gscAuditResultSchema } from "../gsc/gsc-schema.js";

export const BASELINE_SCHEMA_VERSION = "1.0.0";

export const baselinePageSchema = z.object({
  key: z.string().min(1),
  url: z.string().url(),
  finalUrl: z.string().url().optional(),
  requestedUrl: z.string().url().optional(),
  statusCode: z.number().int().optional(),
  indexable: z.boolean().optional(),
  followable: z.boolean().optional(),
  canonical: z.string().nullable().optional(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  h1: z.string().optional(),
  titleHash: z.string(),
  metaDescriptionHash: z.string(),
  h1Hash: z.string(),
  contentHash: z.string().optional(),
  contentSignature: z.array(z.string()).default([]),
  contentLength: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative().optional(),
  incomingInternalLinks: z.number().int().nonnegative(),
  outgoingInternalLinks: z.number().int().nonnegative(),
  pageScore: z.number().min(0).max(100),
  fromSitemap: z.boolean().default(false),
  errorCode: z.string().optional()
});

export const baselineIssueSchema = z.object({
  key: z.string().min(1),
  ruleId: z.string().min(1),
  category: z.enum(seoCategories),
  severity: z.enum(seoSeverities),
  affectedUrl: z.string().url().optional(),
  title: z.string().optional(),
  titleHash: z.string(),
  evidenceHash: z.string(),
  recommendationHash: z.string()
});

export const seoBaselineSchema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  baseline: z.object({
    name: z.string().min(1),
    createdAt: z.string(),
    sourceReportPath: z.string().optional(),
    startUrl: z.string().url(),
    normalizedOrigin: z.string().url(),
    auditMode: z.enum(["page", "sitewide"]),
    toolVersion: z.string()
  }),
  configuration: z.object({
    maxPages: z.number().int().optional(),
    maxDepth: z.number().int().optional(),
    renderMode: z.string().optional(),
    includeSubdomains: z.boolean().optional(),
    respectRobots: z.boolean().optional()
  }),
  snapshot: z.object({
    globalScore: z.number().min(0).max(100),
    categoryScores: z.record(z.string(), z.number().min(0).max(100)),
    pages: z.array(baselinePageSchema),
    issues: z.array(baselineIssueSchema),
    metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
    performance: z.array(performanceResultSchema).default([]),
    gsc: gscAuditResultSchema.optional()
  })
});

export type BaselinePage = z.infer<typeof baselinePageSchema>;
export type BaselineIssue = z.infer<typeof baselineIssueSchema>;
export type SeoBaseline = z.infer<typeof seoBaselineSchema>;

