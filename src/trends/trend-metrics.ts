import type { HistoryEntry } from "../history/history-schema.js";

export const trendMetrics = ["seo.score", "seo.issues.total", "seo.issues.critical", "seo.issues.high", "seo.issues.medium", "seo.issues.low", "crawl.pages.discovered", "crawl.pages.crawled", "crawl.brokenLinks", "crawl.indexablePages", "crawl.nonIndexablePages", "performance.lighthouseScore", "performance.internalScore", "performance.lcpMs", "performance.cls", "performance.inpMs", "performance.tbtMs", "performance.ttfbMs", "performance.transferBytes", "performance.requestCount", "gsc.clicks", "gsc.impressions", "gsc.ctr", "gsc.position", "gsc.opportunities", "gsc.trafficPagesWithErrors"] as const;
export type TrendMetric = (typeof trendMetrics)[number];
export type MetricDirection = "higher-is-better" | "lower-is-better";

export const metricDirections: Record<TrendMetric, MetricDirection> = {
  "seo.score": "higher-is-better",
  "seo.issues.total": "lower-is-better",
  "seo.issues.critical": "lower-is-better",
  "seo.issues.high": "lower-is-better",
  "seo.issues.medium": "lower-is-better",
  "seo.issues.low": "lower-is-better",
  "crawl.pages.discovered": "higher-is-better",
  "crawl.pages.crawled": "higher-is-better",
  "crawl.brokenLinks": "lower-is-better",
  "crawl.indexablePages": "higher-is-better",
  "crawl.nonIndexablePages": "lower-is-better",
  "performance.lighthouseScore": "higher-is-better",
  "performance.internalScore": "higher-is-better",
  "performance.lcpMs": "lower-is-better",
  "performance.cls": "lower-is-better",
  "performance.inpMs": "lower-is-better",
  "performance.tbtMs": "lower-is-better",
  "performance.ttfbMs": "lower-is-better",
  "performance.transferBytes": "lower-is-better",
  "performance.requestCount": "lower-is-better",
  "gsc.clicks": "higher-is-better",
  "gsc.impressions": "higher-is-better",
  "gsc.ctr": "higher-is-better",
  "gsc.position": "lower-is-better",
  "gsc.opportunities": "lower-is-better",
  "gsc.trafficPagesWithErrors": "lower-is-better"
};

export const defaultNoiseThresholds: Record<TrendMetric, number> = {
  "seo.score": 1,
  "seo.issues.total": 1,
  "seo.issues.critical": 1,
  "seo.issues.high": 1,
  "seo.issues.medium": 1,
  "seo.issues.low": 1,
  "crawl.pages.discovered": 1,
  "crawl.pages.crawled": 1,
  "crawl.brokenLinks": 1,
  "crawl.indexablePages": 1,
  "crawl.nonIndexablePages": 1,
  "performance.lighthouseScore": 2,
  "performance.internalScore": 2,
  "performance.lcpMs": 250,
  "performance.cls": 0.02,
  "performance.inpMs": 50,
  "performance.tbtMs": 100,
  "performance.ttfbMs": 100,
  "performance.transferBytes": 0.1,
  "performance.requestCount": 5,
  "gsc.clicks": 0.05,
  "gsc.impressions": 0.05,
  "gsc.ctr": 0.001,
  "gsc.position": 0.5,
  "gsc.opportunities": 1,
  "gsc.trafficPagesWithErrors": 1
};

export function metricValue(entry: HistoryEntry, metric: TrendMetric): number | undefined {
  switch (metric) {
    case "seo.score": return entry.summary.seoScore;
    case "seo.issues.total": return entry.summary.totalIssues;
    case "seo.issues.critical": return entry.summary.criticalIssues;
    case "seo.issues.high": return entry.summary.highIssues;
    case "seo.issues.medium": return entry.summary.mediumIssues;
    case "seo.issues.low": return entry.summary.lowIssues;
    case "crawl.pages.discovered": return entry.summary.pagesDiscovered;
    case "crawl.pages.crawled": return entry.summary.pagesCrawled;
    case "crawl.brokenLinks": return entry.summary.brokenLinks;
    case "crawl.indexablePages": return entry.summary.indexablePages;
    case "crawl.nonIndexablePages": return entry.summary.nonIndexablePages;
    case "performance.lighthouseScore": return entry.summary.performance?.lighthouseScore;
    case "performance.internalScore": return entry.summary.performance?.internalScore;
    case "performance.lcpMs": return entry.summary.performance?.lcpMs;
    case "performance.cls": return entry.summary.performance?.cls;
    case "performance.inpMs": return entry.summary.performance?.inpMs;
    case "performance.tbtMs": return entry.summary.performance?.tbtMs;
    case "performance.ttfbMs": return entry.summary.performance?.ttfbMs;
    case "performance.transferBytes": return entry.summary.performance?.transferBytes;
    case "performance.requestCount": return entry.summary.performance?.requestCount;
    case "gsc.clicks": return entry.summary.gsc?.clicks;
    case "gsc.impressions": return entry.summary.gsc?.impressions;
    case "gsc.ctr": return entry.summary.gsc?.ctr;
    case "gsc.position": return entry.summary.gsc?.position;
    case "gsc.opportunities": return entry.summary.gsc?.opportunities;
    case "gsc.trafficPagesWithErrors": return entry.summary.gsc?.trafficPagesWithErrors;
  }
}