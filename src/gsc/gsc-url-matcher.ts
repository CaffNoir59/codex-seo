import { normalizeUrl } from "../crawler/url-normalizer.js";
import type { CrawledPage } from "../crawler/crawl-result.js";
import type { GscSearchAnalyticsResult, GscUrlMatch } from "./gsc-schema.js";

export function matchGscUrlsToCrawl(result: GscSearchAnalyticsResult, pages: CrawledPage[]): { matches: GscUrlMatch[]; pageData: Record<string, { clicks: number; impressions: number; ctr: number; position: number; topQueries?: Array<{ keys: { query?: string; page?: string }; clicks: number; impressions: number; ctr: number; position: number }>; matchType: GscUrlMatch["matchType"] }> } {
  const exact = new Map<string, CrawledPage>();
  const normalized = new Map<string, CrawledPage[]>();
  const canonicals = new Map<string, CrawledPage[]>();
  for (const page of pages) {
    exact.set(page.finalUrl, page);
    const norm = normalizeUrl(page.finalUrl);
    normalized.set(norm, [...(normalized.get(norm) ?? []), page]);
    if (page.canonical) {
      const canonical = normalizeUrl(page.canonical, page.finalUrl);
      canonicals.set(canonical, [...(canonicals.get(canonical) ?? []), page]);
    }
  }
  const byPage = new Map<string, { clicks: number; impressions: number; weightedPosition: number; topQueries: NonNullable<ReturnType<typeof matchGscUrlsToCrawl>["pageData"][string]["topQueries"]> }>();
  const matches: GscUrlMatch[] = [];
  for (const row of result.rows) {
    if (!row.keys.page) continue;
    const rawGscUrl = row.keys.page;
    const norm = normalizeUrl(rawGscUrl);
    let matchType: GscUrlMatch["matchType"] = "unmatched";
    let matched: string | undefined;
    if (exact.has(rawGscUrl)) { matchType = "exact"; matched = exact.get(rawGscUrl)?.finalUrl; }
    else if ((normalized.get(norm) ?? []).length === 1) { matchType = "normalized"; matched = normalized.get(norm)?.[0]?.finalUrl; }
    else if ((canonicals.get(norm) ?? []).length === 1) { matchType = "canonical"; matched = canonicals.get(norm)?.[0]?.finalUrl; }
    else if ((normalized.get(norm) ?? []).length > 1 || (canonicals.get(norm) ?? []).length > 1) { matchType = "ambiguous"; }
    matches.push({ rawGscUrl, normalizedUrl: norm, matchedCrawlUrl: matched, matchType });
    if (matched) {
      const current = byPage.get(matched) ?? { clicks: 0, impressions: 0, weightedPosition: 0, topQueries: [] };
      current.clicks += row.clicks;
      current.impressions += row.impressions;
      current.weightedPosition += row.position * row.impressions;
      if (row.keys.query) current.topQueries.push(row as never);
      byPage.set(matched, current);
    }
  }
  const pageData: ReturnType<typeof matchGscUrlsToCrawl>["pageData"] = {};
  for (const [url, item] of byPage) {
    pageData[url] = { clicks: item.clicks, impressions: item.impressions, ctr: item.impressions ? item.clicks / item.impressions : 0, position: item.impressions ? item.weightedPosition / item.impressions : 0, topQueries: item.topQueries.sort((a, b) => b.impressions - a.impressions).slice(0, 5), matchType: matches.find((match) => match.matchedCrawlUrl === url)?.matchType ?? "exact" };
  }
  return { matches, pageData };
}