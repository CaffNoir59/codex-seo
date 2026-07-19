#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runAudit } from "../orchestrator/audit.js";
import { crawlSite } from "../crawler/crawler.js";
import { renderModes } from "../crawler/crawl-config.js";
import { buildBaselineFromReport } from "../baseline/baseline-builder.js";
import { loadBaselineByName, safeBaselineName, saveBaseline } from "../baseline/baseline-storage.js";
import { compareBaselines, compareReportFiles, coerceBaseline } from "../diff/compare-reports.js";
import { mergeGateOptions, loadDiffConfig, type DiffGateOptions } from "../diff/quality-gate.js";
import { performanceDevices, performanceModes, performanceStrategies, localPerformanceEngines, type PerformanceResult } from "../performance/performance-schema.js";
import { runPerformanceForUrl, resolvePerformanceConfig } from "../performance/performance-runner.js";
import { selectPerformancePages } from "../performance/performance-selector.js";
import { buildSitewideReport, writeSitewideReport } from "../reporting/sitewide-report.js";
import { writeDiffReport } from "../reporting/diff-json-report.js";
import { runGsc } from "../gsc/gsc-runner.js";
import { GoogleSearchConsoleClient, MockGscClient } from "../gsc/gsc-client.js";
import { inspectPropertyAccess } from "../gsc/gsc-property.js";
import type { GscAuditResult } from "../gsc/gsc-schema.js";
import { HistoryStore } from "../history/history-store.js";
import { parseHistorySourceFile, historyEntryFromReport } from "../history/history-entry.js";
import { queryHistory } from "../history/history-query.js";
import { validateHistory } from "../history/history-validation.js";
import { exportHistory, importHistory } from "../history/history-export.js";
import { migrateHistorySource } from "../history/history-migration.js";
import { pruneHistory } from "../history/history-prune.js";
import { buildTrendReport } from "../trends/trend-engine.js";
import { trendMetrics, type TrendMetric } from "../trends/trend-metrics.js";
import { writeTrendReport } from "../reporting/trend-report.js";
import { formatTrendConsole } from "../reporting/trend-console.js";
import { compactHistoryList } from "../reporting/history-report.js";
import { compareReleases } from "../analyzers/release-impact.js";
import { compareEnvironments } from "../analyzers/environment-comparison.js";
import { compareHistoryCompatibility } from "../history/history-compatibility.js";
import { getVersion } from "../version.js";
import { initProject, formatInitResult } from "../config/init.js";
import { validateConfigFile } from "../config/config-loader.js";
import { runDoctor, formatDoctor } from "../doctor/doctor.js";
import { writeCiExport } from "../ci/ci-export.js";
import { migrateSchema } from "../schemas/schema-migrations.js";
import { validateSchema } from "../schemas/schema-registry.js";
import { readFile } from "node:fs/promises";
import { configureProject } from "../project/configure.js";
import { pluginDoctor, updateProjectPlugin } from "../plugin/manage.js";

const program = new Command();
const EXIT_RUNTIME_ERROR = 1;
const EXIT_GATE_FAILED = 2;
const EXIT_STRICT_INCOMPATIBLE = 3;
if (Number(process.versions.node.split(".")[0]) < 20) { console.error(JSON.stringify({ ok: false, error: `Codex SEO requires Node.js >=20. Current: ${process.versions.node}` }, null, 2)); process.exit(EXIT_RUNTIME_ERROR); }

function envRaw(name: string): string | undefined { return process.env[name] ?? process.env[name.replace(/_/g, "-")]; }
function envFlag(name: string): boolean { return envRaw(name) === "true"; }
function envValue(name: string): string | undefined { const value = envRaw(name); return value && value !== "true" ? value : undefined; }
function collect(value: string, previous: string[] = []): string[] { return [...previous, value]; }
function valueExtras(): string[] { return process.argv.slice(4).filter((value) => !value.startsWith("-")); }
function numericExtras(): string[] { return valueExtras().filter((value) => /^\d+$/.test(value)); }
function textExtras(): string[] { return valueExtras().filter((value) => !/^\d+$/.test(value)); }
function collectTag(value: string, previous: Record<string, string> = {}): Record<string, string> { const [key, ...rest] = value.split("="); return key ? { ...previous, [key]: rest.join("=") } : previous; }
function parsePositiveInt(name: string, value: unknown, options: { allowZero?: boolean; max?: number } = {}): number {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(text);
  if ((!options.allowZero && parsed <= 0) || (options.allowZero && parsed < 0)) throw new Error(`${name} must be ${options.allowZero ? "non-negative" : "positive"}`);
  if (options.max !== undefined && parsed > options.max) throw new Error(`${name} must be <= ${options.max}`);
  return parsed;
}
function parseOptionalNumber(value: unknown): number | undefined { return value === undefined ? undefined : Number(value); }
function parseEnum<T extends readonly string[]>(name: string, value: unknown, allowed: T): T[number] {
  const text = String(value ?? "");
  if (!allowed.includes(text)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  return text as T[number];
}
function parseRenderMode(value: unknown): "auto" | "always" | "never" { return parseEnum("render", value ?? "auto", renderModes); }
function preferredNumber(envName: string, optionValue: string | undefined, fallback: string | undefined): string | undefined {
  const value = process.env[envName];
  if (value === undefined) return optionValue ?? fallback;
  if (value === "true") return fallback ?? optionValue;
  return value;
}
async function gateOptions(cli: Partial<DiffGateOptions>): Promise<DiffGateOptions> { return mergeGateOptions(await loadDiffConfig(), cli); }
function cliGateOptions(options: { failOnRegression?: boolean; maxScoreDrop?: string; maxNewHigh?: string; maxNewCritical?: string; maxBrokenLinksIncrease?: string; minPerformanceScore?: string; maxLcp?: string; maxInp?: string; maxCls?: string; maxTbt?: string; maxTtfb?: string; maxPerformanceScoreDrop?: string; maxLcpRegression?: string; maxClsRegression?: string; requireOfficialLighthouse?: boolean; requireFieldData?: boolean; maxPerformanceVariance?: string; maxUnusedJavascriptBytes?: string; maxTotalTransferBytes?: string; maxRequestCount?: string; maxClickDropPercent?: string; maxImpressionDropPercent?: string; maxTrafficPagesWithErrors?: string; maxHighImpactRegressions?: string; minGscClicks?: string; requireGscData?: boolean; requireGscFinalData?: boolean; ignoreRule?: string[]; ignoreUrl?: string[]; ignoreCategory?: string[]; severityThreshold?: string; includeOnly?: string; strictCompatibility?: boolean }): Partial<DiffGateOptions> {
  return {
    failOnRegression: options.failOnRegression,
    maxScoreDrop: parseOptionalNumber(options.maxScoreDrop),
    maxNewHigh: options.maxNewHigh === undefined ? undefined : Number(options.maxNewHigh),
    maxNewCritical: options.maxNewCritical === undefined ? undefined : Number(options.maxNewCritical),
    maxBrokenLinksIncrease: options.maxBrokenLinksIncrease === undefined ? undefined : Number(options.maxBrokenLinksIncrease),
    minPerformanceScore: options.minPerformanceScore === undefined ? undefined : Number(options.minPerformanceScore),
    maxLcp: options.maxLcp === undefined ? undefined : Number(options.maxLcp),
    maxInp: options.maxInp === undefined ? undefined : Number(options.maxInp),
    maxCls: options.maxCls === undefined ? undefined : Number(options.maxCls),
    maxTbt: options.maxTbt === undefined ? undefined : Number(options.maxTbt),
    maxTtfb: options.maxTtfb === undefined ? undefined : Number(options.maxTtfb),
    maxPerformanceScoreDrop: options.maxPerformanceScoreDrop === undefined ? undefined : Number(options.maxPerformanceScoreDrop),
    maxLcpRegressionMs: options.maxLcpRegression === undefined ? undefined : Number(options.maxLcpRegression),
    maxClsRegression: options.maxClsRegression === undefined ? undefined : Number(options.maxClsRegression),
    requireOfficialLighthouse: options.requireOfficialLighthouse,
    requireFieldData: options.requireFieldData,
    maxPerformanceVariance: options.maxPerformanceVariance === undefined ? undefined : Number(options.maxPerformanceVariance),
    maxUnusedJavascriptBytes: options.maxUnusedJavascriptBytes === undefined ? undefined : Number(options.maxUnusedJavascriptBytes),
    maxTotalTransferBytes: options.maxTotalTransferBytes === undefined ? undefined : Number(options.maxTotalTransferBytes),
    maxRequestCount: options.maxRequestCount === undefined ? undefined : Number(options.maxRequestCount),
    maxClickDropPercent: options.maxClickDropPercent === undefined ? undefined : Number(options.maxClickDropPercent),
    maxImpressionDropPercent: options.maxImpressionDropPercent === undefined ? undefined : Number(options.maxImpressionDropPercent),
    maxTrafficPagesWithErrors: options.maxTrafficPagesWithErrors === undefined ? undefined : Number(options.maxTrafficPagesWithErrors),
    maxHighImpactRegressions: options.maxHighImpactRegressions === undefined ? undefined : Number(options.maxHighImpactRegressions),
    minGscClicks: options.minGscClicks === undefined ? undefined : Number(options.minGscClicks),
    requireGscData: options.requireGscData,
    requireGscFinalData: options.requireGscFinalData,
    ignoredRules: options.ignoreRule,
    ignoredUrls: options.ignoreUrl,
    ignoredCategories: options.ignoreCategory,
    severityThreshold: options.severityThreshold,
    includeOnly: options.includeOnly?.split(",").map((item) => item.trim()).filter(Boolean),
    strictCompatibility: (options.strictCompatibility || envFlag("npm_config_strict_compatibility"))
  };
}
function performanceOptions(options: AuditOptions, fixtureLocal: boolean) {
  const keyEnv = options.pagespeedApiKeyEnv ?? envValue("npm_config_pagespeed_api_key_env");
  const apiKey = options.pagespeedApiKey ?? envValue("npm_config_pagespeed_api_key") ?? (keyEnv ? process.env[keyEnv] : undefined);
  return resolvePerformanceConfig({
    enabled: Boolean(options.performance || envFlag("npm_config_performance")),
    mode: parseEnum("performance-mode", envValue("npm_config_performance_mode") ?? options.performanceMode ?? "local", performanceModes),
    device: parseEnum("performance-device", envValue("npm_config_performance_device") ?? options.performanceDevice ?? "mobile", performanceDevices),
    runs: parsePositiveInt("performance-runs", envValue("npm_config_performance_runs") ?? options.performanceRuns ?? "1", { max: 5 }),
    concurrency: parsePositiveInt("performance-concurrency", envValue("npm_config_performance_concurrency") ?? options.performanceConcurrency ?? "1", { max: 4 }),
    timeoutMs: parsePositiveInt("performance-timeout", envValue("npm_config_performance_timeout") ?? options.performanceTimeout ?? "60000"),
    samplePages: parsePositiveInt("performance-sample-pages", envValue("npm_config_performance_sample_pages") ?? options.performanceSamplePages ?? "10"),
    strategy: parseEnum("performance-strategy", envValue("npm_config_performance_strategy") ?? options.performanceStrategy ?? "important", performanceStrategies),
    includePatterns: options.performanceIncludeUrl ?? [],
    excludePatterns: options.performanceExcludeUrl ?? [],
    pagespeedApiKey: apiKey,
    localEngine: parseEnum("local-performance-engine", envValue("npm_config_local_performance_engine") ?? options.localPerformanceEngine ?? "auto", localPerformanceEngines),
    chromePath: options.chromePath ?? envValue("npm_config_chrome_path"),
    requireOfficialLighthouse: Boolean(options.requireOfficialLighthouse || envFlag("npm_config_require_official_lighthouse")),
    requireFieldData: Boolean(options.requireFieldData || envFlag("npm_config_require_field_data")),
    cache: !fixtureLocal
  });
}
function performanceGateReasons(results: PerformanceResult[], options: AuditOptions): string[] {
  const reasons: string[] = [];
  const numberOption = (value: string | undefined, env: string): number | undefined => {
    const raw = envValue(env) ?? value;
    return raw === undefined ? undefined : Number(raw);
  };
  const requireOfficial = Boolean(options.requireOfficialLighthouse || envFlag("npm_config_require_official_lighthouse"));
  const requireField = Boolean(options.requireFieldData || envFlag("npm_config_require_field_data"));
  if (requireOfficial && results.some((result) => result.scoreKind !== "official-lighthouse")) reasons.push("Official Lighthouse result is required but at least one result is not official Lighthouse");
  if (requireField && results.every((result) => result.scoreKind !== "field-data" || !result.fieldData?.metrics)) reasons.push("Field data is required but CrUX field data is missing");
  const maxVariance = numberOption(options.maxPerformanceVariance, "npm_config_max_performance_variance");
  if (maxVariance !== undefined && results.some((result) => (result.statistics?.coefficientOfVariation ?? 0) > maxVariance)) reasons.push(`Performance variance exceeded ${maxVariance}`);
  const maxUnusedJs = numberOption(options.maxUnusedJavascriptBytes, "npm_config_max_unused_javascript_bytes");
  if (maxUnusedJs !== undefined && results.some((result) => (result.diagnostics?.unusedJavascriptBytes ?? 0) > maxUnusedJs)) reasons.push(`Unused JavaScript exceeded ${maxUnusedJs} bytes`);
  const maxTransfer = numberOption(options.maxTotalTransferBytes, "npm_config_max_total_transfer_bytes");
  if (maxTransfer !== undefined && results.some((result) => (result.resources?.transferBytes ?? 0) > maxTransfer)) reasons.push(`Total transfer exceeded ${maxTransfer} bytes`);
  const maxRequests = numberOption(options.maxRequestCount, "npm_config_max_request_count");
  if (maxRequests !== undefined && results.some((result) => (result.resources?.requestCount ?? 0) > maxRequests)) reasons.push(`Request count exceeded ${maxRequests}`);
  return reasons;
}
function gscRawOptions(options: AuditOptions, auditUrl: string, reportDir?: string) {
  return {
    enabled: Boolean(options.gsc || envFlag("npm_config_gsc")),
    auditUrl,
    reportDir,
    property: options.gscProperty ?? envValue("npm_config_gsc_property"),
    credentialsPath: options.gscCredentials ?? envValue("npm_config_gsc_credentials"),
    authMode: options.gscAuthMode ?? envValue("npm_config_gsc_auth_mode"),
    startDate: options.gscStartDate ?? envValue("npm_config_gsc_start_date"),
    endDate: options.gscEndDate ?? envValue("npm_config_gsc_end_date"),
    days: options.gscDays ?? envValue("npm_config_gsc_days"),
    comparePeriod: Boolean(options.gscComparePeriod || envFlag("npm_config_gsc_compare_period")),
    searchType: options.gscSearchType ?? envValue("npm_config_gsc_search_type"),
    dimensions: options.gscDimensions ?? envValue("npm_config_gsc_dimensions"),
    rowLimit: options.gscRowLimit ?? envValue("npm_config_gsc_row_limit"),
    dataState: options.gscDataState ?? envValue("npm_config_gsc_data_state"),
    aggregationType: options.gscAggregate ?? envValue("npm_config_gsc_aggregate"),
    includeQuery: options.gscIncludeQuery ?? [],
    excludeQuery: options.gscExcludeQuery ?? [],
    includePage: options.gscIncludePage ?? [],
    excludePage: options.gscExcludePage ?? [],
    brandQuery: options.gscBrandQuery ?? [],
    nonBrand: Boolean(options.gscNonBrand || envFlag("npm_config_gsc_non_brand")),
    cacheTtlSeconds: options.gscCacheTtl ?? envValue("npm_config_gsc_cache_ttl"),
    requireGscData: Boolean(options.requireGscData || envFlag("npm_config_require_gsc_data")),
    requireGscFinalData: Boolean(options.requireGscFinalData || envFlag("npm_config_require_gsc_final_data")),
    inspectUrls: options.gscInspectUrls ?? envValue("npm_config_gsc_inspect_urls"),
    inspectionStrategy: options.gscInspectionStrategy ?? envValue("npm_config_gsc_inspection_strategy"),
    privacyMode: Boolean(options.gscPrivacyMode || options.privacyMode || envFlag("npm_config_gsc_privacy_mode")),
    redactQueries: Boolean(options.gscRedactQueries || envFlag("npm_config_gsc_redact_queries")),
    redactUrlPaths: Boolean(options.gscRedactUrlPaths || envFlag("npm_config_gsc_redact_url_paths"))
  };
}
function gscGateReasons(gsc: GscAuditResult | undefined, options: AuditOptions): string[] {
  const reasons: string[] = [];
  if (!gsc?.enabled) return reasons;
  const numberOption = (value: string | undefined, env: string): number | undefined => { const raw = envValue(env) ?? value; return raw === undefined ? undefined : Number(raw); };
  if ((options.requireGscData || envFlag("npm_config_require_gsc_data")) && (!gsc.searchAnalytics || gsc.searchAnalytics.rowCount === 0)) reasons.push("GSC data is required but missing");
  if ((options.requireGscFinalData || envFlag("npm_config_require_gsc_final_data")) && gsc.searchAnalytics?.dataState !== "final") reasons.push("Final GSC data is required");
  const minClicks = numberOption(options.minGscClicks, "npm_config_min_gsc_clicks") ?? 0;
  const clicksDrop = gsc.periodComparison?.totals.clicks.relativeDelta;
  const maxClickDrop = numberOption(options.maxClickDropPercent, "npm_config_max_click_drop_percent");
  if (maxClickDrop !== undefined && gsc.periodComparison?.compatible && (gsc.periodComparison.totals.clicks.previous ?? 0) >= minClicks && clicksDrop !== undefined && clicksDrop < -maxClickDrop / 100 && gsc.periodComparison.confidence !== "low") reasons.push(`GSC click drop exceeded ${maxClickDrop}%`);
  const impressionDrop = gsc.periodComparison?.totals.impressions.relativeDelta;
  const maxImpressionDrop = numberOption(options.maxImpressionDropPercent, "npm_config_max_impression_drop_percent");
  if (maxImpressionDrop !== undefined && gsc.periodComparison?.compatible && impressionDrop !== undefined && impressionDrop < -maxImpressionDrop / 100 && gsc.periodComparison.confidence !== "low") reasons.push(`GSC impression drop exceeded ${maxImpressionDrop}%`);
  const maxTrafficErrors = numberOption(options.maxTrafficPagesWithErrors, "npm_config_max_traffic_pages_with_errors");
  if (maxTrafficErrors !== undefined) {
    const count = gsc.opportunities.filter((item) => /traffic-page-(http-error|not-indexable|canonical-conflict)/.test(item.ruleId)).length;
    if (count > maxTrafficErrors) reasons.push(`Traffic pages with technical errors exceeded ${maxTrafficErrors}`);
  }
  const maxHighImpact = numberOption(options.maxHighImpactRegressions, "npm_config_max_high_impact_regressions");
  if (maxHighImpact !== undefined) {
    const count = gsc.opportunities.filter((item) => item.priority.priorityScore >= 75).length;
    if (count > maxHighImpact) reasons.push(`High-impact GSC regressions exceeded ${maxHighImpact}`);
  }
  return reasons;
}
function historyIdentityOptions(options: AuditOptions) {
  return {
    historyId: options.historyId,
    name: options.historyName,
    environment: options.environment,
    release: options.release,
    commit: options.commit,
    branch: options.branch,
    tags: options.tag,
    notes: options.notes,
    privacyMode: Boolean(options.privacyMode || options.gscPrivacyMode)
  };
}
function confidenceRank(value: string | undefined): number { return value === "high" ? 3 : value === "medium" ? 2 : value === "low" ? 1 : 0; }
function historicalGateReasons(report: Awaited<ReturnType<typeof buildTrendReport>>, options: AuditOptions): string[] {
  const reasons: string[] = [];
  const numberOption = (value: string | undefined, env: string): number | undefined => { const raw = envValue(env) ?? value; return raw === undefined ? undefined : Number(raw); };
  const score = report.series.find((item) => item.metric === "seo.score");
  const lighthouse = report.series.find((item) => item.metric === "performance.lighthouseScore");
  const lcp = report.series.find((item) => item.metric === "performance.lcpMs");
  const critical = report.series.find((item) => item.metric === "seo.issues.critical");
  const clicks = report.series.find((item) => item.metric === "gsc.clicks");
  const maxSeoDrop = numberOption(options.maxSeoScoreDropOverLast, "npm_config_max_seo_score_drop_over_last");
  if (maxSeoDrop !== undefined && (score?.absoluteDelta ?? 0) < -maxSeoDrop) reasons.push(`Historical SEO score drop exceeded ${maxSeoDrop}`);
  const maxLighthouseDrop = numberOption(options.maxLighthouseScoreDropOverLast, "npm_config_max_lighthouse_score_drop_over_last");
  if (maxLighthouseDrop !== undefined && (lighthouse?.absoluteDelta ?? 0) < -maxLighthouseDrop) reasons.push(`Historical Lighthouse score drop exceeded ${maxLighthouseDrop}`);
  const maxLcp = numberOption(options.maxLcpRegressionOverLast, "npm_config_max_lcp_regression_over_last");
  if (maxLcp !== undefined && (lcp?.absoluteDelta ?? 0) > maxLcp) reasons.push(`Historical LCP regression exceeded ${maxLcp} ms`);
  const maxCritical = numberOption(options.maxNewCriticalOverLast, "npm_config_max_new_critical_over_last");
  if (maxCritical !== undefined && (critical?.absoluteDelta ?? 0) > maxCritical) reasons.push(`Historical new critical issues exceeded ${maxCritical}`);
  const clickDrop = numberOption(options.maxClickDropOverPeriod, "npm_config_max_click_drop_over_period");
  if (clickDrop !== undefined && (clicks?.relativeDelta ?? 0) < -clickDrop / 100) reasons.push(`Historical GSC click drop exceeded ${clickDrop}%`);
  const requiredPoints = numberOption(options.requireHistoryPoints, "npm_config_require_history_points");
  if (requiredPoints !== undefined && report.entries < requiredPoints) reasons.push(`History requires at least ${requiredPoints} point(s)`);
  const minConfidence = options.requireHistoryConfidence ?? envValue("npm_config_require_history_confidence");
  if (minConfidence && confidenceRank(report.confidence) < confidenceRank(minConfidence)) reasons.push(`History confidence below ${minConfidence}`);
  const maxRecurring = numberOption(options.maxRecurringRegressions, "npm_config_max_recurring_regressions");
  if (maxRecurring !== undefined && report.recurringIssues.filter((item) => item.regressionCount > 0).length > maxRecurring) reasons.push(`Recurring regressions exceeded ${maxRecurring}`);
  if (options.failOnNegativeTrend || envFlag("npm_config_fail_on_negative_trend")) {
    const negative = report.series.filter((item) => item.direction === "degradation" || item.direction === "strong-degradation");
    if (negative.length) reasons.push(`Negative trend detected: ${negative.map((item) => item.metric).join(", ")}`);
  }
  return reasons;
}
async function buildHistoryTrend(options: AuditOptions, store = new HistoryStore({ root: options.historyDir ?? envValue("npm_config_history_dir") })) {
  const filter = historyFilterOptions(options);
  const entries = await queryHistory(filter, store);
  const metrics = trendMetricOptions(options.trendMetric);
  const report = buildTrendReport(entries, { metrics, since: filter.since, until: filter.until, minConfidence: options.trendMinConfidence as never });
  const gateReasons = historicalGateReasons(report, options);
  return { ...report, gate: { passed: gateReasons.length === 0, reasons: gateReasons } };
}
function formatAuditSummary(input: { mode: string; startUrl: string; discoveredPages: number; crawledPages: number; skippedPages: number; blockedByRobots: number; failedPages: number; durationMs: number; score: number; files: string[]; performanceCount?: number; gsc?: GscAuditResult; baselineFile?: string; diffFiles?: string[]; gatePassed?: boolean; gateReasons?: string[] }): string {
  return [`Mode: ${input.mode}`, `URL de depart: ${input.startUrl}`, `Pages decouvertes: ${input.discoveredPages}`, `Pages crawlees: ${input.crawledPages}`, `Pages ignorees: ${input.skippedPages}`, `Pages bloquees par robots: ${input.blockedByRobots}`, `Pages en erreur: ${input.failedPages}`, `Duree: ${input.durationMs}ms`, `Score: ${input.score}`, input.performanceCount !== undefined ? `Performance analyses: ${input.performanceCount}` : "", input.gsc?.enabled ? `GSC property: ${input.gsc.property ?? "n/a"}` : "", input.gsc?.searchAnalytics ? `GSC clicks: ${input.gsc.searchAnalytics.totals.clicks}` : "", input.gsc?.searchAnalytics ? `GSC impressions: ${input.gsc.searchAnalytics.totals.impressions}` : "", input.gsc?.opportunities.length ? `GSC opportunities: ${input.gsc.opportunities.length}` : "", input.baselineFile ? `Baseline: ${input.baselineFile}` : "", input.gatePassed !== undefined ? `Quality gate: ${input.gatePassed ? "PASSED" : "FAILED"}` : "", ...(input.gateReasons?.length ? ["Reasons:", ...input.gateReasons.map((reason) => `- ${reason}`)] : []), "Chemins des rapports generes:", ...input.files.map((file) => `- ${file}`), ...(input.diffFiles?.length ? ["Diff reports:", ...input.diffFiles.map((file) => `- ${file}`)] : [])].filter(Boolean).join("\n");

}
function formatDiffSummary(report: Awaited<ReturnType<typeof compareReportFiles>>, files: string[]): string {
  return [`SEO comparison completed`, ``, `Baseline: ${report.comparison.baselineName ?? "n/a"}`, `Previous score: ${report.summary.previousScore}`, `Current score: ${report.summary.currentScore}`, `Delta: ${report.summary.scoreDelta}`, ``, `Pages added: ${report.summary.pagesAdded}`, `Pages removed: ${report.summary.pagesRemoved}`, `Pages changed: ${report.pages.changed.length}`, ``, `Issues introduced: ${report.summary.issuesIntroduced}`, `Issues resolved: ${report.summary.issuesResolved}`, `New critical issues: ${report.issues.introduced.filter((issue) => issue.severity === "critical" && !issue.ignored).length}`, `New high issues: ${report.issues.introduced.filter((issue) => issue.severity === "high" && !issue.ignored).length}`, `Performance changes: ${report.performanceChanges.length}`, `GSC changes: ${report.gscChanges.length}`, ``, `Quality gate: ${report.gate.passed ? "PASSED" : "FAILED"}`, ...(report.gate.reasons.length ? ["Reasons:", ...report.gate.reasons.map((reason) => `- ${reason}`)] : []), ``, `Reports:`, ...files.map((file) => `- ${file}`)].join("\n");

}
async function runDiffOrExit(run: () => Promise<{ report: Awaited<ReturnType<typeof compareReportFiles>>; files: string[] }>): Promise<void> {
  try { const { report, files } = await run(); console.log(formatDiffSummary(report, files)); if (!report.gate.passed) process.exit(EXIT_GATE_FAILED); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); console.error(JSON.stringify({ ok: false, error: message }, null, 2)); process.exit(/strict mode|incompatible/i.test(message) ? EXIT_STRICT_INCOMPATIBLE : EXIT_RUNTIME_ERROR); }
}

function trendMetricOptions(value: unknown): TrendMetric[] | undefined {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length) return undefined;
  const allowed = new Set<string>(trendMetrics);
  const invalid = values.filter((item) => !allowed.has(item));
  if (invalid.length) throw new Error(`Unknown trend metric(s): ${invalid.join(", ")}`);
  return values as TrendMetric[];
}
function historyFilterOptions(options: AuditOptions) {
  return {
    since: options.trendSince ?? options.since,
    until: options.trendUntil ?? options.until,
    environment: options.trendEnvironment ?? envValue("npm_config_trend_environment") ?? options.environment ?? envValue("npm_config_environment"),
    branch: options.trendBranch ?? envValue("npm_config_trend_branch") ?? options.branch ?? envValue("npm_config_branch"),
    release: options.trendRelease ?? envValue("npm_config_trend_release") ?? options.release ?? envValue("npm_config_release"),
    origin: options.origin ?? envValue("npm_config_origin"),
    last: options.trendLast ?? envValue("npm_config_trend_last") ?? options.last ?? envValue("npm_config_last") ? Number(options.trendLast ?? envValue("npm_config_trend_last") ?? options.last ?? envValue("npm_config_last")) : undefined,
    includePartial: Boolean(options.trendIncludePartial ?? options.includePartial),
    sort: "asc" as const
  };
}
function hasHistoricalGateOptions(options: AuditOptions): boolean {
  return Boolean(options.maxSeoScoreDropOverLast || options.maxLighthouseScoreDropOverLast || options.maxLcpRegressionOverLast || options.maxNewCriticalOverLast || options.maxRecurringRegressions || options.maxClickDropOverPeriod || options.requireHistoryPoints || options.requireHistoryConfidence || options.failOnNegativeTrend || envFlag("npm_config_fail_on_negative_trend"));
}
async function writeJsonOutput(payload: unknown, output: string | undefined): Promise<string[]> {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (!output) { console.log(text.trimEnd()); return []; }
  await mkdir(path.dirname(output) || ".", { recursive: true });
  await writeFile(output, text, "utf8");
  return [output];
}
function requireValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function ciMarkdown(report: Awaited<ReturnType<typeof buildHistoryTrend>>): string {
  const line = (metric: TrendMetric) => {
    const item = report.series.find((series) => series.metric === metric);
    if (!item) return `| ${metric} | n/a | n/a | n/a | n/a |`;
    return `| ${metric} | ${item.first ?? "n/a"} | ${item.latest ?? "n/a"} | ${item.absoluteDelta ?? "n/a"} | ${item.direction} |`;
  };
  return [`# Codex SEO Historical Summary`, ``, `Entries: ${report.entries}`, `Compatible entries: ${report.compatibleEntries}`, `Confidence: ${report.confidence}`, `Gate: ${report.gate?.passed === false ? "FAILED" : "PASSED"}`, ``, `| Metric | First | Latest | Delta | Direction |`, `| --- | ---: | ---: | ---: | --- |`, line("seo.score"), line("performance.lighthouseScore"), line("performance.lcpMs"), line("gsc.clicks"), ``, `Recurring regressions: ${report.recurringIssues.filter((item) => item.regressionCount > 0).length}`, ...(report.gate?.reasons.length ? [``, `## Gate Reasons`, ...report.gate.reasons.map((reason) => `- ${reason}`)] : [])].join("\n");
}
type AuditOptions = { render?: string | boolean; pdf?: boolean; crawl?: boolean; allowPrivateNetwork?: boolean; allowLocalhost?: boolean; maxPages?: string; maxDepth?: string; concurrency?: string; includeSubdomains?: boolean; ignoreRobots?: boolean; cache?: boolean; output: string; saveBaseline?: string | true; compareBaseline?: string; baselineDir?: string; overwriteBaseline?: boolean; privacyMode?: boolean; failOnRegression?: boolean; maxScoreDrop?: string; maxNewHigh?: string; maxNewCritical?: string; maxBrokenLinksIncrease?: string; strictCompatibility?: boolean; performance?: boolean; performanceMode?: string; performanceDevice?: string; performanceRuns?: string; performanceConcurrency?: string; performanceTimeout?: string; performanceSamplePages?: string; performanceStrategy?: string; performanceIncludeUrl?: string[]; performanceExcludeUrl?: string[]; pagespeedApiKey?: string; pagespeedApiKeyEnv?: string; minPerformanceScore?: string; maxLcp?: string; maxInp?: string; maxCls?: string; maxTbt?: string; maxTtfb?: string; maxPerformanceScoreDrop?: string; maxLcpRegression?: string; maxClsRegression?: string; localPerformanceEngine?: string; chromePath?: string; requireOfficialLighthouse?: boolean; requireFieldData?: boolean; maxPerformanceVariance?: string; maxUnusedJavascriptBytes?: string; maxTotalTransferBytes?: string; maxRequestCount?: string; gsc?: boolean; gscProperty?: string; gscCredentials?: string; gscAuthMode?: string; gscStartDate?: string; gscEndDate?: string; gscDays?: string; gscComparePeriod?: boolean; gscSearchType?: string; gscDimensions?: string; gscRowLimit?: string; gscDataState?: string; gscAggregate?: string; gscIncludeQuery?: string[]; gscExcludeQuery?: string[]; gscIncludePage?: string[]; gscExcludePage?: string[]; gscBrandQuery?: string[]; gscNonBrand?: boolean; gscCacheTtl?: string; requireGscData?: boolean; requireGscFinalData?: boolean; gscInspectUrls?: string; gscInspectionStrategy?: string; gscPrivacyMode?: boolean; gscRedactQueries?: boolean; gscRedactUrlPaths?: boolean; maxClickDropPercent?: string; maxImpressionDropPercent?: string; maxTrafficPagesWithErrors?: string; maxHighImpactRegressions?: string; minGscClicks?: string; saveHistory?: boolean; historyName?: string; historyDir?: string; historyId?: string; environment?: string; release?: string; commit?: string; branch?: string; tag?: Record<string, string>; notes?: string; trendMetric?: string | string[]; trendGroupBy?: string; trendSince?: string; trendUntil?: string; trendLast?: string; trendEnvironment?: string; trendBranch?: string; trendRelease?: string; trendMinConfidence?: string; trendIncludePartial?: boolean; trendSmoothing?: string; trendWindow?: string; historyRetentionDays?: string; historyMaxEntries?: string; historyPrunePolicy?: string; maxSeoScoreDropOverLast?: string; maxLighthouseScoreDropOverLast?: string; maxLcpRegressionOverLast?: string; maxNewCriticalOverLast?: string; maxRecurringRegressions?: string; maxClickDropOverPeriod?: string; requireHistoryPoints?: string; requireHistoryConfidence?: string; failOnNegativeTrend?: boolean; format?: string; since?: string; until?: string; last?: string; includePartial?: boolean; dryRun?: boolean; rebuild?: boolean; json?: boolean; html?: boolean; source?: string; releaseA?: string; releaseB?: string; environmentA?: string; environmentB?: string; retentionDays?: string; maxEntries?: string; origin?: string; jsonOutput?: boolean };

program.name("codex-seo").description("Native Codex SEO audit CLI").version(getVersion()).option("--quiet", "final result only").option("--verbose", "show major steps").option("--debug", "show sanitized technical details").option("--json-output", "machine-readable JSON on stdout").addHelpText("after", `\nExamples:\n  codex-seo audit https://example.com --crawl\n  codex-seo diff previous.json current.json --fail-on-regression\n  codex-seo history trend --last 12\n  codex-seo doctor --json\n\nPrefer npx codex-seo ... for normal use. npm run scripts remain available for repository development.`);
program.command("version").description("Print Codex SEO version").action(() => console.log(getVersion()));
program.command("audit")
  .description("Audit a page or website")
  .argument("<url>", "URL to audit")
  .option("--pdf").option("--crawl").option("--allow-private-network", "allow audits of localhost, loopback, and private network targets").option("--allow-localhost", "alias for --allow-private-network").option("--max-pages <number>", "maximum pages", "100").option("--max-depth <number>", "maximum depth", "4").option("--concurrency <number>", "crawl concurrency", "4").option("--include-subdomains").option("--ignore-robots").option("--render [mode]", "render mode", "auto").option("--no-cache").option("-o, --output <dir>", "output reports directory", "reports")
  .option("--save-baseline [name]").option("--compare-baseline <name>").option("--baseline-dir <path>", "baseline directory", ".codex-seo/baselines").option("--overwrite-baseline").option("--privacy-mode").option("--fail-on-regression").option("--max-score-drop <number>").option("--max-new-high <number>").option("--max-new-critical <number>").option("--strict-compatibility")
  .option("--performance").option("--performance-mode <mode>", "local, pagespeed, crux, all", "local").option("--performance-device <device>", "mobile or desktop", "mobile").option("--performance-runs <number>", "runs", "1").option("--performance-concurrency <number>", "concurrency", "1").option("--performance-timeout <milliseconds>", "timeout", "60000").option("--performance-sample-pages <number>", "sample pages", "10").option("--performance-strategy <strategy>", "important, all, sample", "important").option("--performance-include-url <pattern>", "include URL", collect, []).option("--performance-exclude-url <pattern>", "exclude URL", collect, []).option("--pagespeed-api-key <key>").option("--pagespeed-api-key-env <name>")
  .option("--local-performance-engine <engine>", "auto, lighthouse, playwright", "auto").option("--chrome-path <path>").option("--require-official-lighthouse").option("--require-field-data").option("--min-performance-score <number>").option("--max-lcp <number>").option("--max-inp <number>").option("--max-cls <number>").option("--max-tbt <number>").option("--max-ttfb <number>").option("--max-performance-score-drop <number>").option("--max-lcp-regression <number>").option("--max-cls-regression <number>").option("--max-performance-variance <number>").option("--max-unused-javascript-bytes <number>").option("--max-total-transfer-bytes <number>").option("--max-request-count <number>")
  .option("--save-history").option("--history-name <name>").option("--history-dir <path>").option("--history-id <id>").option("--environment <name>").option("--release <version>").option("--commit <sha>").option("--branch <name>").option("--tag <key=value>", "history tag", collectTag, {}).option("--notes <text>").option("--max-seo-score-drop-over-last <number>").option("--max-lighthouse-score-drop-over-last <number>").option("--max-lcp-regression-over-last <milliseconds>").option("--max-new-critical-over-last <number>").option("--max-recurring-regressions <number>").option("--max-click-drop-over-period <percent>").option("--require-history-points <number>").option("--require-history-confidence <level>").option("--fail-on-negative-trend")
  .option("--gsc").option("--gsc-property <property>").option("--gsc-credentials <path>").option("--gsc-auth-mode <mode>").option("--gsc-start-date <YYYY-MM-DD>").option("--gsc-end-date <YYYY-MM-DD>").option("--gsc-days <number>").option("--gsc-compare-period").option("--gsc-search-type <type>").option("--gsc-dimensions <dimensions>").option("--gsc-row-limit <number>").option("--gsc-data-state <state>").option("--gsc-aggregate <mode>").option("--gsc-include-query <pattern>", "include query", collect, []).option("--gsc-exclude-query <pattern>", "exclude query", collect, []).option("--gsc-include-page <pattern>", "include page", collect, []).option("--gsc-exclude-page <pattern>", "exclude page", collect, []).option("--gsc-brand-query <pattern>", "brand query", collect, []).option("--gsc-non-brand").option("--gsc-cache-ttl <seconds>").option("--require-gsc-data").option("--require-gsc-final-data").option("--gsc-inspect-urls <number>").option("--gsc-inspection-strategy <strategy>").option("--gsc-privacy-mode").option("--gsc-redact-queries").option("--gsc-redact-url-paths").option("--max-click-drop-percent <number>").option("--max-impression-drop-percent <number>").option("--max-traffic-pages-with-errors <number>").option("--max-high-impact-regressions <number>").option("--min-gsc-clicks <number>").option("--json-output")
  .action(async (url: string, options: AuditOptions) => {
    try {
      const wantsJsonOutput = Boolean(options.jsonOutput || program.opts().jsonOutput);
      const extras = numericExtras(); const labels = textExtras(); const pdf = Boolean(options.pdf || envFlag("npm_config_pdf") || envFlag("npm_config_force"));
      const saveBaselineOption = options.saveBaseline ?? envValue("npm_config_save_baseline") ?? (envFlag("npm_config_save_baseline") ? labels[0] ?? true : undefined);
      const compareBaselineOption = options.compareBaseline ?? envValue("npm_config_compare_baseline") ?? (envFlag("npm_config_compare_baseline") ? labels[0] : undefined);
      const baselineDirOption = options.baselineDir ?? envValue("npm_config_baseline_dir"); const crawl = Boolean(options.crawl || envFlag("npm_config_crawl") || saveBaselineOption || compareBaselineOption);
      const render = parseRenderMode(process.env.npm_config_render ?? options.render ?? "auto"); const fixtureLocal = process.env.NODE_ENV === "test" && process.env.CODEX_SEO_TEST_ALLOW_PRIVATE_NETWORK === "1"; const allowPrivateNetwork = Boolean(options.allowPrivateNetwork || options.allowLocalhost || envFlag("npm_config_allow_private_network") || envFlag("npm_config_allow_localhost") || fixtureLocal); const perf = performanceOptions(options, allowPrivateNetwork);
      if (!crawl) {
        const performanceResults = perf.enabled ? await runPerformanceForUrl(url, { ...perf, allowPrivateNetwork }) : [];
        const { report, files } = await runAudit(url, { forceRender: render === "always" || process.env.npm_config_render === "true", pdf, outputRoot: options.output, performance: performanceResults, allowPrivateNetwork });
        const perfGateReasons = performanceGateReasons(performanceResults, options); const perfGatePassed = perfGateReasons.length === 0; const summary = { mode: "page" as const, startUrl: report.metadata.finalUrl, discoveredPages: 1, crawledPages: 1, skippedPages: 0, blockedByRobots: 0, failedPages: report.execution.status >= 400 ? 1 : 0, durationMs: report.metadata.durationMs, score: report.scores.overall, files, performanceCount: performanceResults.length || undefined, gatePassed: performanceResults.length ? perfGatePassed : undefined, gateReasons: perfGateReasons }; console.log(wantsJsonOutput ? JSON.stringify({ ok: perfGatePassed, summary, report, files }, null, 2) : formatAuditSummary(summary)); if (!perfGatePassed) process.exit(EXIT_GATE_FAILED); return;
      }
      const maxPages = parsePositiveInt("max-pages", preferredNumber("npm_config_max_pages", options.maxPages, extras[0]) ?? "100"); const maxDepth = parsePositiveInt("max-depth", preferredNumber("npm_config_max_depth", options.maxDepth, extras[1]) ?? "4", { allowZero: true }); const concurrency = parsePositiveInt("concurrency", preferredNumber("npm_config_concurrency", options.concurrency, extras[2]) ?? "4", { max: 12 });
      const crawlResult = await crawlSite(url, { maxPages, maxDepth, concurrency, includeSubdomains: Boolean(options.includeSubdomains || envFlag("npm_config_include_subdomains")), respectRobots: !(options.ignoreRobots || envFlag("npm_config_ignore_robots")), render, cache: options.cache !== false && process.env.npm_config_cache !== "false", allowPrivateNetwork, environment: options.environment });
      const performanceResults: PerformanceResult[] = [];
      if (perf.enabled) for (const page of selectPerformancePages(crawlResult.pages, perf)) performanceResults.push(...await runPerformanceForUrl(page.finalUrl, { ...perf, allowPrivateNetwork }));
      const preliminaryOutputDir = path.join(options.output, crawlResult.startUrl ? new URL(crawlResult.startUrl).hostname.replace(/^www\./, "") : "site");
      const gsc = (options.gsc || envFlag("npm_config_gsc")) ? await runGsc({ ...gscRawOptions(options, url, preliminaryOutputDir), crawl: crawlResult }) : undefined;
      const report = buildSitewideReport(crawlResult, performanceResults, gsc); const outputDir = path.join(options.output, report.audit.startUrl ? new URL(report.audit.startUrl).hostname.replace(/^www\./, "") : "site"); const files = await writeSitewideReport(report, outputDir, pdf);
      let baselineFile: string | undefined; let diffFiles: string[] | undefined; let gatePassed: boolean | undefined; let gateReasons: string[] | undefined;
      let historyFile: string | undefined; const historyStore = new HistoryStore({ root: options.historyDir });
      if (options.saveHistory || envFlag("npm_config_save_history")) { const stored = await historyStore.add(historyEntryFromReport(report, { ...historyIdentityOptions(options), reportReference: files[0] })); historyFile = stored.historyId; }
      if (saveBaselineOption) baselineFile = await saveBaseline(buildBaselineFromReport(report, { name: safeBaselineName(saveBaselineOption), sourceReportPath: files[0], privacyMode: Boolean(options.privacyMode || envFlag("npm_config_privacy_mode")) }), { baselineDir: baselineDirOption, overwrite: options.overwriteBaseline });
      if (compareBaselineOption) { const previous = await loadBaselineByName(baselineDirOption, report.audit.startUrl, compareBaselineOption); const current = coerceBaseline(report, "current", options.privacyMode); const gate = await gateOptions(cliGateOptions(options)); const diff = compareBaselines(previous.baseline, current, { baselineName: compareBaselineOption, previousReport: previous.path, currentReport: files[0], gate, strictCompatibility: (options.strictCompatibility || envFlag("npm_config_strict_compatibility")) }); diffFiles = await writeDiffReport(diff, path.join(outputDir, "diff"), { html: true, pdf }); gatePassed = diff.gate.passed; gateReasons = diff.gate.reasons; if (!diff.gate.passed) process.exit(EXIT_GATE_FAILED); }
      const directGateReasons = [...performanceGateReasons(performanceResults, options), ...gscGateReasons(gsc, options)];
      const historyGateEnabled = Boolean(historyFile && hasHistoricalGateOptions(options));
      if (historyGateEnabled) { const trend = await buildHistoryTrend(options, historyStore); directGateReasons.push(...trend.gate.reasons); files.push(...await writeTrendReport(trend, path.join(outputDir, "trends"), false)); }
      const directGatePassed = directGateReasons.length === 0; const hasDirectGate = Boolean(performanceResults.length || gsc?.enabled || historyGateEnabled); const summary = { mode: "sitewide" as const, startUrl: report.audit.startUrl, discoveredPages: report.summary.discoveredUrls, crawledPages: report.summary.crawledPages, skippedPages: report.summary.skippedUrls, blockedByRobots: report.summary.blockedByRobots, failedPages: report.summary.failedPages, durationMs: report.audit.durationMs, score: report.summary.score, files, performanceCount: performanceResults.length || undefined, gsc, baselineFile: historyFile ? `${baselineFile ?? ""} History: ${historyFile}`.trim() : baselineFile, diffFiles, gatePassed: hasDirectGate ? (gatePassed ?? directGatePassed) : gatePassed, gateReasons: [...(gateReasons ?? []), ...directGateReasons] }; console.log(wantsJsonOutput ? JSON.stringify({ ok: directGatePassed, summary, report, files }, null, 2) : formatAuditSummary(summary)); if (!directGatePassed) process.exit(EXIT_GATE_FAILED);
    } catch (error) { const message = error instanceof Error ? error.message : String(error); console.error(JSON.stringify({ ok: false, error: message }, null, 2)); process.exit(/strict mode|incompatible/i.test(message) ? EXIT_STRICT_INCOMPATIBLE : EXIT_RUNTIME_ERROR); }
  });

program.command("diff")
  .description("Compare two reports or baselines")
  .argument("<previous>").argument("<current>").option("--html").option("--pdf").option("--output <dir>", "output directory", "reports/diff").option("--fail-on-regression").option("--max-score-drop <number>").option("--max-new-high <number>").option("--max-new-critical <number>").option("--max-broken-links-increase <number>").option("--local-performance-engine <engine>", "auto, lighthouse, playwright", "auto").option("--chrome-path <path>").option("--require-official-lighthouse").option("--require-field-data").option("--min-performance-score <number>").option("--max-lcp <number>").option("--max-inp <number>").option("--max-cls <number>").option("--max-tbt <number>").option("--max-ttfb <number>").option("--max-performance-score-drop <number>").option("--max-lcp-regression <number>").option("--max-cls-regression <number>").option("--max-performance-variance <number>").option("--max-unused-javascript-bytes <number>").option("--max-total-transfer-bytes <number>").option("--max-request-count <number>").option("--max-click-drop-percent <number>").option("--max-impression-drop-percent <number>").option("--max-traffic-pages-with-errors <number>").option("--max-high-impact-regressions <number>").option("--min-gsc-clicks <number>").option("--require-gsc-data").option("--require-gsc-final-data").option("--severity-threshold <severity>").option("--ignore-rule <id>", "ignore rule", collect, []).option("--ignore-url <pattern>", "ignore url", collect, []).option("--ignore-category <category>", "ignore category", collect, []).option("--include-only <categories>").option("--strict-compatibility")
  .action(async (previous: string, current: string, options: AuditOptions & { html?: boolean }) => { await runDiffOrExit(async () => { const nums = numericExtras(); let index = 0; const nextNum = () => nums[index++]; const envOptions = { ...options, html: options.html || envFlag("npm_config_html"), pdf: options.pdf || envFlag("npm_config_pdf") || envFlag("npm_config_force"), output: envValue("npm_config_output") ?? options.output, failOnRegression: options.failOnRegression || envFlag("npm_config_fail_on_regression"), maxScoreDrop: envValue("npm_config_max_score_drop") ?? (envFlag("npm_config_max_score_drop") ? nextNum() : options.maxScoreDrop), maxNewHigh: envValue("npm_config_max_new_high") ?? (envFlag("npm_config_max_new_high") ? nextNum() : options.maxNewHigh), maxNewCritical: envValue("npm_config_max_new_critical") ?? (envFlag("npm_config_max_new_critical") ? nextNum() : options.maxNewCritical), maxBrokenLinksIncrease: envValue("npm_config_max_broken_links_increase") ?? (envFlag("npm_config_max_broken_links_increase") ? nextNum() : options.maxBrokenLinksIncrease), minPerformanceScore: envValue("npm_config_min_performance_score") ?? (envFlag("npm_config_min_performance_score") ? nextNum() : options.minPerformanceScore), maxLcp: envValue("npm_config_max_lcp") ?? (envFlag("npm_config_max_lcp") ? nextNum() : options.maxLcp), maxLcpRegression: envValue("npm_config_max_lcp_regression") ?? (envFlag("npm_config_max_lcp_regression") ? nextNum() : options.maxLcpRegression), maxCls: envValue("npm_config_max_cls") ?? (envFlag("npm_config_max_cls") ? nextNum() : options.maxCls), maxInp: envValue("npm_config_max_inp") ?? (envFlag("npm_config_max_inp") ? nextNum() : options.maxInp), maxTbt: envValue("npm_config_max_tbt") ?? (envFlag("npm_config_max_tbt") ? nextNum() : options.maxTbt), maxTtfb: envValue("npm_config_max_ttfb") ?? (envFlag("npm_config_max_ttfb") ? nextNum() : options.maxTtfb), maxPerformanceScoreDrop: envValue("npm_config_max_performance_score_drop") ?? (envFlag("npm_config_max_performance_score_drop") ? nextNum() : options.maxPerformanceScoreDrop), maxClsRegression: envValue("npm_config_max_cls_regression") ?? (envFlag("npm_config_max_cls_regression") ? nextNum() : options.maxClsRegression), requireOfficialLighthouse: options.requireOfficialLighthouse || envFlag("npm_config_require_official_lighthouse"), requireFieldData: options.requireFieldData || envFlag("npm_config_require_field_data"), maxPerformanceVariance: envValue("npm_config_max_performance_variance") ?? (envFlag("npm_config_max_performance_variance") ? nextNum() : options.maxPerformanceVariance), maxUnusedJavascriptBytes: envValue("npm_config_max_unused_javascript_bytes") ?? (envFlag("npm_config_max_unused_javascript_bytes") ? nextNum() : options.maxUnusedJavascriptBytes), maxTotalTransferBytes: envValue("npm_config_max_total_transfer_bytes") ?? (envFlag("npm_config_max_total_transfer_bytes") ? nextNum() : options.maxTotalTransferBytes), maxRequestCount: envValue("npm_config_max_request_count") ?? (envFlag("npm_config_max_request_count") ? nextNum() : options.maxRequestCount), maxClickDropPercent: envValue("npm_config_max_click_drop_percent") ?? (envFlag("npm_config_max_click_drop_percent") ? nextNum() : options.maxClickDropPercent), maxImpressionDropPercent: envValue("npm_config_max_impression_drop_percent") ?? (envFlag("npm_config_max_impression_drop_percent") ? nextNum() : options.maxImpressionDropPercent), maxTrafficPagesWithErrors: envValue("npm_config_max_traffic_pages_with_errors") ?? (envFlag("npm_config_max_traffic_pages_with_errors") ? nextNum() : options.maxTrafficPagesWithErrors), maxHighImpactRegressions: envValue("npm_config_max_high_impact_regressions") ?? (envFlag("npm_config_max_high_impact_regressions") ? nextNum() : options.maxHighImpactRegressions), minGscClicks: envValue("npm_config_min_gsc_clicks") ?? (envFlag("npm_config_min_gsc_clicks") ? nextNum() : options.minGscClicks), requireGscData: options.requireGscData || envFlag("npm_config_require_gsc_data"), requireGscFinalData: options.requireGscFinalData || envFlag("npm_config_require_gsc_final_data"), strictCompatibility: (options.strictCompatibility || envFlag("npm_config_strict_compatibility")) || envFlag("npm_config_strict_compatibility") }; const gate = await gateOptions(cliGateOptions(envOptions)); const report = await compareReportFiles(previous, current, { gate, ignore: { ignoredRules: gate.ignoredRules, ignoredUrls: gate.ignoredUrls, ignoredCategories: gate.ignoredCategories }, strictCompatibility: envOptions.strictCompatibility }); const files = await writeDiffReport(report, envOptions.output, { html: envOptions.html || envOptions.pdf, pdf: envOptions.pdf }); return { report, files }; }); });

program.command("history")
  .description("Manage local audit history, trends, releases, environments, and CI exports")
  .argument("<action>", "list, show, add, remove, compare, trend, export, validate, migrate, prune, import, export-ci, release, compare-releases, compare-environments")
  .argument("[value]")
  .argument("[other]")
  .option("--history-dir <path>", "history directory", ".codex-seo/history")
  .option("-o, --output <path>")
  .option("--format <format>", "console, json, markdown, github, junit", "console")
  .option("--json")
  .option("--html")
  .option("--pdf")
  .option("--privacy-mode")
  .option("--dry-run")
  .option("--rebuild")
  .option("--environment <name>")
  .option("--release <version>")
  .option("--branch <name>")
  .option("--commit <sha>")
  .option("--since <date>")
  .option("--until <date>")
  .option("--last <number>")
  .option("--include-partial")
  .option("--trend-metric <metric>", "trend metric, repeat or comma-separate", collect, [])
  .option("--trend-min-confidence <level>")
  .option("--release-a <version>")
  .option("--release-b <version>")
  .option("--environment-a <name>")
  .option("--environment-b <name>")
  .option("--retention-days <number>")
  .option("--max-entries <number>")
  .option("--history-prune-policy <policy>", "oldest, redundant, failed", "oldest")
  .option("--max-seo-score-drop-over-last <number>")
  .option("--max-lighthouse-score-drop-over-last <number>")
  .option("--max-lcp-regression-over-last <milliseconds>")
  .option("--max-new-critical-over-last <number>")
  .option("--max-recurring-regressions <number>")
  .option("--max-click-drop-over-period <percent>")
  .option("--require-history-points <number>")
  .option("--require-history-confidence <level>")
  .option("--fail-on-negative-trend")
  .option("--strict-compatibility")
  .action(async (action: string, value: string | undefined, other: string | undefined, options: AuditOptions) => {
    try {
      const store = new HistoryStore({ root: options.historyDir ?? envValue("npm_config_history_dir") });
      const wantsJson = Boolean(options.json || envFlag("npm_config_json") || options.format === "json" || envValue("npm_config_format") === "json");
      const outputOption = options.output ?? envValue("npm_config_output");
      const pdfOption = Boolean(options.pdf || envFlag("npm_config_pdf"));
      if (action === "list") {
        const entries = await queryHistory(historyFilterOptions(options), store);
        if (wantsJson) await writeJsonOutput({ ok: true, entries }, outputOption);
        else console.log(compactHistoryList(entries));
        return;
      }
      if (action === "show") { await writeJsonOutput(await store.readEntry(requireValue("history id", value)), outputOption); return; }
      if (action === "add") {
        const entry = await parseHistorySourceFile(requireValue("source", value), { environment: options.environment, release: options.release, commit: options.commit, branch: options.branch, privacyMode: Boolean(options.privacyMode || envFlag("npm_config_privacy_mode")) });
        const stored = await store.add(entry);
        await writeJsonOutput({ ok: true, imported: 1, historyId: stored.historyId }, outputOption);
        return;
      }
      if (action === "remove") { await writeJsonOutput({ ok: true, removed: await store.remove(requireValue("history id", value)) }, outputOption); return; }
      if (action === "compare") {
        const left = await store.readEntry(requireValue("left history id", value));
        const right = await store.readEntry(requireValue("right history id", other));
        const compatibility = compareHistoryCompatibility([left, right]);
        const payload = { ok: compatibility.compatible, compatibility, left: left.historyId, right: right.historyId, scoreDelta: (right.summary.seoScore ?? 0) - (left.summary.seoScore ?? 0), lighthouseDelta: (right.summary.performance?.lighthouseScore ?? 0) - (left.summary.performance?.lighthouseScore ?? 0), lcpDelta: (right.summary.performance?.lcpMs ?? 0) - (left.summary.performance?.lcpMs ?? 0), clicksDelta: (right.summary.gsc?.clicks ?? 0) - (left.summary.gsc?.clicks ?? 0) };
        await writeJsonOutput(payload, outputOption);
        if ((options.strictCompatibility || envFlag("npm_config_strict_compatibility")) && !compatibility.compatible) process.exit(EXIT_STRICT_INCOMPATIBLE);
        return;
      }
      if (action === "trend") {
        const report = await buildHistoryTrend(options, store);
        if ((options.strictCompatibility || envFlag("npm_config_strict_compatibility")) && !report.compatibility.compatible) process.exit(EXIT_STRICT_INCOMPATIBLE);
        const outDir = outputOption ?? store.trendsDir;
        const files = await writeTrendReport(report, outDir, pdfOption);
        if (wantsJson) console.log(JSON.stringify({ ok: report.gate?.passed !== false, report, files }, null, 2));
        else console.log(formatTrendConsole(report, files));
        if (report.gate?.passed === false) process.exit(EXIT_GATE_FAILED);
        return;
      }
      if (action === "export") { await exportHistory(requireValue("output", value ?? outputOption), { privacyMode: Boolean(options.privacyMode || envFlag("npm_config_privacy_mode")) }, store); console.log(JSON.stringify({ ok: true, output: value ?? outputOption }, null, 2)); return; }
      if (action === "import") { await writeJsonOutput({ ok: true, ...(await importHistory(requireValue("input", value), store)) }, outputOption); return; }
      if (action === "validate") {
        if (options.rebuild || envFlag("npm_config_rebuild") || envFlag("npm_config_rebuild_bundle")) await store.rebuildIndex();
        const result = await validateHistory(store);
        await writeJsonOutput({ ok: result.ok, validation: result }, outputOption);
        if (!result.ok) process.exit(EXIT_RUNTIME_ERROR);
        return;
      }
      if (action === "migrate") { await writeJsonOutput({ ok: true, ...(await migrateHistorySource(requireValue("source", value ?? options.source), { dryRun: Boolean(options.dryRun || envFlag("npm_config_dry_run")), environment: options.environment, release: options.release }, store)) }, outputOption); return; }
      if (action === "prune") {
        const result = await pruneHistory({ dryRun: Boolean(options.dryRun || envFlag("npm_config_dry_run")), retentionDays: options.historyRetentionDays ?? options.retentionDays ? Number(options.historyRetentionDays ?? options.retentionDays) : undefined, maxEntries: options.historyMaxEntries ?? options.maxEntries ? Number(options.historyMaxEntries ?? options.maxEntries) : undefined, policy: options.historyPrunePolicy as never }, store);
        await writeJsonOutput({ ok: true, ...result }, outputOption);
        return;
      }
      if (action === "release" || action === "compare-releases") {
        const entries = await queryHistory(historyFilterOptions({ ...options, release: undefined }), store);
        const payload = compareReleases(entries, requireValue("release A", options.releaseA ?? value), requireValue("release B", options.releaseB ?? other));
        await writeJsonOutput({ ok: payload.compatible, comparison: payload }, outputOption ?? path.join(store.trendsDir, "release-comparison.json"));
        if ((options.strictCompatibility || envFlag("npm_config_strict_compatibility")) && !payload.compatible) process.exit(EXIT_STRICT_INCOMPATIBLE);
        return;
      }
      if (action === "compare-environments") {
        const entries = await queryHistory(historyFilterOptions({ ...options, environment: undefined }), store);
        const payload = compareEnvironments(entries, requireValue("environment A", options.environmentA ?? value), requireValue("environment B", options.environmentB ?? other));
        await writeJsonOutput({ ok: payload.compatible, comparison: payload }, outputOption ?? path.join(store.trendsDir, "environment-comparison.json"));
        if ((options.strictCompatibility || envFlag("npm_config_strict_compatibility")) && !payload.compatible) process.exit(EXIT_STRICT_INCOMPATIBLE);
        return;
      }
      if (action === "export-ci") {
        const report = await buildHistoryTrend(options, store);
        const outDir = outputOption ?? store.trendsDir;
        const format = (envValue("npm_config_format") ?? options.format ?? "markdown") as "json" | "markdown" | "github" | "junit";
        const files = await writeCiExport(report, { format, outputDir: outDir, githubStepSummary: process.env.GITHUB_STEP_SUMMARY, privacyMode: Boolean(options.privacyMode || envFlag("npm_config_privacy_mode")) });
        console.log(JSON.stringify({ ok: report.gate?.passed !== false, files }, null, 2));
        if (report.gate?.passed === false) process.exit(EXIT_GATE_FAILED);
        return;
      }
      throw new Error(`Unknown history action: ${action}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ ok: false, error: message }, null, 2));
      process.exit(/strict mode|incompatible/i.test(message) ? EXIT_STRICT_INCOMPATIBLE : EXIT_RUNTIME_ERROR);
    }
  });
program.command("init")
  .description("Detect and initialize Codex SEO, local Git, MCP, and the maintainer skill")
  .option("--minimal")
  .option("--full")
  .option("--ci <provider>", "github")
  .option("--environment <name>", "production")
  .option("--yes", "accept detected defaults")
  .option("--project-root <path>")
  .option("--production-url <url>")
  .option("--framework <name>")
  .option("--package-manager <name>")
  .option("--git")
  .option("--no-git")
  .option("--deployment <provider>", "none, local-directory, ssh, or sftp", "none")
  .option("--force")
  .option("--dry-run")
  .option("--json")
  .option("--json-output")
  .action(async (options: { minimal?: boolean; full?: boolean; ci?: "github"; environment?: string; yes?: boolean; projectRoot?: string; productionUrl?: string; framework?: import("../project/detect.js").Framework; packageManager?: import("../project/detect.js").PackageManager; git?: boolean; deployment?: import("../project/config.js").ProjectConfig["deployment"]["provider"]; force?: boolean; dryRun?: boolean; json?: boolean; jsonOutput?: boolean }) => {
    try { const result = await initProject(options); if (options.json || options.jsonOutput || program.opts().jsonOutput) console.log(JSON.stringify({ ok: true, result }, null, 2)); else console.log(formatInitResult(result)); }
    catch (error) { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)); process.exit(EXIT_RUNTIME_ERROR); }
  });

program.command("configure")
  .description("Idempotently configure deployment, automation, audit, or MCP")
  .argument("<section>", "deployment, automation, audit, or mcp")
  .option("--provider <provider>", "none, local-directory, ssh, or sftp")
  .option("--host-env <name>", "host environment variable name", "DEPLOY_HOST")
  .option("--user-env <name>", "username environment variable name", "DEPLOY_USER")
  .option("--path-env <name>", "remote path environment variable name", "DEPLOY_PATH")
  .option("--port <number>", "SSH port", "22")
  .option("--auth <mode>", "agent or key", "agent")
  .option("--private-key-path <path>")
  .option("--passphrase-env <name>")
  .option("--artifact-path <path>")
  .option("--local-path <path>")
  .option("--release-strategy <strategy>", "auto, symlink, rename, or copy", "auto")
  .option("--health-check-url <url>")
  .option("--crawl")
  .option("--performance")
  .option("--dry-run")
  .option("--json")
  .action(async (section: "deployment" | "automation" | "audit" | "mcp", options: { provider?: "none" | "local-directory" | "ssh" | "sftp"; hostEnv?: string; userEnv?: string; pathEnv?: string; port?: string; auth?: "agent" | "key"; privateKeyPath?: string; passphraseEnv?: string; artifactPath?: string; localPath?: string; releaseStrategy?: "auto" | "symlink" | "rename" | "copy"; healthCheckUrl?: string; crawl?: boolean; performance?: boolean; dryRun?: boolean; json?: boolean }) => {
    try {
      if (!["deployment", "automation", "audit", "mcp"].includes(section)) throw new Error("Unknown configure section: " + section);
      const result = section === "mcp"
        ? await updateProjectPlugin(process.cwd(), Boolean(options.dryRun))
        : await configureProject(section, { ...options, port: options.port ? Number(options.port) : undefined });
      console.log(JSON.stringify({ ok: true, result }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exit(EXIT_RUNTIME_ERROR);
    }
  });

program.command("plugin")
  .description("Diagnose or non-destructively update the project Codex plugin")
  .argument("<action>", "doctor or update")
  .option("--dry-run")
  .option("--json")
  .action(async (action: "doctor" | "update", options: { dryRun?: boolean; json?: boolean }) => {
    try {
      if (action === "doctor") {
        const report = await pluginDoctor(process.cwd());
        console.log(JSON.stringify(report, null, 2));
        if (!report.ready) process.exit(EXIT_RUNTIME_ERROR);
        return;
      }
      if (action === "update") {
        console.log(JSON.stringify({ ok: true, result: await updateProjectPlugin(process.cwd(), Boolean(options.dryRun)) }, null, 2));
        return;
      }
      throw new Error("Unknown plugin action: " + action);
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exit(EXIT_RUNTIME_ERROR);
    }
  });

program.command("validate")
  .description("Validate codex-seo.config.json and schema documents")
  .option("--config <path>", "config file", "codex-seo.config.json")
  .option("--fix")
  .option("--schema-file <path>")
  .option("--json-output")
  .action(async (options: { config: string; fix?: boolean; schemaFile?: string; jsonOutput?: boolean }) => {
    try {
      if (options.schemaFile) { const raw = JSON.parse(await readFile(options.schemaFile, "utf8")); const result = validateSchema(raw); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exit(EXIT_RUNTIME_ERROR); return; }
      const result = await validateConfigFile(options.config, { fix: options.fix });
      const ok = !result.diagnostics.some((item) => item.severity === "error");
      if (options.jsonOutput || program.opts().jsonOutput) console.log(JSON.stringify({ ok, path: result.path, diagnostics: result.diagnostics }, null, 2));
      else if (ok) console.log("Configuration valid"); else console.log(result.diagnostics.map((d) => `Configuration error at ${d.path}\nExpected: ${d.expected}\nReceived: ${d.received}\nSuggestion: ${d.suggestion}`).join("\n\n"));
      if (!ok) process.exit(EXIT_RUNTIME_ERROR);
    } catch (error) { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)); process.exit(EXIT_RUNTIME_ERROR); }
  });

program.command("doctor")
  .description("Check local Codex SEO dependencies, configuration, history, and CI readiness")
  .option("--config <path>")
  .option("--history-dir <path>")
  .option("--privacy-mode")
  .option("--json")
  .action(async (options: { config?: string; historyDir?: string; privacyMode?: boolean; json?: boolean }) => {
    try { const report = await runDoctor(options); if (options.json) console.log(JSON.stringify(report, null, 2)); else console.log(formatDoctor(report)); if (report.status === "FAILED") process.exit(EXIT_RUNTIME_ERROR); }
    catch (error) { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)); process.exit(EXIT_RUNTIME_ERROR); }
  });

program.command("migrate")
  .description("Migrate a versioned Codex SEO schema document without overwriting the source")
  .argument("<file>")
  .option("--output <path>")
  .option("--dry-run")
  .option("--json-output")
  .action(async (file: string, options: { output?: string; dryRun?: boolean; jsonOutput?: boolean }) => {
    try { const raw = JSON.parse(await readFile(file, "utf8")); const result = migrateSchema(raw); if (options.output && !options.dryRun) await writeFile(options.output, `${JSON.stringify(result.migrated, null, 2)}\n`, "utf8"); const payload = { ok: true, dryRun: Boolean(options.dryRun), output: options.output, ...result }; if (options.jsonOutput || program.opts().jsonOutput) console.log(JSON.stringify(payload, null, 2)); else console.log(JSON.stringify(payload, null, 2)); }
    catch (error) { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)); process.exit(EXIT_RUNTIME_ERROR); }
  });
program.command("gsc")
  .description("Inspect Google Search Console access and properties")
  .argument("<action>", "properties or inspect-property")
  .argument("[property]")
  .option("--gsc-credentials <path>")
  .option("--gsc-auth-mode <mode>")
  .action(async (action: string, property: string | undefined, options: AuditOptions) => {
    try {
      const mock = property?.endsWith("example.test") || process.env.CODEX_SEO_GSC_MOCK === "1";
      const client = mock ? new MockGscClient() : new GoogleSearchConsoleClient({ mode: options.gscAuthMode as never, credentialsPath: options.gscCredentials ?? envValue("npm_config_gsc_credentials") });
      if (action === "properties") {
        const properties = await client.listProperties();
        console.log(JSON.stringify({ ok: true, properties }, null, 2));
        return;
      }
      if (action === "inspect-property") {
        if (!property) throw new Error("inspect-property requires a property");
        const result = await inspectPropertyAccess(client, property);
        console.log(JSON.stringify({ ok: true, property, status: result.status, accessibleProperties: result.properties, warnings: result.warnings }, null, 2));
        return;
      }
      throw new Error(`Unknown GSC action: ${action}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ ok: false, error: message }, null, 2));
      process.exit(EXIT_RUNTIME_ERROR);
    }
  });
program.parseAsync(process.argv);
