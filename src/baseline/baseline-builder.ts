import { readFile } from "node:fs/promises";
import { BASELINE_SCHEMA_VERSION, seoBaselineSchema, type BaselinePage, type SeoBaseline } from "./baseline-schema.js";
import { normalizeText, pageKey, safeText, stableHash, stableIssueKey, stableJson } from "./baseline-normalizer.js";
import { normalizeUrl } from "../crawler/url-normalizer.js";
import type { SitewideAuditReport } from "../schemas/sitewide-report-schema.js";
import { sitewideAuditReportSchema } from "../schemas/sitewide-report-schema.js";
import type { SeoIssue } from "../core/issue.js";

export type BuildBaselineOptions = {
  name: string;
  sourceReportPath?: string;
  privacyMode?: boolean;
  toolVersion?: string;
  createdAt?: string;
};

function incomingCounts(report: SitewideAuditReport): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of report.pages) {
    for (const link of page.links.internal) counts.set(normalizeUrl(link), (counts.get(normalizeUrl(link)) ?? 0) + 1);
  }
  return counts;
}

function pageScore(page: SitewideAuditReport["pages"][number]): number {
  if (page.error) return 0;
  return Math.max(0, Math.min(100, 100 - page.issues.length * 5));
}

function buildPage(page: SitewideAuditReport["pages"][number], incoming: Map<string, number>, sitemap: Set<string>, privacyMode: boolean): BaselinePage {
  const text = [page.title, page.metaDescription, page.h1, page.contentFingerprint, ...(page.contentSignature ?? [])].join(" ");
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const key = pageKey(page.finalUrl, page.url);
  return {
    key,
    url: key,
    finalUrl: page.finalUrl,
    requestedUrl: page.url,
    statusCode: page.statusCode,
    indexable: page.robots?.indexable,
    followable: page.robots?.followable,
    canonical: page.canonical ? normalizeUrl(page.canonical, page.finalUrl) : page.canonical,
    title: safeText(page.title, privacyMode),
    metaDescription: safeText(page.metaDescription, privacyMode),
    h1: safeText(page.h1, privacyMode),
    titleHash: stableHash(page.title),
    metaDescriptionHash: stableHash(page.metaDescription),
    h1Hash: stableHash(page.h1),
    contentHash: page.contentFingerprint,
    contentSignature: [...(page.contentSignature ?? [])].sort(),
    contentLength: normalizeText(text).length,
    wordCount: words.length,
    depth: page.depth,
    incomingInternalLinks: incoming.get(key) ?? 0,
    outgoingInternalLinks: page.links.internal.length,
    pageScore: pageScore(page),
    fromSitemap: sitemap.has(page.url) || sitemap.has(key),
    errorCode: page.error?.code
  };
}

function buildIssue(issue: SeoIssue, privacyMode: boolean) {
  return {
    key: stableIssueKey(issue),
    ruleId: issue.id,
    category: issue.category,
    severity: issue.severity,
    affectedUrl: issue.affectedUrl ? normalizeUrl(issue.affectedUrl) : undefined,
    title: safeText(issue.title, privacyMode),
    titleHash: stableHash(issue.title),
    evidenceHash: stableHash(stableJson(issue.evidence ?? {})),
    recommendationHash: stableHash(issue.recommendation)
  };
}

export function buildBaselineFromReport(report: SitewideAuditReport, options: BuildBaselineOptions): SeoBaseline {
  const privacyMode = Boolean(options.privacyMode);
  const incoming = incomingCounts(report);
  const sitemap = new Set(report.sitemap.urls.map((url) => normalizeUrl(url)));
  const origin = new URL(report.audit.startUrl).origin;
  const pages = report.pages.map((page) => buildPage(page, incoming, sitemap, privacyMode)).sort((a, b) => a.key.localeCompare(b.key));
  const issues = report.issues.map((issue) => buildIssue(issue, privacyMode)).sort((a, b) => a.key.localeCompare(b.key));
  return seoBaselineSchema.parse({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    baseline: {
      name: options.name,
      createdAt: options.createdAt ?? new Date().toISOString(),
      sourceReportPath: options.sourceReportPath,
      startUrl: report.audit.startUrl,
      normalizedOrigin: origin,
      auditMode: "sitewide",
      toolVersion: options.toolVersion ?? "0.1.0"
    },
    configuration: {
      maxPages: typeof report.audit.configuration.maxPages === "number" ? report.audit.configuration.maxPages : undefined,
      maxDepth: typeof report.audit.configuration.maxDepth === "number" ? report.audit.configuration.maxDepth : undefined,
      renderMode: typeof report.audit.configuration.render === "string" ? report.audit.configuration.render : undefined,
      includeSubdomains: typeof report.audit.configuration.includeSubdomains === "boolean" ? report.audit.configuration.includeSubdomains : undefined,
      respectRobots: typeof report.audit.configuration.respectRobots === "boolean" ? report.audit.configuration.respectRobots : undefined
    },
    snapshot: {
      globalScore: report.summary.score,
      categoryScores: Object.fromEntries(Object.entries(report.categoryScores).sort(([a], [b]) => a.localeCompare(b))),
      pages,
      issues,
      metrics: {
        crawledPages: report.summary.crawledPages,
        discoveredUrls: report.summary.discoveredUrls,
        skippedUrls: report.summary.skippedUrls,
        blockedByRobots: report.summary.blockedByRobots,
        failedPages: report.summary.failedPages,
        sitemapUrls: report.crawlStats.sitemapUrls as number | undefined ?? report.sitemap.urls.length
      },
      performance: [...(report.performance ?? [])].sort((a, b) => `${a.source}:${a.device}:${a.url}`.localeCompare(`${b.source}:${b.device}:${b.url}`)),
      gsc: report.gsc
    }
  });
}

export async function buildBaselineFromReportFile(reportPath: string, options: BuildBaselineOptions): Promise<SeoBaseline> {
  const raw = JSON.parse(await readFile(reportPath, "utf8"));
  return buildBaselineFromReport(sitewideAuditReportSchema.parse(raw), { ...options, sourceReportPath: options.sourceReportPath ?? reportPath });
}

