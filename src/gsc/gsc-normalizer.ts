import { createHash } from "node:crypto";
import { normalizeUrl } from "../crawler/url-normalizer.js";
import { GSC_SCHEMA_VERSION, gscSearchAnalyticsResultSchema, type GscAuditResult, type GscDimension, type GscInspectionResult, type GscSearchAnalyticsResult, type GscSearchAnalyticsRow } from "./gsc-schema.js";
import type { RawInspectionResponse, RawSearchAnalyticsRow } from "./gsc-client.js";
import type { GscConfig } from "./gsc-config.js";

export function weightedTotals(rows: GscSearchAnalyticsRow[]): GscSearchAnalyticsResult["totals"] {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, weightedPosition };
}

export function redactQuery(query: string): string {
  return `query:${createHash("sha256").update(query).digest("hex").slice(0, 12)}`;
}

export function redactUrlPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.pathname = "/[redacted]";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function normalizeSearchAnalyticsRows(rows: RawSearchAnalyticsRow[], dimensions: GscDimension[], config?: Pick<GscConfig, "redactQueries" | "redactUrlPaths">): GscSearchAnalyticsRow[] {
  return rows.map((row) => {
    const keys: GscSearchAnalyticsRow["keys"] = {};
    dimensions.forEach((dimension, index) => {
      const raw = row.keys?.[index];
      if (raw === undefined) return;
      if (dimension === "page") keys.page = config?.redactUrlPaths ? redactUrlPath(raw) : normalizeUrl(raw);
      else if (dimension === "query") keys.query = config?.redactQueries ? redactQuery(raw) : raw;
      else keys[dimension] = raw;
    });
    const clicks = Number(row.clicks ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const ctr = row.ctr ?? (impressions ? clicks / impressions : 0);
    return { keys, clicks, impressions, ctr, position: Number(row.position ?? 0) };
  }).sort((a, b) => JSON.stringify(a.keys).localeCompare(JSON.stringify(b.keys)));
}

export function normalizeSearchAnalyticsResult(input: { property: string; config: GscConfig; rows: RawSearchAnalyticsRow[]; partial: boolean; warnings: string[]; fromCache?: boolean; aggregationType?: string; error?: GscSearchAnalyticsResult["error"] }): GscSearchAnalyticsResult {
  const rows = normalizeSearchAnalyticsRows(input.rows, input.config.dimensions, input.config);
  return gscSearchAnalyticsResultSchema.parse({
    schemaVersion: GSC_SCHEMA_VERSION,
    property: input.property,
    startDate: input.config.startDate,
    endDate: input.config.endDate,
    searchType: input.config.searchType,
    dimensions: input.config.dimensions,
    dataState: input.config.dataState,
    aggregationType: input.aggregationType ?? input.config.aggregationType,
    rowCount: rows.length,
    rows,
    totals: weightedTotals(rows),
    warnings: input.warnings,
    partial: input.partial,
    fromCache: Boolean(input.fromCache),
    error: input.error
  });
}

export function normalizeInspection(url: string, raw: RawInspectionResponse): GscInspectionResult {
  const result = raw.inspectionResult as { indexStatusResult?: Record<string, unknown>; mobileUsabilityResult?: Record<string, unknown>; richResultsResult?: Record<string, unknown> } | undefined;
  const index = result?.indexStatusResult ?? {};
  return {
    url,
    verdict: String(index.verdict ?? "UNKNOWN"),
    coverageState: typeof index.coverageState === "string" ? index.coverageState : undefined,
    indexingState: typeof index.indexingState === "string" ? index.indexingState : undefined,
    crawlAllowed: index.robotsTxtState === "ALLOWED" ? true : index.robotsTxtState === "BLOCKED" ? false : undefined,
    robotsTxtState: typeof index.robotsTxtState === "string" ? index.robotsTxtState : undefined,
    googleCanonical: typeof index.googleCanonical === "string" ? normalizeUrl(index.googleCanonical) : undefined,
    userCanonical: typeof index.userCanonical === "string" ? normalizeUrl(index.userCanonical) : undefined,
    lastCrawlTime: typeof index.lastCrawlTime === "string" ? index.lastCrawlTime : undefined,
    pageFetchState: typeof index.pageFetchState === "string" ? index.pageFetchState : undefined,
    mobileUsability: typeof result?.mobileUsabilityResult?.verdict === "string" ? result.mobileUsabilityResult.verdict : undefined,
    richResults: typeof result?.richResultsResult?.verdict === "string" ? result.richResultsResult.verdict : undefined,
    partial: false
  };
}

export function emptyGscResult(warnings: string[] = []): GscAuditResult {
  return { schemaVersion: GSC_SCHEMA_VERSION, enabled: false, source: "none", propertyCompatibility: "not-checked", privacyMode: false, urlMatches: [], pageData: {}, inspections: [], opportunities: [], warnings, partial: false };
}