import type { SeoBaseline } from "../baseline/baseline-schema.js";

export type CompatibilityResult = { compatible: boolean; warnings: string[]; incomplete: boolean };

export function checkCompatibility(previous: SeoBaseline, current: SeoBaseline): CompatibilityResult {
  const warnings: string[] = [];
  if (previous.baseline.auditMode !== current.baseline.auditMode) warnings.push(`audit mode differs: ${previous.baseline.auditMode} vs ${current.baseline.auditMode}`);
  if (new URL(previous.baseline.startUrl).hostname !== new URL(current.baseline.startUrl).hostname) warnings.push(`domain differs: ${previous.baseline.startUrl} vs ${current.baseline.startUrl}`);
  if (previous.schemaVersion !== current.schemaVersion) warnings.push(`schema version differs: ${previous.schemaVersion} vs ${current.schemaVersion}`);
  for (const key of ["maxPages", "maxDepth", "renderMode", "includeSubdomains", "respectRobots"] as const) {
    if (previous.configuration[key] !== current.configuration[key]) warnings.push(`configuration differs: ${key} ${previous.configuration[key]} vs ${current.configuration[key]}`);
  }
  const prevPages = Number(previous.snapshot.metrics.crawledPages ?? previous.snapshot.pages.length);
  const currPages = Number(current.snapshot.metrics.crawledPages ?? current.snapshot.pages.length);
  if (prevPages > 0 && Math.abs(currPages - prevPages) / prevPages > 0.5) warnings.push(`major crawled page count difference: ${prevPages} vs ${currPages}`);
  if (Number(current.snapshot.metrics.skippedUrls ?? 0) > 0 && Number(current.configuration.maxPages ?? Infinity) <= currPages) warnings.push("current crawl may have reached its page budget");
  if (Number(current.snapshot.metrics.failedPages ?? 0) > 5) warnings.push("current crawl has many failed pages");
  if (Number(current.snapshot.metrics.blockedByRobots ?? 0) > Number(previous.snapshot.metrics.blockedByRobots ?? 0)) warnings.push("robots blocked more pages in current crawl");
  const incomplete = warnings.some((warning) => /budget|failed|robots|page count/i.test(warning));
  return { compatible: !warnings.some((warning) => /audit mode|domain|schema version/i.test(warning)), warnings: warnings.sort(), incomplete };
}
