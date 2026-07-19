import type { CrawlConfig } from "./crawl-config.js";
import { isSameAllowedDomain, normalizeUrl, urlPatternKey } from "./url-normalizer.js";

const NON_HTML_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|mp4|webm|mov|avi|zip|rar|7z|tar|gz|pdf|docx?|xlsx?|pptx?|woff2?|ttf|eot|exe|dmg|iso)(?:[?#]|$)/i;
const BLOCKED_PATH = /(?:^|\/)(?:logout|log-out|signout|sign-out|admin|wp-admin|cart|basket|checkout|my-account)(?:\/|$)/i;
const CALENDAR_PATH = /(?:calendar|events)\/\d{4}\/(?:\d{1,2})(?:\/\d{1,2})?/i;
const FACET_PARAMS = new Set(["sort", "filter", "filters", "facet", "facets", "orderby", "dir", "color", "size"]);

export type UrlFilterState = {
  patternCounts: Map<string, number>;
};

export type UrlFilterDecision = {
  allowed: boolean;
  normalizedUrl?: string;
  reason?: string;
};

export function createUrlFilterState(): UrlFilterState {
  return { patternCounts: new Map() };
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

export function filterUrl(rawUrl: string, rootUrl: string, config: CrawlConfig, state: UrlFilterState): UrlFilterDecision {
  let url: URL;
  try {
    url = new URL(rawUrl, rootUrl);
  } catch {
    return { allowed: false, reason: "invalid-url" };
  }
  if (!["http:", "https:"].includes(url.protocol)) return { allowed: false, reason: "non-http-protocol" };
  const normalizedUrl = normalizeUrl(url.toString());
  if (!isSameAllowedDomain(normalizedUrl, rootUrl, config.includeSubdomains)) return { allowed: false, normalizedUrl, reason: "outside-domain" };
  if (normalizedUrl.length > 2048) return { allowed: false, normalizedUrl, reason: "url-too-long" };
  if (NON_HTML_EXT.test(url.pathname)) return { allowed: false, normalizedUrl, reason: "non-html-resource" };
  if (BLOCKED_PATH.test(url.pathname)) return { allowed: false, normalizedUrl, reason: "blocked-path" };
  if (CALENDAR_PATH.test(url.pathname)) return { allowed: false, normalizedUrl, reason: "calendar-pattern" };
  if ([...url.searchParams.keys()].some((key) => FACET_PARAMS.has(key.toLowerCase()))) return { allowed: false, normalizedUrl, reason: "facet-or-sort-param" };
  if (config.includePatterns.length > 0 && !matchesAny(normalizedUrl, config.includePatterns)) return { allowed: false, normalizedUrl, reason: "not-in-include-patterns" };
  if (matchesAny(normalizedUrl, config.excludePatterns)) return { allowed: false, normalizedUrl, reason: "exclude-pattern" };
  const key = urlPatternKey(normalizedUrl);
  const count = state.patternCounts.get(key) ?? 0;
  if (count >= 20) return { allowed: false, normalizedUrl, reason: "repeated-url-pattern" };
  state.patternCounts.set(key, count + 1);
  return { allowed: true, normalizedUrl };
}