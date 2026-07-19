import { z } from "zod";

export const CONFIG_SCHEMA_VERSION = "1.1.0";
export const deprecatedConfigKeys: Record<string, string> = { baseline: "diff.baseline", pagespeedKey: "performance.pagespeedApiKeyEnv", gscCredentials: "gsc.credentials" };

export const codexSeoConfigSchema = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION),
  target: z.object({ url: z.string().url().optional(), environment: z.string().default("production") }).default({ environment: "production" }),
  crawl: z.object({ enabled: z.boolean().default(false), maxPages: z.number().int().min(1).max(100000).default(100), maxDepth: z.number().int().min(0).max(50).default(4), render: z.enum(["auto", "always", "never"]).default("auto") }).default({}),
  performance: z.object({ enabled: z.boolean().default(false), mode: z.enum(["local", "pagespeed", "crux", "all"]).default("local"), device: z.enum(["mobile", "desktop"]).default("mobile"), runs: z.number().int().min(1).max(20).default(1), samplePages: z.number().int().min(1).max(1000).default(10), pagespeedApiKeyEnv: z.string().optional() }).default({}),
  gsc: z.object({ enabled: z.boolean().default(false), property: z.string().optional(), credentials: z.string().optional(), credentialsEnv: z.string().optional(), authMode: z.string().optional(), days: z.number().int().min(1).max(180).default(28), privacyMode: z.boolean().default(false) }).default({}),
  history: z.object({ enabled: z.boolean().default(false), dir: z.string().default(".codex-seo/history"), environment: z.string().default("production"), retentionDays: z.number().int().min(1).max(3650).optional(), maxEntries: z.number().int().min(1).max(100000).optional() }).default({}),
  diff: z.object({ failOnRegression: z.boolean().default(false), maxScoreDrop: z.number().min(0).max(100).optional(), maxNewCritical: z.number().int().min(0).optional(), maxNewHigh: z.number().int().min(0).optional(), strictCompatibility: z.boolean().default(false) }).default({}),
  output: z.object({ dir: z.string().default("reports"), pdf: z.boolean().default(false), format: z.enum(["console", "json"]).default("console") }).default({})
}).strict();

export type CodexSeoConfig = z.infer<typeof codexSeoConfigSchema>;
export type ConfigDiagnostic = { path: string; expected: string; received: string; suggestion: string; code: string; severity: "error" | "warning" };

export function defaultConfig(environment = "production"): CodexSeoConfig {
  return codexSeoConfigSchema.parse({ target: { environment }, history: { environment } });
}