import type { HistoryEntry } from "../history/history-schema.js";

export type RecurringIssue = { ruleId: string; affectedUrls: string[]; firstSeen: string; lastSeen: string; occurrences: number; resolvedOccurrences: number; regressionCount: number; active: boolean; severity: string; confidence: string };

function ruleFromFingerprint(fingerprint: string): string { return fingerprint.split(":")[0] || fingerprint; }

export function detectRecurringIssues(entries: HistoryEntry[]): RecurringIssue[] {
  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const allRules = new Set(ordered.flatMap((entry) => entry.issueFingerprints.map(ruleFromFingerprint)));
  const results: RecurringIssue[] = [];
  for (const ruleId of allRules) {
    let previous = false;
    let firstSeen = "";
    let lastSeen = "";
    let occurrences = 0;
    let resolvedOccurrences = 0;
    let regressionCount = 0;
    for (const entry of ordered) {
      const present = entry.issueFingerprints.some((fp) => ruleFromFingerprint(fp) === ruleId);
      if (present) { occurrences += 1; firstSeen ||= entry.createdAt; lastSeen = entry.createdAt; if (!previous && firstSeen !== entry.createdAt) regressionCount += 1; }
      if (!present && previous) resolvedOccurrences += 1;
      previous = present;
    }
    if (occurrences >= 2 || regressionCount > 0) results.push({ ruleId, affectedUrls: [], firstSeen, lastSeen, occurrences, resolvedOccurrences, regressionCount, active: ordered.at(-1)?.issueFingerprints.some((fp) => ruleFromFingerprint(fp) === ruleId) ?? false, severity: "unknown", confidence: ordered.length >= 6 ? "high" : ordered.length >= 3 ? "medium" : "low" });
  }
  return results.sort((a, b) => b.regressionCount - a.regressionCount || b.occurrences - a.occurrences || a.ruleId.localeCompare(b.ruleId));
}