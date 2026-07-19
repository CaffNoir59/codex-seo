import path from "node:path";
import { analyzeContent } from "../analyzers/content.js";
import { analyzeGeo } from "../analyzers/geo.js";
import { analyzeImages } from "../analyzers/images.js";
import { analyzeSchema } from "../analyzers/schema.js";
import { analyzeSitemap } from "../analyzers/sitemap.js";
import { analyzeTechnical } from "../analyzers/technical.js";
import { analyzePerformanceResults } from "../analyzers/performance.js";
import type { AuditContext } from "../core/audit-context.js";
import { fetchPage } from "../core/fetch-page.js";
import { sortIssues, type AnalyzerResult, type SeoCategory } from "../core/issue.js";
import { createNetworkAccessPolicy, type NetworkAccessPolicy } from "../core/network-policy.js";
import { parseHtml } from "../core/parse-html.js";
import { renderPage, shouldRenderWithBrowser } from "../core/render-page.js";
import { scoreIssues } from "../core/scoring.js";
import { writeHtmlReport, writePdfFromHtml } from "../reporting/html-report.js";
import { writeJsonReport } from "../reporting/json-report.js";
import { reportSchema, type SeoReport } from "../schemas/report-schema.js";
import type { PerformanceResult } from "../performance/performance-schema.js";
import type { GscAuditResult } from "../gsc/gsc-schema.js";
import { getVersion } from "../version.js";

export type AuditOptions = {
  outputRoot?: string;
  forceRender?: boolean;
  pdf?: boolean;
  performance?: PerformanceResult[];
  gsc?: GscAuditResult;
  allowPrivateNetwork?: boolean;
  networkPolicy?: NetworkAccessPolicy;
};

const analyzers: Array<[SeoCategory, (context: AuditContext) => Promise<AnalyzerResult>]> = [
  ["technical", analyzeTechnical],
  ["content", analyzeContent],
  ["schema", analyzeSchema],
  ["sitemap", analyzeSitemap],
  ["images", analyzeImages],
  ["geo", analyzeGeo]
];

function domainDir(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

async function buildContext(rawUrl: string, forceRender: boolean, networkPolicy: NetworkAccessPolicy): Promise<AuditContext> {
  const startedAt = new Date().toISOString();
  const fetched = await fetchPage(rawUrl, { networkPolicy });
  let html = fetched.html;
  let finalUrl = fetched.finalUrl;
  let rendered = false;
  if (forceRender || shouldRenderWithBrowser(html)) {
    const renderedPage = await renderPage(fetched.finalUrl, { networkPolicy });
    html = renderedPage.html;
    finalUrl = renderedPage.finalUrl;
    rendered = true;
  }
  const parsed = parseHtml(html, finalUrl);
  return {
    requestedUrl: rawUrl,
    finalUrl,
    domain: domainDir(finalUrl),
    startedAt,
    fetch: { ...fetched, finalUrl },
    html,
    rendered,
    parsed,
    networkPolicy,
    pageIntent: parsed.pageIntent
  };
}

export async function runAudit(rawUrl: string, options: AuditOptions = {}): Promise<{ report: SeoReport; outputDir: string; files: string[] }> {
  const started = Date.now();
  const networkPolicy = options.networkPolicy ?? createNetworkAccessPolicy(rawUrl, { allowPrivateNetwork: options.allowPrivateNetwork });
  const context = await buildContext(rawUrl, Boolean(options.forceRender), networkPolicy);
  const settled = await Promise.all(analyzers.map(async ([category, run]) => {
    try {
      return await run(context);
    } catch (error) {
      return {
        category,
        issues: [],
        summary: {},
        errors: [error instanceof Error ? error.message : String(error)]
      } satisfies AnalyzerResult;
    }
  }));
  settled.sort((a, b) => a.category.localeCompare(b.category));
  const performanceResults = options.performance ?? [];
  const gsc = options.gsc;
  const performanceIssues = analyzePerformanceResults(performanceResults);
  const issues = sortIssues([...settled.flatMap((result) => result.issues), ...performanceIssues]);
  const executed = [...settled.map((result) => result.category), ...(performanceResults.length ? ["performance" as SeoCategory] : [])].sort() as SeoCategory[];
  const scores = scoreIssues(issues, executed);
  const report = reportSchema.parse({
    metadata: {
      tool: "codex-seo",
      version: getVersion(),
      requestedUrl: rawUrl,
      finalUrl: context.finalUrl,
      domain: context.domain,
      date: context.startedAt,
      durationMs: Date.now() - started,
      rendered: context.rendered
    },
    scores,
    issues,
    summaries: Object.fromEntries(settled.map((result) => [result.category, result.summary])),
    errors: settled.flatMap((result) => result.errors.map((message) => ({ module: result.category, message }))),
    performance: performanceResults.length ? performanceResults : undefined,
    gsc: gsc?.enabled ? gsc : undefined,
    execution: {
      analyzersExecuted: executed,
      analyzersSkipped: [],
      redirects: context.fetch.redirects,
      status: context.fetch.status,
      headers: context.fetch.headers
    }
  });
  const outputRoot = options.outputRoot ?? "reports";
  const outputDir = path.join(outputRoot, context.domain);
  const jsonPath = await writeJsonReport(report, outputDir);
  const htmlPath = await writeHtmlReport(report, outputDir);
  const files = [jsonPath, htmlPath];
  if (options.pdf) files.push(await writePdfFromHtml(htmlPath, outputDir));
  return { report, outputDir, files };
}
