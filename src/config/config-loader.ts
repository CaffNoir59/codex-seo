import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { CONFIG_SCHEMA_VERSION, codexSeoConfigSchema, defaultConfig, deprecatedConfigKeys, type CodexSeoConfig, type ConfigDiagnostic } from "./config-schema.js";
import { redactSecrets } from "../core/redaction.js";
import { assertSafeWritePath } from "../security/path-safety.js";

import { migrateProjectConfig, projectConfigSchema } from "../project/config.js";
export function configErrorFromZod(error: ZodError): ConfigDiagnostic[] {
  return error.issues.map((issue) => ({ path: issue.path.join(".") || "config", expected: issue.code, received: issue.message, suggestion: "Check docs/configuration.md for the supported shape.", code: `config.${issue.code}`, severity: "error" }));
}

export function inspectConfigObject(raw: Record<string, unknown>): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  for (const key of Object.keys(raw)) {
    if (deprecatedConfigKeys[key]) diagnostics.push({ path: key, expected: deprecatedConfigKeys[key], received: key, suggestion: `Rename ${key} to ${deprecatedConfigKeys[key]}.`, code: "config.deprecated", severity: "warning" });
  }
  const secretText = JSON.stringify(raw);
  if (/private_key|client_secret|refresh_token|access_token|api_key|Bearer\s+/i.test(secretText)) diagnostics.push({ path: "config", expected: "secret references via environment variables", received: redactSecrets(secretText).slice(0, 120), suggestion: "Move secrets to environment variables or GitHub Secrets.", code: "config.secret-inline", severity: "error" });
  const gsc = raw.gsc as { enabled?: unknown; property?: unknown; credentials?: unknown; credentialsEnv?: unknown } | undefined;
  if (gsc?.enabled === true && !gsc.property) diagnostics.push({ path: "gsc.property", expected: "Search Console property", received: "missing", suggestion: "Set gsc.property or pass --gsc-property.", code: "config.gsc-incomplete", severity: "error" });
  return diagnostics;
}

export async function loadConfig(file = "codex-seo.config.json"): Promise<{ config?: CodexSeoConfig; diagnostics: ConfigDiagnostic[]; raw?: unknown; path: string }> {
  const resolved = path.resolve(file);
  const text = await readFile(resolved, "utf8").catch(() => undefined);
  if (text === undefined) return { path: resolved, diagnostics: [] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (error) { return { path: resolved, raw: text, diagnostics: [{ path: "config", expected: "valid JSON", received: error instanceof Error ? error.message : String(error), suggestion: "Fix JSON syntax.", code: "config.invalid-json", severity: "error" }] }; }
  const objectDiagnostics = raw && typeof raw === "object" && !Array.isArray(raw) ? inspectConfigObject(raw as Record<string, unknown>) : [];
  const parsed = projectConfigSchema.safeParse(migrateProjectConfig(raw).value);
  return { path: resolved, raw, config: parsed.success ? parsed.data : undefined, diagnostics: [...objectDiagnostics, ...(parsed.success ? [] : configErrorFromZod(parsed.error))] };
}

export function fixConfigObject(raw: unknown): { fixed: CodexSeoConfig; changed: boolean; warnings: string[] } {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  let changed = false;
  const warnings: string[] = [];
  for (const [oldKey, newPath] of Object.entries(deprecatedConfigKeys)) {
    if (oldKey in source) { warnings.push(`Renamed deprecated option ${oldKey} to ${newPath}.`); delete source[oldKey]; changed = true; }
  }
  if (source.schemaVersion !== CONFIG_SCHEMA_VERSION) { source.schemaVersion = CONFIG_SCHEMA_VERSION; changed = true; }
  const fixed = codexSeoConfigSchema.parse({ ...defaultConfig(), ...source });
  return { fixed, changed, warnings };
}

export async function validateConfigFile(file = "codex-seo.config.json", options: { fix?: boolean } = {}) {
  const loaded = await loadConfig(file);
  if (!options.fix) return loaded;
  const raw = loaded.raw ?? {};
  const fixed = fixConfigObject(raw);
  if (fixed.changed) {
    const target = await assertSafeWritePath(loaded.path, { mustBeFile: true });
    const exists = await stat(target).then(() => true).catch(() => false);
    if (exists) await copyFile(target, `${target}.bak`);
    await writeFile(target, `${JSON.stringify(fixed.fixed, null, 2)}\n`, "utf8");
  }
  return await loadConfig(file);
}