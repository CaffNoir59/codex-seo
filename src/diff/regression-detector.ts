import type { SeoBaseline } from "../baseline/baseline-schema.js";
import type { IssueDiff, PageDiff, Regression } from "./diff-schema.js";

function severityForIssue(severity: string): "info" | "low" | "medium" | "high" | "critical" {
  return severity === "critical" || severity === "high" || severity === "medium" || severity === "low" ? severity : "info";
}

export function detectRegressions(previous: SeoBaseline, current: SeoBaseline, pages: { added: PageDiff[]; removed: PageDiff[]; changed: PageDiff[] }, issues: { introduced: IssueDiff[]; changed: IssueDiff[] }, incomplete: boolean): Regression[] {
  const regressions: Regression[] = [];
  const confidence = incomplete ? "low" : "high";
  const scoreDelta = current.snapshot.globalScore - previous.snapshot.globalScore;
  if (scoreDelta < 0) regressions.push({ id: "score.global-drop", category: "score", severity: scoreDelta <= -10 ? "high" : "medium", previousValue: previous.snapshot.globalScore, currentValue: current.snapshot.globalScore, explanation: `Global score dropped by ${Math.abs(scoreDelta)} points.`, recommendation: "Review introduced issues and changed pages before deployment.", confidence, ignored: false });
  for (const [category, prevScore] of Object.entries(previous.snapshot.categoryScores)) {
    const currScore = current.snapshot.categoryScores[category] ?? prevScore;
    if (currScore < prevScore) regressions.push({ id: `score.category-drop.${category}`, category, severity: prevScore - currScore >= 10 ? "high" : "medium", previousValue: prevScore, currentValue: currScore, explanation: `${category} score dropped by ${prevScore - currScore} points.`, recommendation: "Inspect category-specific regressions.", confidence, ignored: false });
  }
  for (const issue of issues.introduced.filter((item) => ["high", "critical"].includes(item.severity))) regressions.push({ id: `issue.new.${issue.ruleId}`, category: issue.category, severity: severityForIssue(issue.severity), affectedUrl: issue.affectedUrl, currentValue: issue.severity, explanation: `New ${issue.severity} issue introduced: ${issue.ruleId}.`, recommendation: "Fix or explicitly ignore this issue if intentional.", confidence: issue.confidence, ignored: issue.ignored, ignoredBy: issue.ignoredBy });
  for (const issue of issues.changed.filter((item) => item.changeType === "severityIncreased")) regressions.push({ id: `issue.severity-increased.${issue.ruleId}`, category: issue.category, severity: severityForIssue(issue.currentSeverity ?? issue.severity), affectedUrl: issue.affectedUrl, previousValue: issue.previousSeverity, currentValue: issue.currentSeverity, explanation: `Issue severity increased for ${issue.ruleId}.`, recommendation: "Prioritize the affected URL or rule.", confidence: issue.confidence, ignored: issue.ignored, ignoredBy: issue.ignoredBy });
  for (const page of pages.removed) regressions.push({ id: `page.removed.${page.key}`, category: "indexability", severity: page.confidence === "low" ? "medium" : "high", affectedUrl: page.previousUrl, previousValue: "present", currentValue: "missing", explanation: "A previously crawled page is missing from the current snapshot.", recommendation: "Confirm whether the removal is intentional, especially for indexable pages.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
  for (const page of pages.changed) {
    for (const change of page.changes) {
      if (change.field === "statusCode" && Number(change.previous) < 400 && Number(change.current) >= 400) regressions.push({ id: `page.status-error.${page.key}`, category: "technical", severity: "high", affectedUrl: page.url, previousValue: change.previous, currentValue: change.current, explanation: "A page changed from a successful status to an HTTP error.", recommendation: "Restore the page or redirect it to a relevant live URL.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
      if (change.field === "indexable" && change.previous === true && change.current === false) regressions.push({ id: `page.noindex.${page.key}`, category: "indexability", severity: "high", affectedUrl: page.url, previousValue: true, currentValue: false, explanation: "A previously indexable page became non-indexable.", recommendation: "Remove noindex unless intentional.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
      if (["canonical", "titleHash", "h1Hash"].includes(change.field) && (change.current === undefined || change.current === "" || change.current === null)) regressions.push({ id: `page.missing-${change.field}.${page.key}`, category: "content", severity: "medium", affectedUrl: page.url, previousValue: change.previous, currentValue: change.current, explanation: `${change.field} disappeared from the page.`, recommendation: "Restore the missing metadata if the page is important.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
      if (change.field === "depth" && Number(change.current) - Number(change.previous) >= 2) regressions.push({ id: `page.depth-increased.${page.key}`, category: "site-architecture", severity: "medium", affectedUrl: page.url, previousValue: change.previous, currentValue: change.current, explanation: "A page became significantly deeper in the crawl graph.", recommendation: "Add internal links from closer hub pages.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
      if (change.field === "contentHash") regressions.push({ id: `page.content-changed.${page.key}`, category: "content", severity: "low", affectedUrl: page.url, previousValue: "changed", currentValue: "changed", explanation: "Main content fingerprint changed.", recommendation: "Review whether the content change is intentional.", confidence: page.confidence, ignored: page.ignored, ignoredBy: page.ignoredBy });
    }
  }
  return regressions.sort((a, b) => a.id.localeCompare(b.id));
}

