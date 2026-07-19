import type { TrendReport } from "../trends/trend-schema.js";

export function formatTrendConsole(report: TrendReport, files: string[] = []): string {
  const line = (metric: string) => {
    const series = report.series.find((item) => item.metric === metric);
    if (!series) return `${metric}: n/a`;
    return `${metric}: first ${series.first ?? "n/a"}, latest ${series.latest ?? "n/a"}, delta ${series.absoluteDelta ?? "n/a"}, trend ${series.direction}`;
  };
  return ["Historical SEO analysis completed", "", `Entries: ${report.entries}`, `Compatible entries: ${report.compatibleEntries}`, `Confidence: ${report.confidence.toUpperCase()}`, "", line("seo.score"), line("performance.lighthouseScore"), line("performance.lcpMs"), line("gsc.clicks"), "", `Recurring regressions: ${report.recurringIssues.length}`, ...(report.gate ? [`Historical gate: ${report.gate.passed ? "PASSED" : "FAILED"}`, ...report.gate.reasons.map((reason) => `- ${reason}`)] : []), ...(files.length ? ["", "Reports generated:", ...files.map((file) => `- ${file}`)] : [])].join("\n");
}