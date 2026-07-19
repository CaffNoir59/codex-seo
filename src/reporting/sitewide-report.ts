import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { sortIssues, type SeoIssue, type SeoSeverity } from "../core/issue.js";
import { scoreIssues } from "../core/scoring.js";
import type { CrawlResult } from "../crawler/crawl-result.js";
import { analyzeDuplicateContent } from "../analyzers/duplicate-content.js";
import { analyzeIndexability } from "../analyzers/indexability.js";
import { analyzeInternalLinking } from "../analyzers/internal-linking.js";
import { analyzeSiteArchitecture } from "../analyzers/site-architecture.js";
import { analyzePerformanceResults } from "../analyzers/performance.js";
import { analyzeGscIndexation } from "../analyzers/gsc-indexation.js";
import { aggregatePerformance } from "../performance/performance-aggregation.js";
import type { PerformanceResult } from "../performance/performance-schema.js";
import { performanceStyles, renderPerformanceSection } from "./performance-report.js";
import { sitewideAuditReportSchema, type SitewideAuditReport } from "../schemas/sitewide-report-schema.js";
import type { GscAuditResult } from "../gsc/gsc-schema.js";
import { gscStyles, renderGscSection } from "./gsc-report.js";
import { getVersion } from "../version.js";

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function issueImpact(issue: SeoIssue, pageCount: number): number {
  const severity: Record<SeoSeverity, number> = { info: 0.2, low: 1, medium: 3, high: 7, critical: 12 };
  return severity[issue.severity] / Math.max(1, Math.log10(pageCount + 9));
}

function aggregateIssues(issues: SeoIssue[], pageCount: number) {
  const groups = new Map<string, { id: string; title: string; severity: SeoSeverity; category: string; count: number; affectedPages: Set<string>; examples: string[] }>();
  for (const item of issues) {
    const key = item.id;
    const group = groups.get(key) ?? { id: item.id, title: item.title, severity: item.severity, category: item.category, count: 0, affectedPages: new Set<string>(), examples: [] };
    group.count += 1;
    if (item.affectedUrl) {
      group.affectedPages.add(item.affectedUrl);
      if (group.examples.length < 8 && !group.examples.includes(item.affectedUrl)) group.examples.push(item.affectedUrl);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, affectedPages: group.affectedPages.size, siteShare: pageCount ? Number((group.affectedPages.size / pageCount).toFixed(3)) : 0 }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function buildSitewideReport(crawl: CrawlResult, performance: PerformanceResult[] = [], gsc?: GscAuditResult): SitewideAuditReport {
  const sitewideResults = [analyzeSiteArchitecture(crawl), analyzeInternalLinking(crawl), analyzeIndexability(crawl), analyzeDuplicateContent(crawl)];
  const pageIssues = crawl.pages.flatMap((page) => page.issues.map((item) => ({ ...item, affectedUrl: item.affectedUrl ?? page.url })));
  const performanceIssues = analyzePerformanceResults(performance);
  const gscIssues = gsc ? analyzeGscIndexation(gsc) : [];
  const issues = sortIssues([...pageIssues, ...sitewideResults.flatMap((result) => result.issues), ...performanceIssues, ...gscIssues]);
  const categories = [...new Set(issues.map((item) => item.category))];
  const baseScores = scoreIssues(issues, categories);
  const repeatedPenalty = Math.min(45, issues.reduce((sum, item) => sum + issueImpact(item, crawl.pages.length), 0));
  const dataPenalty = crawl.pages.length === 0 ? 100 : 0;
  const score = Math.max(0, Math.min(100, Math.round(100 - repeatedPenalty - dataPenalty)));
  const categoryScores = Object.fromEntries(Object.entries(baseScores.categories).filter(([, value]) => value !== null).map(([key, value]) => [key, value ?? 0]));
  const performanceAggregation = aggregatePerformance(performance, { eligiblePages: performance.length });
  if (performanceAggregation.score.mean !== undefined) categoryScores.performance = Math.round(performanceAggregation.score.mean);
  if (gsc?.score !== undefined) categoryScores.gsc = gsc.score;
  return sitewideAuditReportSchema.parse({
    audit: {
      tool: "codex-seo",
      version: getVersion(),
      startUrl: crawl.startUrl,
      startedAt: crawl.startedAt,
      completedAt: crawl.completedAt,
      durationMs: crawl.durationMs,
      configuration: crawl.configuration
    },
    summary: {
      score,
      crawledPages: crawl.stats.crawledPages ?? crawl.pages.filter((page) => page.statusCode !== undefined).length,
      attemptedPages: crawl.stats.attemptedPages,
      fetchedPages: crawl.stats.fetchedPages,
      successfulPages: crawl.stats.successfulPages,
      failedPages: crawl.stats.failedPages,
      httpErrorPages: crawl.stats.httpErrorPages,
      fetchFailurePages: crawl.stats.fetchFailurePages,
      renderFailurePages: crawl.stats.renderFailurePages,
      reportEntries: crawl.stats.reportEntries,
      discoveredUrls: crawl.stats.discoveredUrls,
      skippedUrls: crawl.stats.skippedUrls,
      blockedByRobots: crawl.stats.blockedByRobots
    },
    categoryScores,
    crawlStats: crawl.stats,
    pages: gsc ? crawl.pages.map((page) => ({ ...page, gsc: gsc.pageData[page.finalUrl] ?? gsc.pageData[page.url] })) : crawl.pages,
    issues,
    issueSummary: aggregateIssues(issues, crawl.pages.length),
    performance: performance.length ? performance : undefined,
    performanceAggregation: performance.length ? performanceAggregation : undefined,
    gsc: gsc?.enabled ? gsc : undefined,
    sitemap: crawl.sitemap
  });
}

export function renderSitewideHtml(report: SitewideAuditReport): string {
  const pageRows = report.pages.map((page) => `<tr data-status="${page.statusCode ?? "none"}" data-depth="${page.depth}" data-result="${escapeHtml(page.resultType)}"><td><a href="${escapeHtml(page.finalUrl)}">${escapeHtml(page.url)}</a></td><td>${escapeHtml(page.finalUrl)}</td><td>${escapeHtml(page.resultType)}</td><td>${page.statusCode ?? ""}</td><td>${page.redirectCount ?? 0}</td><td>${page.depth}</td><td>${page.robots?.indexable ?? false}</td><td>${page.issues.length}</td><td>${escapeHtml(page.error?.message ?? "")}</td></tr>`).join("");
  const renderedIssueSummary = aggregateIssues(report.issues, report.pages.length);
  const issueRows = renderedIssueSummary.map((item) => `<article class="issue"><strong>${escapeHtml(item.severity)} / ${escapeHtml(item.category)}</strong><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.count)} occurrence(s), ${escapeHtml(item.affectedPages)} affected page(s), share ${escapeHtml(item.siteShare)}</p><pre>${escapeHtml(JSON.stringify({ id: item.id, examples: item.examples }, null, 2))}</pre></article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex SEO Sitewide Report</title><style>body{font-family:Arial,sans-serif;margin:0;background:#f6f8fb;color:#17202a}header,main{max-width:1200px;margin:auto;padding:24px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.card,.issue{background:white;border:1px solid #d8dee8;border-radius:8px;padding:14px}.score{font-size:42px;color:#0f766e;font-weight:800}table{width:100%;border-collapse:collapse;background:white}td,th{border:1px solid #d8dee8;padding:8px;text-align:left;vertical-align:top}input,select{padding:8px;margin:4px}pre{overflow:auto;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:6px}.issue{margin:12px 0}${performanceStyles()}${gscStyles()}</style></head><body><header><h1>Codex SEO Sitewide Report</h1><p>${escapeHtml(report.audit.startUrl)}</p><p>codex-seo ${escapeHtml(report.audit.version ?? "")}</p></header><main><section class="cards"><div class="card"><strong>Score</strong><div class="score">${report.summary.score}</div></div><div class="card"><strong>Crawled</strong><p>${report.summary.crawledPages}</p></div><div class="card"><strong>Successful</strong><p>${report.summary.successfulPages ?? "n/a"}</p></div><div class="card"><strong>Failed</strong><p>${report.summary.failedPages}</p></div><div class="card"><strong>Discovered</strong><p>${report.summary.discoveredUrls}</p></div><div class="card"><strong>Robots blocked</strong><p>${report.summary.blockedByRobots}</p></div></section><h2>Category Scores</h2><pre>${escapeHtml(JSON.stringify(report.categoryScores, null, 2))}</pre><h2>Crawl Counters</h2><pre>${escapeHtml(JSON.stringify(report.summary, null, 2))}</pre><h2>Pages</h2><input id="filter" placeholder="Filter URL"><table id="pages"><thead><tr><th>Requested URL</th><th>Final URL</th><th>Result</th><th>Status</th><th>Redirects</th><th>Depth</th><th>Indexable</th><th>Issues</th><th>Error</th></tr></thead><tbody>${pageRows}</tbody></table>${renderPerformanceSection(report.performance)}<h2>Performance Aggregation</h2><pre>${escapeHtml(JSON.stringify(report.performanceAggregation ?? {}, null, 2))}</pre>${renderGscSection(report.gsc)}<h2>Issue Summary</h2>${issueRows || "<p>No issues detected.</p>"}<h2>Sitemap Coverage</h2><pre>${escapeHtml(JSON.stringify(report.sitemap, null, 2))}</pre><h2>Robots And Crawl Stats</h2><pre>${escapeHtml(JSON.stringify(report.crawlStats, null, 2))}</pre><script>const f=document.getElementById('filter');f.addEventListener('input',()=>{for(const r of document.querySelectorAll('#pages tbody tr'))r.style.display=r.textContent.toLowerCase().includes(f.value.toLowerCase())?'':'none'});</script></main></body></html>`;
}

export async function writeSitewideReport(report: SitewideAuditReport, outputDir: string, pdf = false): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "sitewide-report.json");
  const htmlPath = path.join(outputDir, "sitewide-report.html");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(htmlPath, renderSitewideHtml(report), "utf8");
  const files = [jsonPath, htmlPath];
  if (pdf) {
    const pdfPath = path.join(outputDir, "sitewide-report.pdf");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "networkidle" });
      await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" } });
      files.push(pdfPath);
    } finally {
      await browser.close();
    }
  }
  return files;
}



