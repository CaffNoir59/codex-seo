import type { CrawlResult } from "../crawler/crawl-result.js";
import { analyzeGscContentDecay } from "../analyzers/gsc-content-decay.js";
import { analyzeGscOpportunities } from "../analyzers/gsc-opportunities.js";
import { GoogleSearchConsoleClient, MockGscClient, type GscClient } from "./gsc-client.js";
import { resolveGscConfig, type GscConfig } from "./gsc-config.js";
import { GSC_SCHEMA_VERSION, gscAuditResultSchema, type GscAuditResult } from "./gsc-schema.js";
import { toGscError } from "./gsc-errors.js";
import { inspectPropertyAccess } from "./gsc-property.js";
import { fetchSearchAnalytics } from "./search-analytics-adapter.js";
import { compareGscPeriods } from "./period-comparison.js";
import { matchGscUrlsToCrawl } from "./gsc-url-matcher.js";
import { inspectUrls, selectInspectionUrls } from "./url-inspection-adapter.js";

export type RunGscInput = Partial<Record<string, unknown>> & { auditUrl: string; crawl?: CrawlResult; reportDir?: string; client?: GscClient };

export async function runGsc(input: RunGscInput): Promise<GscAuditResult> {
  const config: GscConfig = resolveGscConfig(input);
  if (!config.enabled) return { schemaVersion: GSC_SCHEMA_VERSION, enabled: false, source: "none", propertyCompatibility: "not-checked", privacyMode: config.privacyMode, urlMatches: [], pageData: {}, inspections: [], opportunities: [], warnings: [], partial: false };
  const property = config.property;
  if (!property) {
    const result = { schemaVersion: GSC_SCHEMA_VERSION, enabled: true, source: "none" as const, propertyCompatibility: "not-checked" as const, privacyMode: config.privacyMode, urlMatches: [], pageData: {}, inspections: [], opportunities: [], warnings: ["GSC enabled but no property was provided"], partial: true, error: { code: "gsc.property-missing", message: "GSC property is required when --gsc is enabled", retryable: false } };
    if (config.requireGscData) throw new Error(result.error.message);
    return gscAuditResultSchema.parse(result);
  }
  const client = input.client ?? (config.mock ? new MockGscClient() : new GoogleSearchConsoleClient({ mode: config.authMode, credentialsPath: config.credentialsPath, privacyMode: config.privacyMode, reportDir: input.reportDir }));
  const warnings: string[] = [];
  try {
    const access = await inspectPropertyAccess(client, property, input.auditUrl);
    warnings.push(...access.warnings);
    const current = await fetchSearchAnalytics(client, property, config);
    let previous;
    let comparison;
    if (config.comparePeriod && config.previousStartDate && config.previousEndDate) {
      const prevConfig = { ...config, startDate: config.previousStartDate, endDate: config.previousEndDate };
      previous = await fetchSearchAnalytics(client, property, prevConfig);
      comparison = compareGscPeriods(previous, current);
    }
    const match = input.crawl ? matchGscUrlsToCrawl(current, input.crawl.pages) : { matches: [], pageData: {} };
    const inspectionTargets = input.crawl ? selectInspectionUrls(input.crawl.pages, match.pageData, config) : [];
    const inspections = inspectionTargets.length ? await inspectUrls(client, property, inspectionTargets) : [];
    const opportunities = [...analyzeGscOpportunities({ schemaVersion: GSC_SCHEMA_VERSION, enabled: true, property, propertyCompatibility: access.status, authMode: config.authMode, privacyMode: config.privacyMode, source: config.mock ? "mock" : current.fromCache ? "cache" : "api", searchAnalytics: current, previousSearchAnalytics: previous, periodComparison: comparison, urlMatches: match.matches, pageData: match.pageData, inspections, opportunities: [], warnings, partial: current.partial }, input.crawl?.pages), ...analyzeGscContentDecay(comparison)];
    const score = Math.max(0, 100 - Math.min(60, opportunities.reduce((sum, item) => sum + item.priority.priorityScore / 12, 0)));
    return gscAuditResultSchema.parse({ schemaVersion: GSC_SCHEMA_VERSION, enabled: true, property, propertyCompatibility: access.status, authMode: config.authMode, privacyMode: config.privacyMode, source: config.mock ? "mock" : current.fromCache ? "cache" : "api", searchAnalytics: current, previousSearchAnalytics: previous, periodComparison: comparison, urlMatches: match.matches, pageData: match.pageData, inspections, opportunities, score: Math.round(score), warnings, partial: current.partial || Boolean(previous?.partial) });
  } catch (error) {
    const normalized = toGscError(error, "gsc.run-failed");
    if (config.requireGscData) throw error;
    return gscAuditResultSchema.parse({ schemaVersion: GSC_SCHEMA_VERSION, enabled: true, property, propertyCompatibility: "inaccessible", authMode: config.authMode, privacyMode: config.privacyMode, source: config.mock ? "mock" : "none", urlMatches: [], pageData: {}, inspections: [], opportunities: [], warnings: [normalized.message], partial: true, error: normalized });
  }
}