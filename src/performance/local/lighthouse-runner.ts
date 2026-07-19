import lighthouse from "lighthouse";
import { assertSafeUrl, validateUrlSyntax } from "../../core/url-safety.js";
import { median, performanceStatistics, varianceWarning } from "../performance-normalizer.js";
import { performanceConfidence } from "../performance-scoring.js";
import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceConfig, type PerformanceResult } from "../performance-schema.js";
import { launchChromeForLighthouse } from "./chrome-launcher.js";
import { lighthouseConfigForDevice, lighthouseFlagsForDevice } from "./lighthouse-config.js";
import { normalizeLighthouseResult } from "./lighthouse-normalizer.js";
import type { LocalRunMetrics } from "./local-metrics.js";

export type LighthousePerformanceOptions = Pick<PerformanceConfig, "device" | "runs" | "timeoutMs" | "chromePath"> & { allowPrivateNetwork?: boolean };

async function runOnce(rawUrl: string, options: LighthousePerformanceOptions): Promise<PerformanceResult> {
  const safe = options.allowPrivateNetwork ? { url: validateUrlSyntax(rawUrl, { allowPrivateNetwork: true }) } : await assertSafeUrl(rawUrl);
  const chrome = await launchChromeForLighthouse(options.chromePath);
  try {
    const result = await lighthouse(safe.url.toString(), lighthouseFlagsForDevice(options.device, chrome.port, options.timeoutMs) as any, lighthouseConfigForDevice(options.device) as any);
    if (!result?.lhr) throw new Error("Lighthouse did not return an LHR result");
    const normalized = normalizeLighthouseResult(rawUrl, options.device, result.lhr as any);
    if (!options.allowPrivateNetwork && normalized.finalUrl) await assertSafeUrl(normalized.finalUrl);
    return normalized;
  } finally {
    await chrome.close();
  }
}

function aggregate(url: string, options: LighthousePerformanceOptions, results: PerformanceResult[], warnings: string[]): PerformanceResult {
  const metric = (key: keyof PerformanceResult["metrics"]) => median(results.map((run) => run.metrics[key]).filter((value): value is number => typeof value === "number"));
  const resource = (key: keyof NonNullable<PerformanceResult["resources"]>) => Math.round(median(results.map((run) => run.resources?.[key]).filter((value): value is number => typeof value === "number")) ?? 0);
  const scoreValues = results.map((run) => run.lighthousePerformanceScore ?? run.scores?.performance).filter((value): value is number => typeof value === "number");
  for (const key of ["lcpMs", "tbtMs", "cls", "ttfbMs"] as const) {
    const warning = varianceWarning(results.map((run) => run.metrics[key]).filter((value): value is number => typeof value === "number"), key);
    if (warning) warnings.push(warning);
  }
  const first = results[0];
  const lighthousePerformanceScore = Math.round(median(scoreValues) ?? 0);
  const internalScores = results.map((run) => run.internalPerformanceScore).filter((value): value is number => typeof value === "number");
  const runs: LocalRunMetrics[] = results.map((run) => ({ metrics: run.metrics, resources: run.resources, scores: run.scores, engine: "lighthouse", scoreKind: "official-lighthouse", diagnostics: run.diagnostics, opportunities: run.opportunities }));
  const aggregated = performanceResultSchema.parse({
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    url,
    finalUrl: first.finalUrl,
    source: "local",
    engine: "lighthouse",
    scoreKind: "official-lighthouse",
    executionEnvironment: "local",
    scope: "url",
    device: options.device,
    collectedAt: new Date().toISOString(),
    runCount: results.length,
    lighthousePerformanceScore,
    internalPerformanceScore: Math.round(median(internalScores) ?? lighthousePerformanceScore),
    scores: { performance: lighthousePerformanceScore, accessibility: Math.round(median(results.map((run) => run.scores?.accessibility).filter((value): value is number => typeof value === "number")) ?? 0), bestPractices: Math.round(median(results.map((run) => run.scores?.bestPractices).filter((value): value is number => typeof value === "number")) ?? 0), seo: Math.round(median(results.map((run) => run.scores?.seo).filter((value): value is number => typeof value === "number")) ?? 0) },
    metrics: { fcpMs: metric("fcpMs"), lcpMs: metric("lcpMs"), cls: metric("cls"), tbtMs: metric("tbtMs"), speedIndexMs: metric("speedIndexMs"), ttfbMs: metric("ttfbMs"), interactiveMs: metric("interactiveMs") },
    resources: { requestCount: resource("requestCount"), transferBytes: resource("transferBytes"), javascriptBytes: resource("javascriptBytes"), cssBytes: resource("cssBytes"), imageBytes: resource("imageBytes"), fontBytes: resource("fontBytes"), thirdPartyBytes: resource("thirdPartyBytes") },
    diagnostics: first.diagnostics,
    opportunities: results.flatMap((run) => run.opportunities ?? []).sort((a, b) => (b.estimatedSavingsMs ?? b.estimatedSavingsBytes ?? 0) - (a.estimatedSavingsMs ?? a.estimatedSavingsBytes ?? 0)).slice(0, 20),
    statistics: performanceStatistics(scoreValues),
    lighthouse: first.lighthouse,
    runs,
    warnings,
    confidence: results.length >= 3 ? "medium" : "low"
  });
  return { ...aggregated, confidence: performanceConfidence(aggregated) };
}

export async function runOfficialLighthousePerformance(url: string, options: LighthousePerformanceOptions): Promise<PerformanceResult> {
  const results: PerformanceResult[] = [];
  const warnings: string[] = [];
  try {
    for (let index = 0; index < options.runs; index += 1) {
      try {
        results.push(await runOnce(url, options));
      } catch (error) {
        warnings.push(`lighthouse-run-${index + 1}-failed: ${error instanceof Error ? error.message : String(error)}`);
        if (options.runs === 1) throw error;
      }
    }
    if (!results.length) throw new Error("All Lighthouse runs failed");
    return aggregate(url, options, results, warnings);
  } catch (error) {
    return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url, source: "local", engine: "lighthouse", scoreKind: "official-lighthouse", executionEnvironment: "local", scope: "url", device: options.device, collectedAt: new Date().toISOString(), runCount: options.runs, metrics: {}, warnings, error: { code: "official-lighthouse-error", message: error instanceof Error ? error.message : String(error), retryable: true }, confidence: "low" });
  }
}