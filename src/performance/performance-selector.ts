import type { CrawledPage } from "../crawler/crawl-result.js";
import type { PerformanceConfig } from "./performance-schema.js";

function matches(value: string, patterns: string[]): boolean {
  return patterns.length === 0 || patterns.some((pattern) => new RegExp(pattern).test(value));
}
function excluded(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}
function templateKey(url: string): string {
  const parsed = new URL(url);
  const first = parsed.pathname.split("/").filter(Boolean)[0] ?? "home";
  return first.replace(/\d+/g, ":num");
}

export function selectPerformancePages(pages: CrawledPage[], config: PerformanceConfig): CrawledPage[] {
  const candidates = pages.filter((page) => !page.error && matches(page.finalUrl, config.includePatterns) && !excluded(page.finalUrl, config.excludePatterns));
  if (config.strategy === "all") return candidates.slice(0, config.samplePages).sort((a, b) => a.depth - b.depth || a.finalUrl.localeCompare(b.finalUrl));
  if (config.strategy === "sample") {
    const byDepth = new Map<number, CrawledPage[]>();
    for (const page of candidates) byDepth.set(page.depth, [...(byDepth.get(page.depth) ?? []), page]);
    const selected: CrawledPage[] = [];
    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const group = (byDepth.get(depth) ?? []).sort((a, b) => a.finalUrl.localeCompare(b.finalUrl));
      if (group[0]) selected.push(group[0]);
      if (selected.length >= config.samplePages) break;
    }
    return selected.slice(0, config.samplePages);
  }
  const incoming = new Map<string, number>();
  for (const page of candidates) for (const link of page.links.internal) incoming.set(link, (incoming.get(link) ?? 0) + 1);
  const seenTemplates = new Set<string>();
  return candidates.sort((a, b) => {
    const homeA = a.depth === 0 ? -1000 : 0;
    const homeB = b.depth === 0 ? -1000 : 0;
    const scoreA = homeA + a.depth * 10 - (incoming.get(a.finalUrl) ?? 0) - a.issues.length;
    const scoreB = homeB + b.depth * 10 - (incoming.get(b.finalUrl) ?? 0) - b.issues.length;
    return scoreA - scoreB || a.finalUrl.localeCompare(b.finalUrl);
  }).filter((page) => {
    const key = templateKey(page.finalUrl);
    if (!seenTemplates.has(key)) { seenTemplates.add(key); return true; }
    return config.samplePages > seenTemplates.size;
  }).slice(0, config.samplePages);
}
