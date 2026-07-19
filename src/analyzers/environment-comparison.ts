import type { HistoryEntry } from "../history/history-schema.js";

export function compareEnvironments(entries: HistoryEntry[], a: string, b: string) {
  const latest = (env: string) => entries.filter((entry) => entry.identity.environment === env).sort((x, y) => x.createdAt.localeCompare(y.createdAt)).at(-1);
  const left = latest(a);
  const right = latest(b);
  if (!left || !right) return { compatible: false, environmentA: a, environmentB: b, warnings: ["Missing environment audit"] };
  const leftIssues = new Set(left.issueFingerprints);
  const rightIssues = new Set(right.issueFingerprints);
  const onlyA = [...leftIssues].filter((item) => !rightIssues.has(item));
  const onlyB = [...rightIssues].filter((item) => !leftIssues.has(item));
  return { compatible: left.target.origin === right.target.origin, environmentA: a, environmentB: b, scoreA: left.summary.seoScore, scoreB: right.summary.seoScore, scoreDelta: (right.summary.seoScore ?? 0) - (left.summary.seoScore ?? 0), problemOnlyInA: onlyA.length, problemOnlyInB: onlyB.length, correctionInB: onlyA.length, futureRegressionRisk: onlyB.length, gscComparable: false, warnings: left.target.property === right.target.property ? [] : ["GSC is not compared directly across environments unless properties are equivalent"] };
}