import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performanceResultSchema, type PerformanceResult } from "./performance-schema.js";

export type PerformanceCacheKey = {
  url: string;
  source: string;
  device: string;
  runs?: number;
  version: string;
};

function cacheFile(cacheDir: string, key: PerformanceCacheKey): string {
  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex");
  return path.join(cacheDir, `${hash}.json`);
}

export async function readPerformanceCache(cacheDir: string, key: PerformanceCacheKey, ttlMs: number): Promise<PerformanceResult | undefined> {
  try {
    const file = cacheFile(cacheDir, key);
    const raw = JSON.parse(await readFile(file, "utf8")) as { savedAt: string; result: unknown };
    const ageMs = Date.now() - Date.parse(raw.savedAt);
    if (!Number.isFinite(ageMs) || ageMs > ttlMs) return undefined;
    return performanceResultSchema.parse(raw.result);
  } catch {
    return undefined;
  }
}

export async function writePerformanceCache(cacheDir: string, key: PerformanceCacheKey, result: PerformanceResult): Promise<void> {
  if (result.error) return;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile(cacheDir, key), JSON.stringify({ savedAt: new Date().toISOString(), result }, null, 2), "utf8");
}