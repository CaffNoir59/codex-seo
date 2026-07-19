import { getGscAccessToken, type GscAuthConfig } from "./gsc-auth.js";
import { GscError } from "./gsc-errors.js";
import type { SearchAnalyticsRequest } from "./gsc-query-builder.js";

export type RawSearchAnalyticsRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
export type RawSearchAnalyticsResponse = { rows?: RawSearchAnalyticsRow[]; responseAggregationType?: string };
export type RawInspectionResponse = Record<string, unknown>;
export type GscClient = {
  listProperties(): Promise<string[]>;
  querySearchAnalytics(property: string, request: SearchAnalyticsRequest): Promise<RawSearchAnalyticsResponse>;
  inspectUrl(property: string, url: string): Promise<RawInspectionResponse>;
};

export class GoogleSearchConsoleClient implements GscClient {
  private token?: { value: string; expiresAt: number };
  constructor(private readonly auth: GscAuthConfig, private readonly fetchImpl: typeof fetch = fetch) {}
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60000) return this.token.value;
    const token = await getGscAccessToken(this.auth, this.fetchImpl);
    this.token = { value: token.accessToken, expiresAt: token.expiresAt };
    return token.accessToken;
  }
  private async google<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    const response = await this.fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryable = response.status === 429 || response.status >= 500 || Boolean(retryAfter);
      throw new GscError("gsc.google-api-error", `Google Search Console API failed with status ${response.status}${retryAfter ? `; retry-after=${retryAfter}` : ""}`, retryable);
    }
    return await response.json() as T;
  }
  async listProperties(): Promise<string[]> {
    const body = await this.google<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>("https://www.googleapis.com/webmasters/v3/sites");
    return (body.siteEntry ?? []).map((item) => item.siteUrl).filter((item): item is string => Boolean(item));
  }
  async querySearchAnalytics(property: string, request: SearchAnalyticsRequest): Promise<RawSearchAnalyticsResponse> {
    return await this.google<RawSearchAnalyticsResponse>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", body: JSON.stringify(request) });
  }
  async inspectUrl(property: string, url: string): Promise<RawInspectionResponse> {
    return await this.google<RawInspectionResponse>("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", body: JSON.stringify({ inspectionUrl: url, siteUrl: property }) });
  }
}

const currentRows: RawSearchAnalyticsRow[] = [
  { keys: ["https://example.test/", "codex seo"], clicks: 520, impressions: 12000, ctr: 0.0433, position: 3.2 },
  { keys: ["https://example.test/low-ctr", "seo audit checklist"], clicks: 420, impressions: 100000, ctr: 0.0042, position: 8 },
  { keys: ["https://example.test/slow", "technical seo audit"], clicks: 900, impressions: 45000, ctr: 0.02, position: 6.8 },
  { keys: ["https://example.test/noindex", "indexing diagnostics"], clicks: 80, impressions: 8000, ctr: 0.01, position: 11.2 },
  { keys: ["https://example.test/deep", "internal linking seo"], clicks: 210, impressions: 24000, ctr: 0.0088, position: 9.4 },
  { keys: ["https://example.test/canonical", "canonical issue"], clicks: 180, impressions: 18000, ctr: 0.01, position: 12.1 },
  { keys: ["https://example.test/unmatched", "orphan landing page"], clicks: 160, impressions: 15000, ctr: 0.0107, position: 10.5 },
  { keys: ["https://example.test/rising", "new seo trend"], clicks: 700, impressions: 30000, ctr: 0.0233, position: 5.1 },
  { keys: ["https://example.test/cannibal-a", "duplicate seo query"], clicks: 90, impressions: 10000, ctr: 0.009, position: 13 },
  { keys: ["https://example.test/cannibal-b", "duplicate seo query"], clicks: 70, impressions: 9000, ctr: 0.0078, position: 14 }
];
const previousRows: RawSearchAnalyticsRow[] = [
  { keys: ["https://example.test/", "codex seo"], clicks: 540, impressions: 12200, ctr: 0.0442, position: 3.1 },
  { keys: ["https://example.test/low-ctr", "seo audit checklist"], clicks: 620, impressions: 98000, ctr: 0.0063, position: 7.9 },
  { keys: ["https://example.test/slow", "technical seo audit"], clicks: 1200, impressions: 47000, ctr: 0.0255, position: 5.8 },
  { keys: ["https://example.test/legacy", "old query"], clicks: 220, impressions: 18000, ctr: 0.0122, position: 9.7 },
  { keys: ["https://example.test/rising", "new seo trend"], clicks: 250, impressions: 22000, ctr: 0.0114, position: 8.4 }
];

export class MockGscClient implements GscClient {
  async listProperties(): Promise<string[]> { return ["sc-domain:example.test", "https://example.test/"]; }
  async querySearchAnalytics(_property: string, request: SearchAnalyticsRequest): Promise<RawSearchAnalyticsResponse> {
    const rows = request.startDate < "2026-06-01" ? previousRows : currentRows;
    const start = request.startRow ?? 0;
    const end = start + request.rowLimit;
    return { rows: rows.slice(start, end), responseAggregationType: request.aggregationType ?? "auto" };
  }
  async inspectUrl(_property: string, url: string): Promise<RawInspectionResponse> {
    const blocked = url.includes("noindex");
    const canonical = url.includes("canonical");
    return { inspectionResult: { indexStatusResult: { verdict: blocked ? "FAIL" : "PASS", coverageState: blocked ? "Excluded by noindex" : "Submitted and indexed", indexingState: blocked ? "BLOCKED_BY_META_TAG" : "INDEXING_ALLOWED", robotsTxtState: url.includes("robots") ? "BLOCKED" : "ALLOWED", pageFetchState: url.includes("timeout") ? "TIMEOUT" : "SUCCESSFUL", googleCanonical: canonical ? "https://example.test/preferred" : url, userCanonical: canonical ? url : undefined, lastCrawlTime: "2026-06-28T10:00:00Z" }, mobileUsabilityResult: { verdict: "PASS" }, richResultsResult: { verdict: "PASS" } } };
  }
}