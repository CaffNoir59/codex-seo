import { z } from "zod";
import { seoIssueSchema } from "../core/issue.js";
import { gscPageAttachmentSchema } from "../gsc/gsc-schema.js";

export const crawlResultTypes = ["success", "http-error", "fetch-error", "render-error", "robots-blocked", "filtered", "non-html"] as const;

export const crawledPageSchema = z.object({
  url: z.string().url(),
  requestedUrl: z.string().url().optional(),
  finalUrl: z.string().url(),
  depth: z.number().int().nonnegative(),
  resultType: z.enum(crawlResultTypes).optional(),
  statusCode: z.number().int().optional(),
  statusGroup: z.enum(["2xx", "3xx", "4xx", "5xx", "none"]).optional(),
  contentType: z.string().optional(),
  fetchMode: z.enum(["http", "browser"]),
  discoveredFrom: z.string().optional(),
  redirectCount: z.number().int().nonnegative().optional(),
  redirectChain: z.array(z.string().url()).optional(),
  redirectType: z.string().optional(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  h1: z.string().optional(),
  pageIntent: z.string().optional(),
  contentFingerprint: z.string().optional(),
  contentSignature: z.array(z.string()).optional(),
  canonical: z.string().nullable().optional(),
  robots: z.object({
    indexable: z.boolean(),
    followable: z.boolean()
  }).optional(),
  timings: z.object({
    durationMs: z.number().int().nonnegative()
  }).optional(),
  links: z.object({
    internal: z.array(z.string().url()),
    external: z.array(z.string().url()),
    emptyAnchors: z.array(z.string().url()).optional(),
    genericAnchors: z.array(z.string().url()).optional()
  }),
  issues: z.array(seoIssueSchema),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional(),
  gsc: gscPageAttachmentSchema.optional()
});

export type CrawledPage = z.infer<typeof crawledPageSchema>;
export type CrawlResultType = z.infer<typeof crawledPageSchema>["resultType"];

export type SkippedUrl = {
  url: string;
  normalizedUrl: string;
  reason: string;
  discoveredFrom?: string;
  depth: number;
};

export type CrawlStats = {
  discoveredUrls: number;
  attemptedPages?: number;
  fetchedPages?: number;
  successfulPages?: number;
  failedPages: number;
  httpErrorPages?: number;
  fetchFailurePages?: number;
  renderFailurePages?: number;
  crawledPages?: number;
  reportEntries?: number;
  skippedUrls: number;
  blockedByRobots: number;
  sitemapUrls: number;
  robotsErrors: string[];
  exclusions: Record<string, number>;
  statusCodes: Record<string, number>;
  resultTypes?: Record<string, number>;
  depthDistribution: Record<string, number>;
  invariants?: { passed: boolean; errors: string[] };
};

export type CrawlResult = {
  startUrl: string;
  normalizedStartUrl: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  configuration: Record<string, unknown>;
  pages: CrawledPage[];
  skipped: SkippedUrl[];
  stats: CrawlStats;
  sitemap: {
    discoveredSitemaps: string[];
    urls: string[];
    errors: string[];
    outsideDomain: string[];
    reliability?: "reliable" | "local-cross-origin" | "local-missing" | "network-error" | "blocked" | "unknown";
    warnings?: string[];
  };
};

