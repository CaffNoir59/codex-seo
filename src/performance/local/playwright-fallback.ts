import { chromium } from "playwright";
import { assertSafeUrl, validateUrlSyntax } from "../../core/url-safety.js";
import { median, performanceStatistics, varianceWarning } from "../performance-normalizer.js";
import { performanceConfidence, scorePerformance } from "../performance-scoring.js";
import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceConfig, type PerformanceResult } from "../performance-schema.js";
import { resourceBucket, type LocalRunMetrics } from "./local-metrics.js";
import { viewportForDevice } from "./browser-config.js";

export type PlaywrightPerformanceOptions = Pick<PerformanceConfig, "device" | "runs" | "timeoutMs"> & { allowPrivateNetwork?: boolean };

type ResourceEntry = { name: string; transferSize?: number; encodedBodySize?: number; initiatorType?: string };

const fallbackWarning = "Official Lighthouse was unavailable or not requested. Results use Codex SEO internal Playwright estimates and are not directly comparable to Lighthouse scores.";

function approximateScore(metrics: PerformanceResult["metrics"], resources: NonNullable<PerformanceResult["resources"]>): number {
  const result = performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url: "https://example.com/", source: "local", engine: "playwright", scoreKind: "internal-estimate", executionEnvironment: "local", scope: "url", device: "mobile", collectedAt: new Date(0).toISOString(), metrics, resources, warnings: [] });
  const base = scorePerformance(result);
  const sizePenalty = Math.min(25, Math.round((resources.transferBytes ?? 0) / 180000));
  const requestPenalty = Math.min(20, Math.max(0, (resources.requestCount ?? 0) - 30));
  const jsPenalty = Math.min(20, Math.round((resources.javascriptBytes ?? 0) / 120000));
  return Math.max(0, Math.min(100, base - sizePenalty - requestPenalty - jsPenalty));
}

async function runOnce(rawUrl: string, options: PlaywrightPerformanceOptions): Promise<{ finalUrl: string; run: LocalRunMetrics; warnings: string[] }> {
  const safe = options.allowPrivateNetwork ? { url: validateUrlSyntax(rawUrl, { allowPrivateNetwork: true }) } : await assertSafeUrl(rawUrl);
  const browser = await chromium.launch({ headless: true });
  const warnings: string[] = [];
  try {
    const context = await browser.newContext({ ...viewportForDevice(options.device), userAgent: `codex-seo-performance/${options.device}` });
    const page = await context.newPage();
    const responses = new Map<string, { bytes: number; contentType: string }>();
    page.on("response", async (response) => {
      try {
        const headers = response.headers();
        const length = Number(headers["content-length"] ?? 0);
        responses.set(response.url(), { bytes: Number.isFinite(length) ? length : 0, contentType: headers["content-type"] ?? "" });
      } catch {
        // Keep local metrics best-effort.
      }
    });
    const started = Date.now();
    const response = await page.goto(safe.url.toString(), { waitUntil: "load", timeout: options.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(options.timeoutMs, 5000) }).catch(() => warnings.push("networkidle-timeout"));
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paint = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
      const resources = performance.getEntriesByType("resource").map((entry) => ({ name: entry.name, transferSize: (entry as PerformanceResourceTiming).transferSize, encodedBodySize: (entry as PerformanceResourceTiming).encodedBodySize, initiatorType: (entry as PerformanceResourceTiming).initiatorType }));
      return { nav: nav ? { responseStart: nav.responseStart, domInteractive: nav.domInteractive, loadEventEnd: nav.loadEventEnd } : undefined, paint, resources };
    });
    const lcp = await page.evaluate(() => new Promise<number | undefined>((resolve) => {
      let latest: number | undefined;
      try {
        const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) latest = entry.startTime; });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => { observer.disconnect(); resolve(latest); }, 50);
      } catch { resolve(undefined); }
    })).catch(() => undefined);
    const cls = await page.evaluate(() => new Promise<number>((resolve) => {
      let clsValue = 0;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<{ hadRecentInput?: boolean; value?: number }>) if (!entry.hadRecentInput) clsValue += entry.value ?? 0;
        });
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => { observer.disconnect(); resolve(clsValue); }, 50);
      } catch { resolve(0); }
    })).catch(() => 0);
    const longTasks = await page.evaluate(() => new Promise<number[]>((resolve) => {
      const tasks: number[] = [];
      try {
        const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration); });
        observer.observe({ type: "longtask", buffered: true });
        setTimeout(() => { observer.disconnect(); resolve(tasks); }, 50);
      } catch { resolve(tasks); }
    })).catch(() => []);
    const resources = { requestCount: timing.resources.length + 1, transferBytes: 0, javascriptBytes: 0, cssBytes: 0, imageBytes: 0, fontBytes: 0 };
    for (const entry of timing.resources as ResourceEntry[]) {
      const responseInfo = responses.get(entry.name);
      const bytes = Math.max(entry.transferSize ?? 0, entry.encodedBodySize ?? 0, responseInfo?.bytes ?? 0);
      resources.transferBytes += bytes;
      const bucket = resourceBucket(responseInfo?.contentType ?? entry.initiatorType ?? "", entry.name);
      if (bucket) resources[bucket] += bytes;
    }
    const mainBytes = Number(response?.headers()["content-length"] ?? 0);
    resources.transferBytes += Number.isFinite(mainBytes) ? mainBytes : 0;
    const metrics = {
      fcpMs: typeof timing.paint["first-contentful-paint"] === "number" ? timing.paint["first-contentful-paint"] : undefined,
      lcpMs: lcp,
      cls,
      tbtMs: longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0),
      speedIndexMs: timing.nav?.loadEventEnd ?? Date.now() - started,
      ttfbMs: timing.nav?.responseStart,
      interactiveMs: timing.nav?.domInteractive
    };
    const performanceScore = approximateScore(metrics, resources);
    return { finalUrl: page.url(), run: { metrics, resources, scores: { performance: performanceScore, bestPractices: 100, accessibility: 100, seo: 100 }, engine: "playwright", scoreKind: "internal-estimate" }, warnings };
  } finally {
    await browser.close();
  }
}

function aggregateRuns(url: string, finalUrl: string, options: PlaywrightPerformanceOptions, runs: LocalRunMetrics[], warnings: string[]): PerformanceResult {
  const metric = (key: keyof PerformanceResult["metrics"]) => median(runs.map((run) => run.metrics[key]).filter((value): value is number => typeof value === "number"));
  const resource = (key: keyof NonNullable<PerformanceResult["resources"]>) => Math.round(median(runs.map((run) => run.resources?.[key]).filter((value): value is number => typeof value === "number")) ?? 0);
  for (const key of ["lcpMs", "tbtMs", "cls", "ttfbMs"] as const) {
    const warning = varianceWarning(runs.map((run) => run.metrics[key]).filter((value): value is number => typeof value === "number"), key);
    if (warning) warnings.push(warning);
  }
  const scores = runs.map((run) => run.scores?.performance).filter((value): value is number => typeof value === "number");
  const internalPerformanceScore = Math.round(median(scores) ?? 0);
  const result = performanceResultSchema.parse({
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    url,
    finalUrl,
    source: "local",
    engine: "playwright",
    scoreKind: "internal-estimate",
    executionEnvironment: "local",
    scope: "url",
    device: options.device,
    collectedAt: new Date().toISOString(),
    runCount: runs.length,
    scores: { performance: internalPerformanceScore, accessibility: 100, bestPractices: 100, seo: 100 },
    internalPerformanceScore,
    metrics: { fcpMs: metric("fcpMs"), lcpMs: metric("lcpMs"), cls: metric("cls"), tbtMs: metric("tbtMs"), speedIndexMs: metric("speedIndexMs"), ttfbMs: metric("ttfbMs"), interactiveMs: metric("interactiveMs") },
    resources: { requestCount: resource("requestCount"), transferBytes: resource("transferBytes"), javascriptBytes: resource("javascriptBytes"), cssBytes: resource("cssBytes"), imageBytes: resource("imageBytes"), fontBytes: resource("fontBytes") },
    statistics: performanceStatistics(scores),
    runs,
    warnings: [...warnings, fallbackWarning],
    confidence: runs.length >= 3 ? "medium" : "low"
  });
  return { ...result, confidence: performanceConfidence(result) };
}

export async function runPlaywrightPerformance(url: string, options: PlaywrightPerformanceOptions): Promise<PerformanceResult> {
  const runs: LocalRunMetrics[] = [];
  const warnings: string[] = [];
  let finalUrl = url;
  try {
    for (let i = 0; i < options.runs; i += 1) {
      const result = await runOnce(url, options);
      finalUrl = result.finalUrl;
      runs.push(result.run);
      warnings.push(...result.warnings);
    }
    return aggregateRuns(url, finalUrl, options, runs, warnings);
  } catch (error) {
    return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url, source: "local", engine: "playwright", scoreKind: "internal-estimate", executionEnvironment: "local", scope: "url", device: options.device, collectedAt: new Date().toISOString(), runCount: runs.length || options.runs, metrics: {}, warnings: [...warnings, fallbackWarning], error: { code: "local-performance-error", message: error instanceof Error ? error.message : String(error), retryable: true }, confidence: "low" });
  }
}