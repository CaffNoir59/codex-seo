import type { SeoBaseline } from "../baseline/baseline-schema.js";
import type { Improvement, IssueDiff, PageDiff } from "./diff-schema.js";

export function detectImprovements(previous: SeoBaseline, current: SeoBaseline, pages: { changed: PageDiff[] }, issues: { resolved: IssueDiff[]; changed: IssueDiff[] }): Improvement[] {
  const improvements: Improvement[] = [];
  const scoreDelta = current.snapshot.globalScore - previous.snapshot.globalScore;
  if (scoreDelta > 0) improvements.push({ id: "score.global-improved", category: "score", previousValue: previous.snapshot.globalScore, currentValue: current.snapshot.globalScore, explanation: `Global score improved by ${scoreDelta} points.`, recommendation: "Keep the changes that improved SEO health.", confidence: "high", ignored: false });
  for (const issue of issues.resolved) improvements.push({ id: `issue.resolved.${issue.ruleId}`, category: issue.category, affectedUrl: issue.affectedUrl, previousValue: issue.previousSeverity, currentValue: "resolved", explanation: `Issue resolved: ${issue.ruleId}.`, recommendation: "Verify the fix remains stable.", confidence: issue.confidence, ignored: issue.ignored, ignoredBy: issue.ignoredBy });
  for (const issue of issues.changed.filter((item) => item.changeType === "severityDecreased")) improvements.push({ id: `issue.severity-decreased.${issue.ruleId}`, category: issue.category, affectedUrl: issue.affectedUrl, previousValue: issue.previousSeverity, currentValue: issue.currentSeverity, explanation: `Issue severity decreased for ${issue.ruleId}.`, recommendation: "Continue reducing the remaining severity.", confidence: issue.confidence, ignored: issue.ignored, ignoredBy: issue.ignoredBy });
  for (const page of pages.changed) for (const change of page.changes) {
    if (change.field === "indexable" && change.previous === false && change.current === true) improvements.push({ id: `page.indexable.${page.key}`, category: "indexability", affectedUrl: page.url, previousValue: false, currentValue: true, explanation: "A page became indexable.", recommendation: "Confirm it belongs in the sitemap and internal linking.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
    if (change.field === "depth" && Number(change.previous) - Number(change.current) >= 1) improvements.push({ id: `page.depth-reduced.${page.key}`, category: "site-architecture", affectedUrl: page.url, previousValue: change.previous, currentValue: change.current, explanation: "A page moved closer to the homepage.", recommendation: "Keep the improved internal linking path.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
  }
  return improvements.sort((a, b) => a.id.localeCompare(b.id));
}

