import { fetch } from "undici";
import { PERFORMANCE_SCHEMA_VERSION, performanceResultSchema, type PerformanceDevice, type PerformanceResult } from "../performance-schema.js";
import { normalizeCrux } from "./crux-normalizer.js";

type FetchLike = (input: URL, init: { method: "POST"; body: string; headers: { "content-type": string }; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

async function requestCrux(body: unknown, apiKey: string | undefined, timeoutMs: number, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = new URL("https://chromeuxreport.googleapis.com/v1/records:queryRecord");
    if (apiKey) endpoint.searchParams.set("key", apiKey);
    const response = await fetchImpl(endpoint, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, signal: controller.signal });
    if (response.status === 404) return undefined;
    if (response.status === 429) throw new Error("crux-quota-exceeded");
    if (!response.ok) throw new Error(`crux-http-${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function runCrux(url: string, options: { device: PerformanceDevice; apiKey?: string; timeoutMs: number; fetchImpl?: FetchLike }): Promise<PerformanceResult> {
  try {
    const formFactor = options.device === "mobile" ? "PHONE" : "DESKTOP";
    const urlData = await requestCrux({ url, formFactor }, options.apiKey, options.timeoutMs, options.fetchImpl);
    if (urlData) return normalizeCrux(url, options.device, urlData, "url");
    const origin = new URL(url).origin;
    const originData = await requestCrux({ origin, formFactor }, options.apiKey, options.timeoutMs, options.fetchImpl);
    if (originData) return normalizeCrux(url, options.device, originData, "origin");
    return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url, source: "crux", engine: "crux", scoreKind: "field-data", scope: "url", device: options.device, collectedAt: new Date().toISOString(), metrics: {}, warnings: ["crux-data-unavailable"], confidence: "low" });
  } catch (error) {
    return performanceResultSchema.parse({ schemaVersion: PERFORMANCE_SCHEMA_VERSION, url, source: "crux", engine: "crux", scoreKind: "field-data", scope: "url", device: options.device, collectedAt: new Date().toISOString(), metrics: {}, warnings: [], error: { code: "crux-error", message: error instanceof Error ? error.message.replace(options.apiKey ?? "", "[redacted]") : String(error), retryable: true }, confidence: "low" });
  }
}