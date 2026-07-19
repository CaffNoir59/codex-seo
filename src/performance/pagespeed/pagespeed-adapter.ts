import { fetch } from "undici";
import type { PerformanceDevice, PerformanceResult } from "../performance-schema.js";
import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema } from "../performance-schema.js";
import { normalizePageSpeed } from "./pagespeed-normalizer.js";

type FetchLike = (input: URL, init: { signal: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export async function runPageSpeed(url: string, options: { device: PerformanceDevice; apiKey?: string; timeoutMs: number; fetchImpl?: FetchLike }): Promise<PerformanceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("strategy", options.device);
    if (options.apiKey) endpoint.searchParams.set("key", options.apiKey);
    const response = await (options.fetchImpl ?? fetch)(endpoint, { signal: controller.signal });
    if (response.status === 429) throw new Error("pagespeed-quota-exceeded");
    if (!response.ok) throw new Error(`pagespeed-http-${response.status}`);
    return normalizePageSpeed(url, options.device, await response.json());
  } catch (error) {
    return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url, source: "pagespeed", engine: "pagespeed", scoreKind: "official-lighthouse", executionEnvironment: "remote-google", scope: "url", device: options.device, collectedAt: new Date().toISOString(), metrics: {}, warnings: [], error: { code: error instanceof Error && error.message.includes("quota") ? "pagespeed-quota" : "pagespeed-error", message: error instanceof Error ? error.message.replace(options.apiKey ?? "", "[redacted]") : String(error), retryable: true }, confidence: "low" });
  } finally {
    clearTimeout(timer);
  }
}