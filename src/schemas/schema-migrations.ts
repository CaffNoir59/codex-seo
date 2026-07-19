import { parseHistorySource } from "../history/history-entry.js";
import { validateSchema } from "./schema-registry.js";
import { getCurrentSchemaVersion, type SchemaType } from "./schema-versions.js";

export type SchemaMigrationResult = { migrated: unknown; sourceType: SchemaType | "unknown"; targetVersion: string; changed: boolean; warnings: string[] };
export function migrateSchema(document: unknown, targetVersion?: string): SchemaMigrationResult {
  const detected = validateSchema(document);
  const target = targetVersion ?? (detected.type === "unknown" ? "1.0.0" : getCurrentSchemaVersion(detected.type));
  if (detected.type === "baseline" || detected.type === "audit" || detected.type === "history") {
    const entry = parseHistorySource(document);
    return { migrated: entry, sourceType: detected.type, targetVersion: target, changed: detected.type !== "history", warnings: detected.warnings };
  }
  return { migrated: document, sourceType: detected.type, targetVersion: target, changed: false, warnings: detected.warnings };
}