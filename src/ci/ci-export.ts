import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TrendReport } from "../trends/trend-schema.js";
import { redactSecrets } from "../core/redaction.js";

function xmlEscape(value: unknown): string { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;"); }
function annotationEscape(value: unknown): string { return String(value ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C"); }
export function renderJunit(report: TrendReport): string {
  const gateReasons = report.gate?.reasons ?? [];
  const cases: string[] = [];
  const add = (name: string, failure?: string, skipped?: string, props: Record<string, unknown> = {}) => {
    const properties = Object.entries(props).map(([k, v]) => `<property name="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`).join("");
    cases.push(`<testcase name="${xmlEscape(name)}"><properties>${properties}</properties>${failure ? `<failure message="${xmlEscape(failure)}">${xmlEscape(failure)}</failure>` : ""}${skipped ? `<skipped message="${xmlEscape(skipped)}"/>` : ""}</testcase>`);
  };
  add("Historical confidence", report.confidence === "insufficient-data" ? "insufficient historical data" : undefined, undefined, { confidence: report.confidence, entries: report.entries });
  for (const series of report.series) add(`${series.metric} ${series.direction}`, ["degradation", "strong-degradation"].includes(series.direction) ? `${series.metric} degraded by ${series.absoluteDelta}` : undefined, undefined, { metric: series.metric, first: series.first, latest: series.latest, delta: series.absoluteDelta, confidence: series.confidence });
  for (const reason of gateReasons) add(`Gate: ${reason}`, reason);
  if (!report.series.length) add("Historical gates", undefined, "No trend series available");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Codex SEO historical gates" tests="${cases.length}" failures="${gateReasons.length}" skipped="${report.series.length ? 0 : 1}">${cases.join("")}</testsuite>\n`;
}
export function renderGithubAnnotations(report: TrendReport): string {
  const lines: string[] = [];
  for (const series of report.series) {
    const title = `${series.metric} ${series.direction}`;
    const message = `${series.metric}: first ${series.first ?? "n/a"}, latest ${series.latest ?? "n/a"}, delta ${series.absoluteDelta ?? "n/a"}, confidence ${series.confidence}`;
    const level = ["degradation", "strong-degradation"].includes(series.direction) ? "error" : series.confidence === "low" ? "warning" : "notice";
    lines.push(`::${level} title=${annotationEscape(title)}::${annotationEscape(message)}`);
  }
  for (const reason of report.gate?.reasons ?? []) lines.push(`::error title=${annotationEscape("Codex SEO gate failed")}::${annotationEscape(reason)}`);
  return `${lines.join("\n")}\n`;
}
export function renderCiMarkdown(report: TrendReport): string {
  const line = (metric: string) => { const s = report.series.find((item) => item.metric === metric); return `| ${metric} | ${s?.first ?? "n/a"} | ${s?.latest ?? "n/a"} | ${s?.absoluteDelta ?? "n/a"} | ${s?.direction ?? "n/a"} |`; };
  return [`# Codex SEO`, "", `Entries: ${report.entries}`, `Compatible entries: ${report.compatibleEntries}`, `Confidence: ${report.confidence}`, `Gate: ${report.gate?.passed === false ? "FAILED" : "PASSED"}`, "", "| Metric | First | Latest | Delta | Direction |", "| --- | ---: | ---: | ---: | --- |", line("seo.score"), line("performance.lighthouseScore"), line("performance.lcpMs"), line("gsc.clicks")].join("\n") + "\n";
}
export async function writeCiExport(report: TrendReport, options: { format: "json" | "markdown" | "github" | "junit"; outputDir: string; githubStepSummary?: string; privacyMode?: boolean }): Promise<string[]> {
  await mkdir(options.outputDir, { recursive: true });
  const files: string[] = [];
  const safe = (value: string) => redactSecrets(value, { privacyMode: options.privacyMode });
  if (options.format === "json") { const file = path.join(options.outputDir, "ci-trend.json"); await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8"); files.push(file); }
  if (options.format === "markdown") { const file = path.join(options.outputDir, "ci-summary.md"); await writeFile(file, safe(renderCiMarkdown(report)), "utf8"); files.push(file); }
  if (options.format === "github") { const ann = path.join(options.outputDir, "github-annotations.txt"); const md = path.join(options.outputDir, "github-step-summary.md"); await writeFile(ann, safe(renderGithubAnnotations(report)), "utf8"); await writeFile(md, safe(renderCiMarkdown(report)), "utf8"); files.push(ann, md); if (options.githubStepSummary) await writeFile(options.githubStepSummary, safe(renderCiMarkdown(report)), "utf8"); }
  if (options.format === "junit") { const file = path.join(options.outputDir, "codex-seo-junit.xml"); await writeFile(file, safe(renderJunit(report)), "utf8"); files.push(file); }
  return files;
}
export const testInternals = { xmlEscape, annotationEscape };