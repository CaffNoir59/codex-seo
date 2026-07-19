import { z } from "zod";
import { seoBaselineSchema } from "../baseline/baseline-schema.js";
import { historyEntrySchema } from "../history/history-schema.js";
import { trendReportSchema } from "../trends/trend-schema.js";
import { codexSeoConfigSchema } from "../config/config-schema.js";
import { schemaTypes, schemaVersions, type SchemaType } from "./schema-versions.js";

const genericVersioned = z.object({ schemaVersion: z.string().optional() }).passthrough();
export function detectSchemaType(document: unknown): SchemaType | "unknown" {
  if (codexSeoConfigSchema.safeParse(document).success) return "configuration";
  if (historyEntrySchema.safeParse(document).success) return "history";
  if (trendReportSchema.safeParse(document).success) return "trend";
  if (seoBaselineSchema.safeParse(document).success) return "baseline";
  const raw = genericVersioned.safeParse(document);
  if (!raw.success || !document || typeof document !== "object") return "unknown";
  const value = document as Record<string, unknown>;
  if ("audit" in value && "summary" in value && "pages" in value) return "audit";
  if ("comparison" in value && "gate" in value) return "diff";
  if ("searchAnalytics" in value || "inspections" in value) return "gsc";
  if ("metrics" in value && "engine" in value) return "performance";
  return "unknown";
}
export function validateSchema(document: unknown): { ok: boolean; type: SchemaType | "unknown"; version?: string; warnings: string[] } {
  const type = detectSchemaType(document);
  const version = document && typeof document === "object" ? String((document as Record<string, unknown>).schemaVersion ?? "unknown") : undefined;
  const warnings: string[] = [];
  if (type !== "unknown" && version && version !== "unknown" && version > schemaVersions[type]) warnings.push(`Future ${type} schema ${version}; current is ${schemaVersions[type]}.`);
  return { ok: type !== "unknown", type, version, warnings };
}
export { schemaTypes, schemaVersions };