import type { GscClient } from "./gsc-client.js";
import type { GscConfig } from "./gsc-config.js";
import { GscCache, gscCacheKey } from "./gsc-cache.js";
import { buildSearchAnalyticsRequest } from "./gsc-query-builder.js";
import { normalizeSearchAnalyticsResult } from "./gsc-normalizer.js";
import { paginateSearchAnalytics } from "./gsc-pagination.js";
import type { GscSearchAnalyticsResult } from "./gsc-schema.js";

export async function fetchSearchAnalytics(client: GscClient, property: string, config: GscConfig, cache = new GscCache({ enabled: config.cacheEnabled, ttlSeconds: config.cacheTtlSeconds })): Promise<GscSearchAnalyticsResult> {
  const cacheKey = gscCacheKey({ property, startDate: config.startDate, endDate: config.endDate, searchType: config.searchType, dimensions: config.dimensions, filters: { includeQuery: config.includeQuery, excludeQuery: config.excludeQuery, includePage: config.includePage, excludePage: config.excludePage, brandQuery: config.brandQuery, nonBrand: config.nonBrand }, aggregationType: config.aggregationType, dataState: config.dataState });
  const cached = await cache.get<GscSearchAnalyticsResult>(cacheKey);
  if (cached && !cached.partial) return { ...cached, fromCache: true };
  const firstRequest = buildSearchAnalyticsRequest(config, 0);
  let aggregationType: string | undefined;
  const result = await paginateSearchAnalytics(async (startRow) => {
    const response = await client.querySearchAnalytics(property, buildSearchAnalyticsRequest(config, startRow));
    aggregationType = response.responseAggregationType;
    return response;
  }, { rowLimit: config.rowLimit, maxRows: config.maxRows });
  const normalized = normalizeSearchAnalyticsResult({ property, config, rows: result.rows, partial: result.partial, warnings: result.warnings, aggregationType: aggregationType ?? firstRequest.aggregationType });
  await cache.set(cacheKey, normalized);
  return normalized;
}