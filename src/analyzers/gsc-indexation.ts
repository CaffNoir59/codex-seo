import { issue, type SeoIssue } from "../core/issue.js";
import type { GscAuditResult } from "../gsc/gsc-schema.js";

export function analyzeGscIndexation(audit: GscAuditResult): SeoIssue[] {
  const issues: SeoIssue[] = [];
  for (const item of audit.inspections) {
    if (/FAIL|not indexed|excluded/i.test(`${item.verdict} ${item.coverageState ?? ""}`)) {
      issues.push(issue({ id: "gsc.inspection-not-indexed", category: "gsc", severity: "high", title: "GSC inspection indicates the URL is not indexed", description: "URL Inspection mock/API data reports a non-indexed or excluded state. Missing inspection data is not treated as non-indexed.", affectedUrl: item.url, evidence: { source: "gsc-url-inspection", verdict: item.verdict, coverageState: item.coverageState, confidence: item.partial ? "low" : "medium" }, recommendation: "Confirm the inspection result in Search Console and fix indexability blockers before requesting reprocessing." }));
    }
    if (item.googleCanonical && item.userCanonical && item.googleCanonical !== item.userCanonical) {
      issues.push(issue({ id: "gsc.google-canonical-mismatch", category: "gsc", severity: "medium", title: "Google canonical differs from declared canonical", description: "URL Inspection reports a Google-selected canonical different from the user-declared canonical.", affectedUrl: item.url, evidence: { source: "gsc-url-inspection", googleCanonical: item.googleCanonical, userCanonical: item.userCanonical, confidence: item.partial ? "low" : "medium" }, recommendation: "Review canonical signals, internal linking and duplicate content for this URL." }));
    }
  }
  return issues;
}