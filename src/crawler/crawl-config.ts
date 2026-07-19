import { z } from "zod";
import type { NetworkAccessPolicy } from "../core/network-policy.js";

export const renderModes = ["auto", "always", "never"] as const;

export const crawlConfigSchema = z.object({
  maxPages: z.number().int().positive().default(100),
  maxDepth: z.number().int().nonnegative().default(4),
  concurrency: z.number().int().positive().max(12).default(4),
  includeSubdomains: z.boolean().default(false),
  respectRobots: z.boolean().default(true),
  render: z.enum(renderModes).default("auto"),
  cache: z.boolean().default(true),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  sitemapMaxDepth: z.number().int().nonnegative().default(3),
  duplicateSimilarityThreshold: z.number().min(0).max(1).default(0.86),
  allowPrivateNetwork: z.boolean().default(false),
  environment: z.string().optional(),
  networkPolicy: z.custom<NetworkAccessPolicy>().optional()
});

export type RenderMode = (typeof renderModes)[number];
export type CrawlConfig = z.infer<typeof crawlConfigSchema>;

export function resolveCrawlConfig(input: Partial<CrawlConfig> = {}): CrawlConfig {
  return crawlConfigSchema.parse(input);
}
