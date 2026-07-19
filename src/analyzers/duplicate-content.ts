import { issue, type SeoIssue } from "../core/issue.js";
import type { CrawlResult, CrawledPage } from "../crawler/crawl-result.js";

function groupBy<T>(items: T[], getKey: (item: T) => string | undefined | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function jaccard(a: string[] = [], b: string[] = []): number {
  if (a.length === 0 && b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function nearDuplicatePairs(pages: CrawledPage[], threshold: number): Array<{ a: string; b: string; similarity: number }> {
  const pairs: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      const left = pages[i];
      const right = pages[j];
      if (left.contentFingerprint && left.contentFingerprint === right.contentFingerprint) continue;
      const similarity = jaccard(left.contentSignature, right.contentSignature);
      if (similarity >= threshold) pairs.push({ a: left.url, b: right.url, similarity: Number(similarity.toFixed(3)) });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity || a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
}

export const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.86;

export function analyzeDuplicateContent(crawl: CrawlResult) {
  const issues: SeoIssue[] = [];
  const pages = crawl.pages.filter((page) => !page.error);
  const threshold = typeof crawl.configuration.duplicateSimilarityThreshold === "number"
    ? crawl.configuration.duplicateSimilarityThreshold
    : DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  const titleGroups = groupBy(pages, (page) => page.title);
  const canonicalGroups = groupBy(pages, (page) => page.canonical ?? undefined);
  const h1Groups = groupBy(pages, (page) => page.h1);
  const metaGroups = groupBy(pages, (page) => page.metaDescription);
  const fingerprintGroups = groupBy(pages, (page) => page.contentFingerprint);

  const duplicateCanonicals = [...canonicalGroups.entries()].filter(([, group]) => group.length > 1);
  const duplicateFingerprints = [...fingerprintGroups.entries()].filter(([, group]) => group.length > 1);
  const duplicateTitles = [...titleGroups.entries()].filter(([title, group]) => title && group.length > 1);
  const duplicateH1s = [...h1Groups.entries()].filter(([h1, group]) => h1 && group.length > 1);
  const duplicateMetas = [...metaGroups.entries()].filter(([meta, group]) => meta && group.length > 1);
  const nearDuplicates = nearDuplicatePairs(pages, threshold);

  if (duplicateTitles.length > 0) issues.push(issue({ id: "duplicate-content.duplicate-title", category: "duplicate-content", severity: "medium", title: "Duplicate title candidates detected", description: "Several pages share the same title evidence. This is a deterministic heuristic.", evidence: { examples: duplicateTitles.slice(0, 10).map(([title, group]) => ({ title, urls: group.map((page) => page.url) })) }, recommendation: "Give important pages unique titles aligned to their search intent." }));
  if (duplicateH1s.length > 0) issues.push(issue({ id: "duplicate-content.duplicate-h1", category: "duplicate-content", severity: "medium", title: "Duplicate H1 candidates detected", description: "Several pages share the same H1.", evidence: { examples: duplicateH1s.slice(0, 10).map(([h1, group]) => ({ h1, urls: group.map((page) => page.url) })) }, recommendation: "Use unique H1s for pages that target different intents." }));
  if (duplicateMetas.length > 0) issues.push(issue({ id: "duplicate-content.duplicate-meta-description", category: "duplicate-content", severity: "low", title: "Duplicate meta descriptions detected", description: "Several pages share the same meta description.", evidence: { examples: duplicateMetas.slice(0, 10).map(([metaDescription, group]) => ({ metaDescription, urls: group.map((page) => page.url) })) }, recommendation: "Write unique meta descriptions for important indexable pages." }));
  if (duplicateCanonicals.length > 0) issues.push(issue({ id: "duplicate-content.shared-canonical", category: "duplicate-content", severity: "medium", title: "Multiple pages share a canonical", description: "Shared canonicals can be intentional but may also hide duplicate or conflicting pages.", evidence: { examples: duplicateCanonicals.slice(0, 10).map(([canonical, group]) => ({ canonical, urls: group.map((page) => page.url) })) }, recommendation: "Confirm each shared canonical is intentional and not caused by template errors." }));
  if (duplicateFingerprints.length > 0) issues.push(issue({ id: "duplicate-content.exact-content-match", category: "duplicate-content", severity: "medium", title: "Exact duplicate page bodies detected", description: "Several pages have the same normalized body-text fingerprint.", evidence: { examples: duplicateFingerprints.slice(0, 10).map(([, group]) => group.map((page) => page.url)) }, recommendation: "Consolidate exact duplicates, add canonical signals, or add unique useful content." }));
  if (nearDuplicates.length > 0) issues.push(issue({ id: "duplicate-content.near-duplicate-content", category: "duplicate-content", severity: "low", title: "Near-duplicate content candidates detected", description: "Pages crossed the configured token-signature Jaccard similarity threshold.", evidence: { threshold, examples: nearDuplicates.slice(0, 20) }, recommendation: "Review near-duplicate groups and add differentiated main content where the pages target distinct intents." }));

  return { category: "duplicate-content" as const, issues, summary: { duplicateTitles: duplicateTitles.length, duplicateH1s: duplicateH1s.length, duplicateMetas: duplicateMetas.length, duplicateCanonicals: duplicateCanonicals.length, duplicateFingerprints: duplicateFingerprints.length, nearDuplicates: nearDuplicates.length, nearDuplicateThreshold: threshold } };
}
