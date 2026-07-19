import * as cheerio from "cheerio";
import { fetchPage } from "../core/fetch-page.js";
import { issue, type AnalyzerResult, type SeoIssue } from "../core/issue.js";
import type { AuditContext } from "../core/audit-context.js";

function sitemapUrls(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("url > loc").map((_, el) => $(el).text().trim()).get().filter(Boolean);
}

export async function analyzeSitemap(context: AuditContext): Promise<AnalyzerResult> {
  const base = new URL(context.finalUrl);
  const issues: SeoIssue[] = [];
  const errors: string[] = [];
  const discovered: string[] = [];
  let xml = "";
  let source = "";

  try {
    const robots = await fetchPage(new URL("/robots.txt", base).toString(), { timeoutMs: 8000, maxRedirects: 3, networkPolicy: context.networkPolicy });
    const sitemapLines = robots.html.match(/^sitemap:\s*(.+)$/gim) ?? [];
    discovered.push(...sitemapLines.map((line) => line.replace(/^sitemap:\s*/i, "").trim()));
  } catch (error) {
    errors.push(`robots.txt fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const candidates = [...new Set([...discovered, new URL("/sitemap.xml", base).toString()])];
  for (const candidate of candidates) {
    try {
      const result = await fetchPage(candidate, { timeoutMs: 10000, maxRedirects: 3, networkPolicy: context.networkPolicy });
      if (result.status < 400 && /<urlset|<sitemapindex/i.test(result.html)) {
        xml = result.html;
        source = result.finalUrl;
        break;
      }
    } catch (error) {
      errors.push(`sitemap candidate failed (${candidate}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!xml) {
    issues.push(issue({
      id: "sitemap.not-found",
      category: "sitemap",
      severity: "medium",
      title: "No sitemap could be fetched",
      description: "No valid sitemap was discovered through robots.txt or /sitemap.xml.",
      evidence: { candidates },
      recommendation: "Expose a valid XML sitemap and list it in robots.txt.",
      affectedUrl: context.finalUrl
    }));
    return { category: "sitemap", issues, summary: { candidates, urlCount: 0 }, errors };
  }

  const urls = sitemapUrls(xml);
  const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
  const outsideDomain = urls.filter((url) => {
    try {
      return new URL(url).hostname !== base.hostname;
    } catch {
      return true;
    }
  });
  const nonHttps = urls.filter((url) => {
    try {
      return new URL(url).protocol !== "https:";
    } catch {
      return false;
    }
  });
  if (urls.length === 0) {
    issues.push(issue({
      id: "sitemap.empty-or-invalid",
      category: "sitemap",
      severity: "high",
      title: "Sitemap has no URL entries",
      description: "The fetched XML did not contain url loc entries.",
      evidence: { source },
      recommendation: "Provide a urlset sitemap or handle sitemap indexes in the next crawl stage.",
      affectedUrl: source
    }));
  }
  if (duplicates.length > 0) {
    issues.push(issue({
      id: "sitemap.duplicate-urls",
      category: "sitemap",
      severity: "low",
      title: "Sitemap contains duplicate URLs",
      description: "Duplicate sitemap entries waste crawl attention.",
      evidence: { count: duplicates.length, examples: [...new Set(duplicates)].slice(0, 10) },
      recommendation: "Deduplicate sitemap URL entries.",
      affectedUrl: source
    }));
  }
  if (outsideDomain.length > 0) {
    issues.push(issue({
      id: "sitemap.outside-domain",
      category: "sitemap",
      severity: "medium",
      title: "Sitemap contains URLs outside the audited domain",
      description: "Sitemaps should normally list URLs for their own verified host.",
      evidence: { examples: outsideDomain.slice(0, 10) },
      recommendation: "Move external URLs to their own domain sitemap.",
      affectedUrl: source
    }));
  }
  if (nonHttps.length > 0) {
    issues.push(issue({
      id: "sitemap.non-https-urls",
      category: "sitemap",
      severity: "medium",
      title: "Sitemap contains non-HTTPS URLs",
      description: "HTTP URLs in sitemaps can conflict with HTTPS canonicalization.",
      evidence: { examples: nonHttps.slice(0, 10) },
      recommendation: "Use HTTPS canonical URLs in XML sitemaps.",
      affectedUrl: source
    }));
  }

  return {
    category: "sitemap",
    issues,
    summary: { source, candidates, urlCount: urls.length, duplicates: duplicates.length, outsideDomain: outsideDomain.length, nonHttps: nonHttps.length },
    errors
  };
}

