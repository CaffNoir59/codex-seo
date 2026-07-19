import type { ProjectConfig } from "../project/config.js";

export type RegressionFinding = { code: string; severe: boolean; message: string; before?: number; after?: number };
export type RegressionEvaluation = { passed: boolean; rollbackRequired: boolean; scoreDelta?: number; findings: RegressionFinding[] };

type ReportLike = {
  summary?: { score?: number; failedPages?: number };
  scores?: { overall?: number };
  issues?: Array<{ severity?: string; ruleId?: string; id?: string }>;
  sitewideIssues?: Array<{ severity?: string; ruleId?: string; id?: string }>;
  pages?: Array<{ status?: number; issues?: Array<{ severity?: string; ruleId?: string; id?: string }> }>;
};

function score(report: ReportLike): number | undefined {
  return report.summary?.score ?? report.scores?.overall;
}

function issues(report: ReportLike): Array<{ severity?: string; ruleId?: string; id?: string }> {
  return [...(report.issues ?? []), ...(report.sitewideIssues ?? []), ...(report.pages ?? []).flatMap((page) => page.issues ?? [])];
}

export function evaluateRegression(before: unknown, after: unknown, config: ProjectConfig): RegressionEvaluation {
  const previous = (before ?? {}) as ReportLike;
  const current = (after ?? {}) as ReportLike;
  const policy = config.deployment.regressionPolicy;
  const findings: RegressionFinding[] = [];
  const previousScore = score(previous);
  const currentScore = score(current);
  const scoreDelta = previousScore !== undefined && currentScore !== undefined ? currentScore - previousScore : undefined;
  if (scoreDelta !== undefined && scoreDelta < policy.minimumScoreDelta) {
    findings.push({ code: "regression.score", severe: true, message: "SEO score dropped beyond the configured threshold", before: previousScore, after: currentScore });
  }
  const oldCritical = issues(previous).filter((issue) => issue.severity === "critical").length;
  const newCritical = issues(current).filter((issue) => issue.severity === "critical").length;
  if (policy.failOnNewCriticalIssues && newCritical > oldCritical) findings.push({ code: "regression.new-critical", severe: true, message: "New critical SEO issues were detected", before: oldCritical, after: newCritical });
  const old5xx = (previous.pages ?? []).filter((page) => (page.status ?? 0) >= 500).length;
  const new5xx = (current.pages ?? []).filter((page) => (page.status ?? 0) >= 500).length;
  if (policy.failOnNewHttp5xx && new5xx > old5xx) findings.push({ code: "regression.http-5xx", severe: true, message: "New HTTP 5xx responses were detected", before: old5xx, after: new5xx });
  const brokenCanonical = issues(current).filter((issue) => /canonical/i.test(issue.ruleId ?? issue.id ?? "")).length;
  const oldBrokenCanonical = issues(previous).filter((issue) => /canonical/i.test(issue.ruleId ?? issue.id ?? "")).length;
  if (policy.failOnBrokenCanonical && brokenCanonical > oldBrokenCanonical) findings.push({ code: "regression.canonical", severe: true, message: "A new canonical regression was detected", before: oldBrokenCanonical, after: brokenCanonical });
  const severe = findings.some((finding) => finding.severe);
  return { passed: findings.length === 0, rollbackRequired: severe && policy.rollbackOnSevereRegression, scoreDelta, findings };
}
