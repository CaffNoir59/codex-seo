import type { HistoryEntry } from "../history/history-schema.js";
import { buildTrendSeries } from "../trends/trend-series.js";

export function compareReleases(entries: HistoryEntry[], a: string, b: string) {
  const byRelease = (release: string) => entries.filter((entry) => entry.identity.release === release).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const prev = byRelease(a).at(-1);
  const curr = byRelease(b).at(-1);
  if (!prev || !curr) return { compatible: false, releaseA: a, releaseB: b, warnings: ["One or both releases are missing"] };
  const prevIssues = new Set(prev.issueFingerprints);
  const currIssues = new Set(curr.issueFingerprints);
  const regressions = [...currIssues].filter((item) => !prevIssues.has(item));
  const improvements = [...prevIssues].filter((item) => !currIssues.has(item));
  return { compatible: prev.target.origin === curr.target.origin, releaseA: a, releaseB: b, previousScore: prev.summary.seoScore, currentScore: curr.summary.seoScore, scoreDelta: (curr.summary.seoScore ?? 0) - (prev.summary.seoScore ?? 0), regressions: regressions.length, improvements: improvements.length, performanceDelta: (curr.summary.performance?.lighthouseScore ?? 0) - (prev.summary.performance?.lighthouseScore ?? 0), gscClicksDelta: (curr.summary.gsc?.clicks ?? 0) - (prev.summary.gsc?.clicks ?? 0), note: "association temporelle observée" };
}

export function releaseTrend(entries: HistoryEntry[], release: string) {
  return buildTrendSeries(entries.filter((entry) => entry.identity.release === release), "seo.score");
}