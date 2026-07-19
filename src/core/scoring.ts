import { seoCategories, type SeoCategory, type SeoIssue, type SeoSeverity } from "./issue.js";

const severityCost: Record<SeoSeverity, number> = {
  info: 0,
  low: 3,
  medium: 8,
  high: 15,
  critical: 25
};

export type ScoreSet = {
  overall: number;
  categories: Record<SeoCategory, number | null>;
  penalties: Record<SeoCategory, number>;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreIssues(issues: SeoIssue[], executedCategories: SeoCategory[]): ScoreSet {
  const categories = Object.fromEntries(seoCategories.map((category) => [category, null])) as Record<SeoCategory, number | null>;
  const penalties = Object.fromEntries(seoCategories.map((category) => [category, 0])) as Record<SeoCategory, number>;
  const executed = [...new Set(executedCategories)].sort() as SeoCategory[];

  for (const issue of issues) {
    penalties[issue.category] += severityCost[issue.severity];
  }
  for (const category of executed) {
    categories[category] = clampScore(100 - penalties[category]);
  }
  const concreteScores = executed.map((category) => categories[category]).filter((score): score is number => score !== null);
  const overall = concreteScores.length === 0
    ? 0
    : clampScore(concreteScores.reduce((sum, score) => sum + score, 0) / concreteScores.length);
  return { overall, categories, penalties };
}
