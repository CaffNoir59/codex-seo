import path from "node:path";
import { performanceConfigSchema, PERFORMANCE_SCHEMA_VERSION, type PerformanceConfig, type PerformanceResult } from "./performance-schema.js";
import { readPerformanceCache, writePerformanceCache, type PerformanceCacheKey } from "./performance-cache.js";
import { runLocalPerformance } from "./local/lighthouse-adapter.js";
import { runPageSpeed } from "./pagespeed/pagespeed-adapter.js";
import { runCrux } from "./crux/crux-adapter.js";

export type PerformanceRunOptions = Partial<PerformanceConfig> & { allowPrivateNetwork?: boolean; cacheDir?: string };

export function resolvePerformanceConfig(input: Partial<PerformanceConfig> = {}): PerformanceConfig {
  return performanceConfigSchema.parse(input);
}

async function runWithCache(config: PerformanceConfig, input: PerformanceRunOptions, key: PerformanceCacheKey, run: () => Promise<PerformanceResult>, cacheable = true): Promise<PerformanceResult> {
  const cacheDir = input.cacheDir ?? path.join(process.cwd(), ".codex-seo", "cache", "performance");
  if (config.cache && cacheable) {
    const cached = await readPerformanceCache(cacheDir, key, config.cacheTtlMs);
    if (cached) return { ...cached, warnings: [...cached.warnings, "cache-hit"] };
  }
  const result = await run();
  if (config.cache && cacheable) await writePerformanceCache(cacheDir, key, result);
  return result;
}

export async function runPerformanceForUrl(url: string, input: PerformanceRunOptions): Promise<PerformanceResult[]> {
  const config = resolvePerformanceConfig(input);
  if (!config.enabled) return [];
  const apiKey = config.pagespeedApiKey;
  const modes = config.mode === "all" ? ["local", "pagespeed", "crux"] as const : [config.mode] as const;
  const results: PerformanceResult[] = [];
  for (const mode of modes) {
    const key: PerformanceCacheKey = { url, source: mode, device: config.device, runs: mode === "local" ? config.runs : undefined, version: PERFORMANCE_SCHEMA_VERSION };
    if (mode === "local") results.push(await runWithCache(config, input, key, () => runLocalPerformance(url, { device: config.device, runs: config.runs, timeoutMs: config.timeoutMs, localEngine: config.localEngine, chromePath: config.chromePath, requireOfficialLighthouse: config.requireOfficialLighthouse, allowPrivateNetwork: input.allowPrivateNetwork }), false));
    if (mode === "pagespeed") results.push(await runWithCache(config, input, key, () => runPageSpeed(url, { device: config.device, apiKey, timeoutMs: config.timeoutMs })));
    if (mode === "crux") results.push(await runWithCache(config, input, key, () => runCrux(url, { device: config.device, apiKey, timeoutMs: config.timeoutMs })));
  }
  return results;
}