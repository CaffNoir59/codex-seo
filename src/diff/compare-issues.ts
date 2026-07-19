import type { BaselineIssue } from "../baseline/baseline-schema.js";
import type { IssueDiff } from "./diff-schema.js";
import { ignoreReasonForIssue, type IgnoreOptions } from "./ignore-rules.js";

const severityRank = { info: 1, low: 2, medium: 3, high: 4, critical: 5 } as const;

function makeDiff(issue: BaselineIssue, type: string, ignore: IgnoreOptions, previousSeverity?: BaselineIssue["severity"], currentSeverity?: BaselineIssue["severity"]): IssueDiff {
  const ignoredBy = ignoreReasonForIssue(issue, ignore);
  return { key: issue.key, ruleId: issue.ruleId, category: issue.category, severity: currentSeverity ?? previousSeverity ?? issue.severity, previousSeverity, currentSeverity, affectedUrl: issue.affectedUrl, changeType: type, confidence: "high", ignored: Boolean(ignoredBy), ignoredBy };
}

export function compareIssues(previous: BaselineIssue[], current: BaselineIssue[], ignore: IgnoreOptions): { introduced: IssueDiff[]; resolved: IssueDiff[]; persisting: IssueDiff[]; changed: IssueDiff[] } {
  const prev = new Map(previous.map((issue) => [issue.key, issue]));
  const curr = new Map(current.map((issue) => [issue.key, issue]));
  const introduced: IssueDiff[] = [];
  const resolved: IssueDiff[] = [];
  const persisting: IssueDiff[] = [];
  const changed: IssueDiff[] = [];

  for (const issue of current) {
    const before = prev.get(issue.key);
    if (!before) introduced.push(makeDiff(issue, "introduced", ignore, undefined, issue.severity));
    else if (before.severity !== issue.severity || before.evidenceHash !== issue.evidenceHash || before.recommendationHash !== issue.recommendationHash) {
      const type = severityRank[issue.severity] > severityRank[before.severity] ? "severityIncreased" : severityRank[issue.severity] < severityRank[before.severity] ? "severityDecreased" : "changed";
      changed.push(makeDiff(issue, type, ignore, before.severity, issue.severity));
    } else persisting.push(makeDiff(issue, "persisting", ignore, before.severity, issue.severity));
  }
  for (const issue of previous) if (!curr.has(issue.key)) resolved.push(makeDiff(issue, "resolved", ignore, issue.severity));
  const sorter = (a: IssueDiff, b: IssueDiff) => a.key.localeCompare(b.key);
  return { introduced: introduced.sort(sorter), resolved: resolved.sort(sorter), persisting: persisting.sort(sorter), changed: changed.sort(sorter) };
}
