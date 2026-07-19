import { setTimeout as delay } from "node:timers/promises";
import type { CrawledPage } from "../crawler/crawl-result.js";
import type { GscClient } from "./gsc-client.js";
import type { GscConfig } from "./gsc-config.js";
import { normalizeInspection } from "./gsc-normalizer.js";
import type { GscInspectionResult } from "./gsc-schema.js";

export function selectInspectionUrls(pages: CrawledPage[], pageData: Record<string, { clicks: number; impressions: number }>, config: Pick<GscConfig, "inspectUrls" | "inspectionStrategy">): string[] {
  if (config.inspectUrls <= 0) return [];
  const scored = pages.map((page, index) => {
    const data = pageData[page.finalUrl] ?? pageData[page.url];
    const traffic = (data?.clicks ?? 0) * 3 + (data?.impressions ?? 0) / 100;
    const technical = (page.statusCode && page.statusCode >= 400 ? 1000 : 0) + (page.robots?.indexable === false ? 800 : 0) + (page.canonical && page.canonical !== page.finalUrl ? 300 : 0);
    const depth = page.depth * 10;
    const seed = [...page.finalUrl].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
    const score = config.inspectionStrategy === "errors" ? technical + traffic : config.inspectionStrategy === "traffic" ? traffic : config.inspectionStrategy === "sample" ? -seed : traffic + technical - depth + (index === 0 ? 500 : 0);
    return { url: page.finalUrl, score };
  });
  return scored.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, config.inspectUrls).map((item) => item.url);
}

export async function inspectUrls(client: GscClient, property: string, urls: string[]): Promise<GscInspectionResult[]> {
  const results: GscInspectionResult[] = [];
  for (const url of urls) {
    try { results.push(normalizeInspection(url, await client.inspectUrl(property, url))); }
    catch (error) { results.push({ url, verdict: "UNKNOWN", partial: true, error: { code: "gsc.inspection-error", message: error instanceof Error ? error.message : String(error), retryable: /quota|timeout|429|5\d\d/i.test(String(error)) } }); }
    await delay(20);
  }
  return results;
}