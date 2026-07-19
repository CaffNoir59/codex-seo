import type { BaselineIssue, BaselinePage } from "../baseline/baseline-schema.js";

export type IgnoreOptions = {
  ignoredRules: string[];
  ignoredUrls: string[];
  ignoredCategories: string[];
};

export function emptyIgnoreOptions(): IgnoreOptions {
  return { ignoredRules: [], ignoredUrls: [], ignoredCategories: [] };
}

function matchesPattern(value: string | undefined, patterns: string[]): boolean {
  if (!value) return false;
  return patterns.some((pattern) => value.includes(pattern) || new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")).test(value));
}

export function ignoreReasonForPage(page: Pick<BaselinePage, "url" | "key">, options: IgnoreOptions): string | undefined {
  if (matchesPattern(page.url ?? page.key, options.ignoredUrls)) return "ignore-url";
  return undefined;
}

export function ignoreReasonForIssue(issue: Pick<BaselineIssue, "ruleId" | "category" | "affectedUrl">, options: IgnoreOptions): string | undefined {
  if (options.ignoredRules.includes(issue.ruleId)) return "ignore-rule";
  if (options.ignoredCategories.includes(issue.category)) return "ignore-category";
  if (matchesPattern(issue.affectedUrl, options.ignoredUrls)) return "ignore-url";
  return undefined;
}
