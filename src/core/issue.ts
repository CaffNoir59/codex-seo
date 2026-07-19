import { z } from "zod";

export const seoCategories = ["technical", "content", "schema", "sitemap", "images", "geo", "site-architecture", "internal-linking", "indexability", "duplicate-content", "performance", "gsc"] as const;
export const seoSeverities = ["info", "low", "medium", "high", "critical"] as const;

export const seoIssueSchema = z.object({
  id: z.string().min(1),
  category: z.enum(seoCategories),
  severity: z.enum(seoSeverities),
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.record(z.unknown()).optional(),
  recommendation: z.string().min(1),
  affectedUrl: z.string().url().optional()
});

export type SeoCategory = (typeof seoCategories)[number];
export type SeoSeverity = (typeof seoSeverities)[number];
export type SeoIssue = z.infer<typeof seoIssueSchema>;

export type AnalyzerResult = {
  category: SeoCategory;
  issues: SeoIssue[];
  summary: Record<string, unknown>;
  errors: string[];
};

export function issue(input: SeoIssue): SeoIssue {
  return seoIssueSchema.parse(input);
}

export function sortIssues(issues: SeoIssue[]): SeoIssue[] {
  const rank: Record<SeoSeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return [...issues].sort((a, b) => {
    const severityDelta = rank[b.severity] - rank[a.severity];
    if (severityDelta !== 0) return severityDelta;
    const categoryDelta = a.category.localeCompare(b.category);
    if (categoryDelta !== 0) return categoryDelta;
    return a.id.localeCompare(b.id);
  });
}

