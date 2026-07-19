import { z } from "zod";
import { seoCategories, seoSeverities } from "../core/issue.js";

export const DIFF_SCHEMA_VERSION = "1.0.0";
export const confidenceSchema = z.enum(["high", "medium", "low"]);

export const diffValueSchema = z.object({
  field: z.string(),
  previous: z.unknown().optional(),
  current: z.unknown().optional()
});

export const pageDiffSchema = z.object({
  key: z.string(),
  url: z.string().optional(),
  previousUrl: z.string().optional(),
  currentUrl: z.string().optional(),
  changeType: z.string(),
  changes: z.array(diffValueSchema).default([]),
  confidence: confidenceSchema,
  ignored: z.boolean().default(false),
  ignoredBy: z.string().optional()
});

export const issueDiffSchema = z.object({
  key: z.string(),
  ruleId: z.string(),
  category: z.enum(seoCategories),
  severity: z.enum(seoSeverities),
  previousSeverity: z.enum(seoSeverities).optional(),
  currentSeverity: z.enum(seoSeverities).optional(),
  affectedUrl: z.string().optional(),
  changeType: z.string(),
  confidence: confidenceSchema,
  ignored: z.boolean().default(false),
  ignoredBy: z.string().optional()
});


export const gscDiffSchema = z.object({
  key: z.string(),
  metric: z.string(),
  previous: z.number().optional(),
  current: z.number().optional(),
  delta: z.number().optional(),
  direction: z.enum(["improved", "regressed", "unchanged", "lost", "gained"]),
  confidence: confidenceSchema
});

export const performanceDiffSchema = z.object({
  key: z.string(),
  source: z.string(),
  device: z.string(),
  url: z.string(),
  metric: z.string(),
  previous: z.number().optional(),
  current: z.number().optional(),
  delta: z.number().optional(),
  threshold: z.number().optional(),
  direction: z.enum(["improved", "regressed", "unchanged", "lost", "gained"]),
  confidence: confidenceSchema,
  ignored: z.boolean().default(false)
});
export const regressionSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: z.enum(seoSeverities),
  affectedUrl: z.string().optional(),
  previousValue: z.unknown().optional(),
  currentValue: z.unknown().optional(),
  explanation: z.string(),
  recommendation: z.string(),
  confidence: confidenceSchema,
  ignored: z.boolean().default(false),
  ignoredBy: z.string().optional()
});

export const improvementSchema = z.object({
  id: z.string(),
  category: z.string(),
  affectedUrl: z.string().optional(),
  previousValue: z.unknown().optional(),
  currentValue: z.unknown().optional(),
  explanation: z.string(),
  recommendation: z.string(),
  confidence: confidenceSchema,
  ignored: z.boolean().default(false),
  ignoredBy: z.string().optional()
});

export const seoDiffReportSchema = z.object({
  schemaVersion: z.literal(DIFF_SCHEMA_VERSION),
  comparison: z.object({
    baselineName: z.string().optional(),
    previousReport: z.string(),
    currentReport: z.string(),
    generatedAt: z.string(),
    startUrl: z.string().url(),
    compatible: z.boolean(),
    compatibilityWarnings: z.array(z.string())
  }),
  summary: z.object({
    previousScore: z.number().min(0).max(100),
    currentScore: z.number().min(0).max(100),
    scoreDelta: z.number(),
    regressionCount: z.number().int().nonnegative(),
    improvementCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    pagesAdded: z.number().int().nonnegative(),
    pagesRemoved: z.number().int().nonnegative(),
    issuesIntroduced: z.number().int().nonnegative(),
    issuesResolved: z.number().int().nonnegative(),
    issuesPersisting: z.number().int().nonnegative()
  }),
  categoryChanges: z.record(z.string(), z.object({ previousScore: z.number(), currentScore: z.number(), delta: z.number() })),
  pages: z.object({
    added: z.array(pageDiffSchema),
    removed: z.array(pageDiffSchema),
    changed: z.array(pageDiffSchema),
    unchanged: z.array(pageDiffSchema).optional()
  }),
  issues: z.object({
    introduced: z.array(issueDiffSchema),
    resolved: z.array(issueDiffSchema),
    persisting: z.array(issueDiffSchema),
    changed: z.array(issueDiffSchema)
  }),
  performanceChanges: z.array(performanceDiffSchema).default([]),
  gscChanges: z.array(gscDiffSchema).default([]),
  regressions: z.array(regressionSchema),
  improvements: z.array(improvementSchema),
  ignoredChanges: z.array(z.union([pageDiffSchema, issueDiffSchema, regressionSchema, improvementSchema])).default([]),
  gate: z.object({ passed: z.boolean(), reasons: z.array(z.string()) }),
  scoreExplanation: z.object({
    previousScore: z.number(),
    currentScore: z.number(),
    delta: z.number(),
    categoryDeltas: z.record(z.string(), z.number()),
    repeatedIssueCap: z.string(),
    explanation: z.string()
  }),
  configuration: z.record(z.string(), z.unknown()).default({})
});

export type PageDiff = z.infer<typeof pageDiffSchema>;
export type IssueDiff = z.infer<typeof issueDiffSchema>;
export type GscDiffChange = z.infer<typeof gscDiffSchema>;
export type PerformanceDiff = z.infer<typeof performanceDiffSchema>;
export type Regression = z.infer<typeof regressionSchema>;
export type Improvement = z.infer<typeof improvementSchema>;
export type SeoDiffReport = z.infer<typeof seoDiffReportSchema>;

