import { setTimeout as delay } from "node:timers/promises";
import type { RawSearchAnalyticsRow } from "./gsc-client.js";
import { GscError } from "./gsc-errors.js";

export type PageFetcher = (startRow: number) => Promise<{ rows?: RawSearchAnalyticsRow[] }>;
export type PaginationResult = { rows: RawSearchAnalyticsRow[]; partial: boolean; warnings: string[]; pages: number };

function rowKey(row: RawSearchAnalyticsRow): string { return JSON.stringify([row.keys ?? [], row.clicks ?? 0, row.impressions ?? 0, row.ctr ?? 0, row.position ?? 0]); }

export async function paginateSearchAnalytics(fetchPage: PageFetcher, options: { rowLimit: number; maxRows: number; maxPages?: number; retries?: number }): Promise<PaginationResult> {
  const rows: RawSearchAnalyticsRow[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  let startRow = 0;
  let pages = 0;
  let partial = false;
  const maxPages = options.maxPages ?? Math.ceil(options.maxRows / options.rowLimit) + 1;
  while (rows.length < options.maxRows && pages < maxPages) {
    let response: { rows?: RawSearchAnalyticsRow[] } | undefined;
    let attempt = 0;
    while (!response) {
      try { response = await fetchPage(startRow); }
      catch (error) {
        const retryable = error instanceof GscError ? error.retryable : /429|5\d\d|timeout|retry-after/i.test(String(error));
        if (!retryable || attempt >= (options.retries ?? 2)) {
          warnings.push(`Pagination stopped after error at startRow ${startRow}`);
          partial = true;
          return { rows, partial, warnings, pages };
        }
        await delay(50 * 2 ** attempt);
        attempt += 1;
      }
    }
    const pageRows = response.rows ?? [];
    const before = rows.length;
    for (const row of pageRows) {
      const key = rowKey(row);
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
      if (rows.length >= options.maxRows) { partial = true; warnings.push(`Maximum GSC rows reached: ${options.maxRows}`); break; }
    }
    pages += 1;
    if (pageRows.length < options.rowLimit) break;
    if (rows.length === before) { partial = true; warnings.push("Pagination stopped because the API returned only duplicate rows"); break; }
    startRow += options.rowLimit;
  }
  if (pages >= maxPages) { partial = true; warnings.push("Pagination stopped by max page protection"); }
  return { rows, partial, warnings, pages };
}