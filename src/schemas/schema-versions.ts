export const schemaTypes = ["audit", "baseline", "diff", "performance", "gsc", "history", "trend", "configuration"] as const;
export type SchemaType = (typeof schemaTypes)[number];
export const schemaVersions: Record<SchemaType, string> = { audit: "1.0.0", baseline: "1.0.0", diff: "1.0.0", performance: "1.0.0", gsc: "1.0.0", history: "1.0.0", trend: "1.0.0", configuration: "1.0.0" };
export function getCurrentSchemaVersion(type: SchemaType): string { return schemaVersions[type]; }