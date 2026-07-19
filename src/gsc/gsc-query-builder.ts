import type { GscConfig } from "./gsc-config.js";
import type { GscDimension } from "./gsc-schema.js";

export type GscFilter = { dimension: "query" | "page"; operator: "includingRegex" | "excludingRegex"; expression: string };
export type SearchAnalyticsRequest = {
  startDate: string;
  endDate: string;
  dimensions: GscDimension[];
  searchType: string;
  rowLimit: number;
  startRow: number;
  dataState: string;
  aggregationType?: string;
  dimensionFilterGroups?: Array<{ groupType: "and"; filters: GscFilter[] }>;
};

function filter(dimension: "query" | "page", operator: GscFilter["operator"], expression: string): GscFilter {
  return { dimension, operator, expression };
}

export function buildGscFilters(config: GscConfig): GscFilter[] {
  const filters: GscFilter[] = [];
  for (const expression of config.includeQuery) filters.push(filter("query", "includingRegex", expression));
  for (const expression of config.excludeQuery) filters.push(filter("query", "excludingRegex", expression));
  for (const expression of config.includePage) filters.push(filter("page", "includingRegex", expression));
  for (const expression of config.excludePage) filters.push(filter("page", "excludingRegex", expression));
  for (const expression of config.brandQuery) filters.push(filter("query", config.nonBrand ? "excludingRegex" : "includingRegex", expression));
  return filters;
}

export function buildSearchAnalyticsRequest(config: GscConfig, startRow = 0, period?: { startDate: string; endDate: string }): SearchAnalyticsRequest {
  const filters = buildGscFilters(config);
  return {
    startDate: period?.startDate ?? config.startDate,
    endDate: period?.endDate ?? config.endDate,
    dimensions: config.dimensions,
    searchType: config.searchType,
    rowLimit: config.rowLimit,
    startRow,
    dataState: config.dataState,
    aggregationType: config.aggregationType === "auto" ? undefined : config.aggregationType,
    ...(filters.length ? { dimensionFilterGroups: [{ groupType: "and", filters }] } : {})
  };
}