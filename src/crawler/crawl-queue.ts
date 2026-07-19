import { normalizeUrl } from "./url-normalizer.js";

export type QueueItem = {
  url: string;
  depth: number;
  discoveredFrom?: string;
};

export class CrawlQueue {
  private pending = new Map<string, QueueItem>();
  private seen = new Set<string>();

  add(rawUrl: string, depth: number, discoveredFrom?: string): boolean {
    const url = normalizeUrl(rawUrl);
    if (this.seen.has(url)) return false;
    const existing = this.pending.get(url);
    if (existing) {
      if (depth < existing.depth || (depth === existing.depth && existing.discoveredFrom === "sitemap" && discoveredFrom && discoveredFrom !== "sitemap")) {
        this.pending.set(url, { url, depth, discoveredFrom });
      }
      return false;
    }
    this.pending.set(url, { url, depth, discoveredFrom });
    return true;
  }

  markSeen(url: string): void {
    this.seen.add(normalizeUrl(url));
  }

  hasSeen(url: string): boolean {
    return this.seen.has(normalizeUrl(url));
  }

  nextBatch(limit: number): QueueItem[] {
    const sorted = [...this.pending.values()].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
    const minDepth = sorted[0]?.depth;
    const batch = sorted.filter((item) => item.depth === minDepth).slice(0, limit);
    for (const item of batch) this.pending.delete(item.url);
    return batch;
  }


  pendingItems(): QueueItem[] {
    return [...this.pending.values()].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  }
  get size(): number {
    return this.pending.size;
  }
}



