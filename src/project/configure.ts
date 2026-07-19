import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { migrateProjectConfig, projectConfigSchema } from "./config.js";
import { findProjectConfig } from "./config.js";
import { redactObject } from "../core/redaction.js";

export type ConfigureSection = "deployment" | "automation" | "audit" | "mcp";
export type ConfigureOptions = {
  cwd?: string;
  dryRun?: boolean;
  provider?: "none" | "local-directory" | "ssh" | "sftp";
  hostEnv?: string;
  userEnv?: string;
  pathEnv?: string;
  port?: number;
  auth?: "agent" | "key";
  privateKeyPath?: string;
  passphraseEnv?: string;
  artifactPath?: string;
  localPath?: string;
  releaseStrategy?: "auto" | "symlink" | "rename" | "copy";
  healthCheckUrl?: string;
  automation?: Record<string, boolean>;
  crawl?: boolean;
  performance?: boolean;
};

function envReference(name: string | undefined, fallback: string): string {
  const selected = name ?? fallback;
  if (!/^[A-Z][A-Z0-9_]*$/.test(selected)) throw Object.assign(new Error("Environment variable names must use uppercase letters, digits, and underscores"), { code: "configure.environment-invalid" });
  return "$" + "{" + selected + "}";
}

export async function configureProject(section: ConfigureSection, options: ConfigureOptions = {}): Promise<{ changed: boolean; dryRun: boolean; path: string; backup?: string; config?: unknown }> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = await findProjectConfig(cwd);
  if (!configPath) throw Object.assign(new Error("Project configuration was not found; run codex-seo init first"), { code: "config.missing" });
  const raw = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const migrated = migrateProjectConfig(raw);
  const next = migrated.value as Record<string, unknown>;
  if (section === "deployment") {
    const existing = next.deployment && typeof next.deployment === "object" ? next.deployment as Record<string, unknown> : {};
    const provider = options.provider ?? String(existing.provider ?? "none") as ConfigureOptions["provider"];
    next.deployment = {
      ...existing,
      provider,
      artifactPath: options.artifactPath ?? existing.artifactPath,
      localPath: provider === "local-directory" ? options.localPath ?? existing.localPath ?? ".codex-seo/deployments/local" : existing.localPath,
      ...(provider === "ssh" || provider === "sftp" ? {
        host: envReference(options.hostEnv, "DEPLOY_HOST"),
        username: envReference(options.userEnv, "DEPLOY_USER"),
        remotePath: envReference(options.pathEnv, "DEPLOY_PATH"),
        port: options.port ?? existing.port ?? 22,
        authentication: options.auth === "key"
          ? { type: "key", privateKeyPath: options.privateKeyPath ?? ".codex-seo/secrets/deploy-key", ...(options.passphraseEnv ? { passphraseEnv: options.passphraseEnv } : {}) }
          : { type: "agent", agentEnv: "SSH_AUTH_SOCK" },
        releaseStrategy: options.releaseStrategy ?? existing.releaseStrategy ?? "auto",
        healthChecks: options.healthCheckUrl ? [{ type: "http", url: options.healthCheckUrl, expectedStatus: [200, 301, 302] }] : existing.healthChecks,
        hostVerification: existing.hostVerification ?? { strict: true }
      } : {})
    };
  } else if (section === "automation") {
    next.automation = { ...(next.automation as Record<string, unknown> ?? {}), ...(options.automation ?? {}) };
  } else if (section === "audit") {
    next.audit = { ...(next.audit as Record<string, unknown> ?? {}), ...(options.crawl === undefined ? {} : { crawl: options.crawl }), ...(options.performance === undefined ? {} : { performance: options.performance }) };
  }
  const parsed = projectConfigSchema.parse(next);
  const rendered = JSON.stringify(parsed, null, 2) + "\n";
  const original = await readFile(configPath, "utf8");
  const changed = rendered !== original;
  let backup: string | undefined;
  if (changed && !options.dryRun) {
    backup = configPath + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(configPath, backup);
    await writeFile(configPath, rendered, "utf8");
  }
  return { changed, dryRun: Boolean(options.dryRun), path: configPath, backup, config: redactObject(parsed, { privacyMode: true }) };
}
