import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { SeoIssue, SeoSeverity } from "../core/issue.js";
import type { SeoReport } from "../schemas/report-schema.js";
import { performanceStyles, renderPerformanceSection } from "./performance-report.js";
import { gscStyles, renderGscSection } from "./gsc-report.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function issueCard(issue: SeoIssue): string {
  const evidence = issue.evidence ? `<pre>${escapeHtml(JSON.stringify(issue.evidence, null, 2))}</pre>` : "<p>No evidence payload.</p>";
  return `<article class="issue severity-${issue.severity}">
    <div class="issue-head">
      <span class="badge">${escapeHtml(issue.severity)}</span>
      <span class="category">${escapeHtml(issue.category)}</span>
    </div>
    <h3>${escapeHtml(issue.title)}</h3>
    <p>${escapeHtml(issue.description)}</p>
    <h4>Evidence</h4>
    ${evidence}
    <h4>Recommendation</h4>
    <p>${escapeHtml(issue.recommendation)}</p>
  </article>`;
}

function countBySeverity(issues: SeoIssue[]): Record<SeoSeverity, number> {
  return issues.reduce<Record<SeoSeverity, number>>((acc, issue) => {
    acc[issue.severity] += 1;
    return acc;
  }, { info: 0, low: 0, medium: 0, high: 0, critical: 0 });
}

export function renderHtmlReport(report: SeoReport): string {
  const counts = countBySeverity(report.issues);
  const categoryRows = Object.entries(report.scores.categories)
    .map(([category, score]) => `<tr><td>${escapeHtml(category)}</td><td>${score === null ? "Not run" : score}</td></tr>`)
    .join("");
  const errorRows = report.errors.length
    ? report.errors.map((error) => `<li><strong>${escapeHtml(error.module)}:</strong> ${escapeHtml(error.message)}</li>`).join("")
    : "<li>No module errors recorded.</li>";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex SEO Report - ${escapeHtml(report.metadata.domain)}</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#5f6c7b; --line:#d8dee8; --bg:#f6f8fb; --panel:#fff; --accent:#0f766e; }
    body { margin:0; font-family: Arial, sans-serif; color:var(--ink); background:var(--bg); line-height:1.5; }
    header, main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { background: var(--panel); border-bottom: 1px solid var(--line); max-width:none; }
    header .inner { max-width:1120px; margin:0 auto; }
    h1 { font-size: 32px; margin: 0 0 8px; }
    h2 { margin-top: 32px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .meta, .summary { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap:12px; }
    .card, .issue { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .score { font-size: 44px; font-weight: 800; color: var(--accent); }
    table { width:100%; border-collapse: collapse; background:var(--panel); }
    td, th { border:1px solid var(--line); padding:10px; text-align:left; }
    .issues { display:grid; gap:14px; }
    .issue-head { display:flex; gap:8px; align-items:center; }
    .badge, .category { text-transform:uppercase; font-size:12px; border-radius:999px; padding:3px 8px; background:#e8eef5; }
    .severity-critical { border-left: 6px solid #b91c1c; }
    .severity-high { border-left: 6px solid #dc2626; }
    .severity-medium { border-left: 6px solid #d97706; }
    .severity-low { border-left: 6px solid #2563eb; }
    .severity-info { border-left: 6px solid #64748b; }
    pre { overflow:auto; background:#0f172a; color:#e2e8f0; padding:12px; border-radius:6px; font-size:12px; }
    code { background:#eef2f7; padding:2px 4px; border-radius:4px; }
    ${performanceStyles()}
    ${gscStyles()}
  </style>
</head>
<body>
  <header><div class="inner">
    <h1>Codex SEO Report</h1>
    <p>${escapeHtml(report.metadata.finalUrl)}</p>
  </div></header>
  <main>
    <section class="meta">
      <div class="card"><strong>Score</strong><div class="score">${report.scores.overall}</div></div>
      <div class="card"><strong>Date</strong><p>${escapeHtml(report.metadata.date)}</p></div>
      <div class="card"><strong>Duration</strong><p>${report.metadata.durationMs} ms</p></div>
      <div class="card"><strong>Rendered</strong><p>${report.metadata.rendered ? "Playwright" : "HTTP fetch"}</p></div>
    </section>
    <h2>Issue Summary</h2>
    <section class="summary">
      ${Object.entries(counts).map(([severity, count]) => `<div class="card"><strong>${escapeHtml(severity)}</strong><p>${count}</p></div>`).join("")}
    </section>
    <h2>Category Scores</h2>
    <table><tbody>${categoryRows}</tbody></table>
    ${renderPerformanceSection(report.performance)}
    ${renderGscSection(report.gsc)}
    <h2>Issues</h2>
    <section class="issues">${report.issues.map(issueCard).join("") || "<p>No issues found by executed analyzers.</p>"}</section>
    <h2>Module Errors And Skips</h2>
    <ul>${errorRows}</ul>
    <p>Skipped modules: ${escapeHtml(report.execution.analyzersSkipped.join(", ") || "none")}</p>
    <h2>Execution Details</h2>
    <pre>${escapeHtml(JSON.stringify(report.execution, null, 2))}</pre>
  </main>
</body>
</html>`;
}

export async function writeHtmlReport(report: SeoReport, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "report.html");
  await writeFile(filePath, renderHtmlReport(report), "utf8");
  return filePath;
}

export async function writePdfFromHtml(htmlPath: string, outputDir: string): Promise<string> {
  const pdfPath = path.join(outputDir, "report.pdf");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "networkidle" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" } });
    return pdfPath;
  } finally {
    await browser.close();
  }
}
