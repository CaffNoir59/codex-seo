import * as cheerio from "cheerio";
import zlib from "node:zlib";
import { fetch, Headers } from "undici";
import { assertPolicyUrl, createNetworkAccessPolicy, type NetworkAccessPolicy } from "../core/network-policy.js";
import { getVersion } from "../version.js";
import type { CrawlConfig } from "./crawl-config.js";
import { getRobotsRules } from "./robots.js";
import { isSameAllowedDomain, normalizeUrl } from "./url-normalizer.js";

export type SitemapDiscovery = {
  discoveredSitemaps: string[];
  urls: string[];
  errors: string[];
  outsideDomain: string[];
  reliability?: "reliable" | "local-cross-origin" | "local-missing" | "network-error" | "blocked" | "unknown";
  warnings?: string[];
};

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function isLocalOrigin(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function fetchSitemap(url: string, networkPolicy?: NetworkAccessPolicy): Promise<string> {
  await assertPolicyUrl(url, networkPolicy);
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { "user-agent": `CodexSEO/${getVersion()}` } });
  if (response.status >= 400) throw new Error(`sitemap-status-${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = headersToObject(response.headers)["content-type"] ?? "";
  if (url.endsWith(".gz") || contentType.includes("gzip")) return zlib.gunzipSync(bytes).toString("utf8");
  return bytes.toString("utf8");
}

function parseSitemap(xml: string): { urls: string[]; indexes: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  return {
    urls: $("url > loc").map((_, el) => $(el).text().trim()).get().filter(Boolean),
    indexes: $("sitemap > loc").map((_, el) => $(el).text().trim()).get().filter(Boolean)
  };
}

function classifyReliability(root: string, initial: string[], errors: string[], urls: Set<string>, config: CrawlConfig): Pick<SitemapDiscovery, "reliability" | "warnings"> {
  const warnings: string[] = [];
  const local = isLocalOrigin(root) || String(config.environment ?? "").toLowerCase() === "development";
  const crossOrigin = initial.some((item) => new URL(item).origin !== new URL(root).origin);
  if (local && crossOrigin) {
    warnings.push("Sitemap reference points to a different origin during a local/development audit; sitemap coverage is not reliable.");
    return { reliability: "local-cross-origin", warnings };
  }
  if (local && urls.size === 0 && errors.some((error) => /sitemap-status-404/.test(error))) {
    warnings.push("Local sitemap is not available; sitemap coverage is not treated as production evidence.");
    return { reliability: "local-missing", warnings };
  }
  if (errors.some((error) => /Blocked|blocked/i.test(error))) return { reliability: "blocked", warnings };
  if (errors.length > 0 && urls.size === 0) return { reliability: "network-error", warnings };
  return { reliability: urls.size > 0 ? "reliable" : "unknown", warnings };
}

export async function discoverSitemaps(startUrl: string, config: CrawlConfig): Promise<SitemapDiscovery> {
  const root = normalizeUrl(startUrl);
  const networkPolicy = config.networkPolicy ?? createNetworkAccessPolicy(root, { allowPrivateNetwork: config.allowPrivateNetwork });
  const robots = await getRobotsRules(root, networkPolicy);
  const initial = [...new Set([...robots.sitemaps, new URL("/sitemap.xml", root).toString()])].sort();
  const seenSitemaps = new Set<string>();
  const urls = new Set<string>();
  const outsideDomain = new Set<string>();
  const errors: string[] = [];

  async function visit(sitemapUrl: string, depth: number): Promise<void> {
    const normalized = normalizeUrl(sitemapUrl);
    if (seenSitemaps.has(normalized) || depth > config.sitemapMaxDepth) return;
    seenSitemaps.add(normalized);
    try {
      const xml = await fetchSitemap(normalized, networkPolicy);
      const parsed = parseSitemap(xml);
      for (const url of parsed.urls) {
        try {
          const normalizedUrl = normalizeUrl(url);
          if (isSameAllowedDomain(normalizedUrl, root, config.includeSubdomains)) urls.add(normalizedUrl);
          else outsideDomain.add(normalizedUrl);
        } catch {
          errors.push(`invalid-sitemap-url:${url}`);
        }
      }
      for (const child of parsed.indexes.sort()) await visit(child, depth + 1);
    } catch (error) {
      errors.push(`${normalized}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const sitemap of initial) await visit(sitemap, 0);
  const reliability = classifyReliability(root, initial, errors, urls, config);
  return {
    discoveredSitemaps: [...seenSitemaps].sort(),
    urls: [...urls].sort(),
    errors,
    outsideDomain: [...outsideDomain].sort(),
    ...reliability
  };
}

