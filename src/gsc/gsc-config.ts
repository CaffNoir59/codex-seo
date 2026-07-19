import { gscAggregationTypes, gscAuthModes, gscDataStates, gscDimensions, gscInspectionStrategies, gscSearchTypes, type GscAggregationType, type GscAuthMode, type GscDataState, type GscDimension, type GscInspectionStrategy, type GscSearchType } from "./gsc-schema.js";
import { GscError } from "./gsc-errors.js";

export type GscConfig = {
  enabled: boolean;
  property?: string;
  credentialsPath?: string;
  authMode?: GscAuthMode;
  startDate: string;
  endDate: string;
  days: number;
  comparePeriod: boolean;
  previousStartDate?: string;
  previousEndDate?: string;
  searchType: GscSearchType;
  dimensions: GscDimension[];
  rowLimit: number;
  maxRows: number;
  dataState: GscDataState;
  aggregationType: GscAggregationType;
  includeQuery: string[];
  excludeQuery: string[];
  includePage: string[];
  excludePage: string[];
  brandQuery: string[];
  nonBrand: boolean;
  cacheTtlSeconds: number;
  cacheEnabled: boolean;
  requireGscData: boolean;
  requireGscFinalData: boolean;
  inspectUrls: number;
  inspectionStrategy: GscInspectionStrategy;
  privacyMode: boolean;
  redactQueries: boolean;
  redactUrlPaths: boolean;
  mock: boolean;
};

function assertOne<T extends readonly string[]>(name: string, value: string, allowed: T): T[number] {
  if (!allowed.includes(value)) throw new GscError("gsc.invalid-option", `${name} must be one of: ${allowed.join(", ")}`);
  return value as T[number];
}

function asArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDimensions(value: string | undefined): GscDimension[] {
  const raw = value ? value.split(",").map((item) => item.trim()).filter(Boolean) : ["page", "query"];
  return raw.map((item) => assertOne("gsc-dimensions", item, gscDimensions));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fullDaysPeriod(now = new Date(), days = 28): { startDate: string; endDate: string; days: number } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - days + 1);
  return { startDate: dateOnly(start), endDate: dateOnly(end), days };
}

export function previousPeriod(startDate: string, endDate: string): { startDate: string; endDate: string; days: number } {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(start.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevEnd.getUTCDate() - days + 1);
  return { startDate: dateOnly(prevStart), endDate: dateOnly(prevEnd), days };
}

export function resolveGscConfig(input: Partial<Record<string, unknown>> = {}, now = new Date()): GscConfig {
  const days = Number(input.days ?? 28);
  if (!Number.isInteger(days) || days <= 0) throw new GscError("gsc.invalid-days", "gsc days must be a positive integer");
  const period = input.startDate && input.endDate ? { startDate: String(input.startDate), endDate: String(input.endDate), days } : fullDaysPeriod(now, days);
  const previous = previousPeriod(period.startDate, period.endDate);
  const rowLimit = Number(input.rowLimit ?? 25000);
  if (!Number.isInteger(rowLimit) || rowLimit <= 0 || rowLimit > 25000) throw new GscError("gsc.invalid-row-limit", "gsc row limit must be between 1 and 25000");
  const inspectUrls = Number(input.inspectUrls ?? 0);
  return {
    enabled: Boolean(input.enabled),
    property: typeof input.property === "string" ? input.property : undefined,
    credentialsPath: typeof input.credentialsPath === "string" ? input.credentialsPath : process.env.GOOGLE_APPLICATION_CREDENTIALS,
    authMode: input.authMode ? assertOne("gsc-auth-mode", String(input.authMode), gscAuthModes) : undefined,
    startDate: period.startDate,
    endDate: period.endDate,
    days: period.days,
    comparePeriod: Boolean(input.comparePeriod),
    previousStartDate: previous.startDate,
    previousEndDate: previous.endDate,
    searchType: assertOne("gsc-search-type", String(input.searchType ?? "web"), gscSearchTypes),
    dimensions: parseDimensions(typeof input.dimensions === "string" ? input.dimensions : undefined),
    rowLimit,
    maxRows: Number(input.maxRows ?? Math.max(rowLimit, 25000)),
    dataState: assertOne("gsc-data-state", String(input.dataState ?? "final"), gscDataStates),
    aggregationType: assertOne("gsc-aggregate", String(input.aggregationType ?? "auto"), gscAggregationTypes),
    includeQuery: asArray(input.includeQuery as string | string[] | undefined),
    excludeQuery: asArray(input.excludeQuery as string | string[] | undefined),
    includePage: asArray(input.includePage as string | string[] | undefined),
    excludePage: asArray(input.excludePage as string | string[] | undefined),
    brandQuery: asArray(input.brandQuery as string | string[] | undefined),
    nonBrand: Boolean(input.nonBrand),
    cacheTtlSeconds: Number(input.cacheTtlSeconds ?? 0),
    cacheEnabled: Number(input.cacheTtlSeconds ?? 0) > 0,
    requireGscData: Boolean(input.requireGscData),
    requireGscFinalData: Boolean(input.requireGscFinalData),
    inspectUrls: Number.isFinite(inspectUrls) ? Math.max(0, Math.min(200, inspectUrls)) : 0,
    inspectionStrategy: assertOne("gsc-inspection-strategy", String(input.inspectionStrategy ?? "important"), gscInspectionStrategies),
    privacyMode: Boolean(input.privacyMode),
    redactQueries: Boolean(input.redactQueries || input.privacyMode),
    redactUrlPaths: Boolean(input.redactUrlPaths),
    mock: Boolean(input.mock || process.env.CODEX_SEO_GSC_MOCK === "1" || String(input.property ?? "").endsWith("example.test"))
  };
}