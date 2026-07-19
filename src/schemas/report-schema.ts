import { z } from "zod";
import { seoCategories, seoIssueSchema } from "../core/issue.js";
import { performanceResultSchema } from "../performance/performance-schema.js";
import { gscAuditResultSchema } from "../gsc/gsc-schema.js";

export const reportSchema = z.object({
  metadata: z.object({
    tool: z.literal("codex-seo"),
    version: z.string(),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    domain: z.string(),
    date: z.string(),
    durationMs: z.number().int().nonnegative(),
    rendered: z.boolean()
  }),
  scores: z.object({
    overall: z.number().min(0).max(100),
    categories: z.record(z.enum(seoCategories), z.number().min(0).max(100).nullable()),
    penalties: z.record(z.enum(seoCategories), z.number().nonnegative())
  }),
  issues: z.array(seoIssueSchema),
  summaries: z.record(z.string(), z.record(z.string(), z.unknown())),
  errors: z.array(z.object({
    module: z.string(),
    message: z.string()
  })),
  performance: z.array(performanceResultSchema).optional(),
  gsc: gscAuditResultSchema.optional(),
  execution: z.object({
    analyzersExecuted: z.array(z.enum(seoCategories)),
    analyzersSkipped: z.array(z.string()),
    redirects: z.array(z.string()),
    status: z.number().int(),
    headers: z.record(z.string(), z.string())
  })
});

export type SeoReport = z.infer<typeof reportSchema>;

