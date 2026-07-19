import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z, type ZodError } from "zod";
import { codexSeoConfigSchema, type ConfigDiagnostic } from "../config/config-schema.js";
import { redactObject, redactSecrets } from "../core/redaction.js";

const commandSchema = z.string().trim().min(1).max(1000);
const validationStepSchema = z.object({
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  stopOnFailure: z.boolean().default(true),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000)
}).default({});

const healthCheckSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    url: z.string().optional(),
    path: z.string().startsWith("/").optional(),
    expectedStatus: z.array(z.number().int().min(100).max(599)).min(1).default([200]),
    expectedContent: z.string().max(500).optional(),
    forbiddenContent: z.string().max(500).optional(),
    allowRedirects: z.boolean().default(true),
    maxLatencyMs: z.number().int().min(1).max(300_000).optional(),
    timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
    retries: z.number().int().min(0).max(10).default(2),
    retryDelayMs: z.number().int().min(0).max(60_000).default(1_000)
  }),
  z.object({ type: z.literal("remote-file"), path: z.string().min(1), checksum: z.string().regex(/^[a-fA-F0-9]{64}$/).optional() }),
  z.object({ type: z.literal("remote-command"), command: z.enum(["php-version", "node-version", "disk-space", "current-release"]) })
]);

export const projectConfigSchema = codexSeoConfigSchema.extend({
  project: z.object({
    name: z.string().trim().min(1).max(120).default("Example Project"),
    root: z.string().default("."),
    productionUrl: z.string().optional(),
    developmentUrl: z.string().optional(),
    previewUrl: z.string().optional()
  }).default({}),
  commands: z.object({
    install: commandSchema.optional(),
    lint: commandSchema.optional(),
    typecheck: commandSchema.optional(),
    test: commandSchema.optional(),
    build: commandSchema.optional(),
    preview: commandSchema.optional()
  }).default({}),
  git: z.object({
    enabled: z.boolean().default(true),
    autoInitialize: z.boolean().default(true),
    createWorkBranches: z.boolean().default(true),
    defaultBranch: z.string().regex(/^[A-Za-z0-9._\/-]+$/).default("main"),
    requireCleanTree: z.boolean().default(false),
    requireCommitConfirmation: z.boolean().default(false)
  }).default({}),
  audit: z.object({
    crawl: z.boolean().default(true),
    performance: z.boolean().default(true),
    environment: z.string().default("production")
  }).default({}),
  validation: z.object({
    install: validationStepSchema.optional(),
    lint: validationStepSchema.optional(),
    typecheck: validationStepSchema.optional(),
    test: validationStepSchema.optional(),
    build: validationStepSchema.optional()
  }).default({}),
  preview: z.object({
    port: z.number().int().min(1).max(65535).default(3000),
    host: z.string().default("127.0.0.1"),
    startupTimeoutMs: z.number().int().min(100).max(300_000).default(30_000),
    commandTimeoutMs: z.number().int().min(100).max(86_400_000).default(3_600_000)
  }).default({}),
  deployment: z.object({
    provider: z.enum(["none", "local-directory", "ssh", "sftp"]).default("none"),
    requireConfirmation: z.boolean().default(true),
    artifactPath: z.string().optional(),
    localPath: z.string().optional(),
    host: z.string().optional(),
    user: z.string().optional(),
    username: z.string().optional(),
    port: z.number().int().min(1).max(65535).default(22),
    remotePath: z.string().optional(),
    releasesToKeep: z.number().int().min(1).max(100).default(5),
    healthCheckUrl: z.string().optional(),
    transport: z.object({
      connectTimeoutMs: z.number().int().min(100).max(300_000).default(15_000),
      operationTimeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
      reconnectAttempts: z.number().int().min(0).max(5).default(1),
      preserveTimestamps: z.boolean().default(true)
    }).default({}),
    authentication: z.discriminatedUnion("type", [
      z.object({ type: z.literal("agent"), agentEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default("SSH_AUTH_SOCK") }),
      z.object({ type: z.literal("key"), privateKeyPath: z.string().min(1), passphraseEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional() })
    ]).default({ type: "agent" }),
    hostVerification: z.object({
      strict: z.boolean().default(true),
      fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/=]+$/).optional(),
      knownHostsPath: z.string().optional()
    }).default({}),
    releaseStrategy: z.enum(["auto", "symlink", "rename", "copy"]).default("auto"),
    sharedPaths: z.array(z.string().min(1)).max(100).default([]),
    healthChecks: z.array(healthCheckSchema).max(50).default([]),
    regressionPolicy: z.object({
      minimumScoreDelta: z.number().min(-100).max(100).default(-2),
      failOnNewCriticalIssues: z.boolean().default(true),
      failOnNewHttp5xx: z.boolean().default(true),
      failOnBrokenCanonical: z.boolean().default(true),
      rollbackOnSevereRegression: z.boolean().default(true)
    }).default({}),
    retention: z.number().int().min(1).max(100).default(5),
    permissions: z.object({
      files: z.number().int().min(0).max(511).default(420),
      directories: z.number().int().min(0).max(511).default(493)
    }).default({}),
    release: z.object({
      markerFile: z.string().default(".codex-seo-release.json"),
      keepFailedRelease: z.boolean().default(true),
      createManifest: z.boolean().default(true),
      autoRollback: z.boolean().default(true)
    }).default({})
  }).default({}),
  automation: z.object({
    auditWithoutConfirmation: z.boolean().default(true),
    createSnapshotWithoutConfirmation: z.boolean().default(true),
    createBranchWithoutConfirmation: z.boolean().default(true),
    applyCodeChangesWithoutConfirmation: z.boolean().default(true),
    runValidationWithoutConfirmation: z.boolean().default(true),
    startPreviewWithoutConfirmation: z.boolean().default(true),
    commitWithoutConfirmation: z.boolean().default(true),
    prepareDeploymentWithoutConfirmation: z.boolean().default(true),
    deployRequiresConfirmation: z.boolean().default(true),
    rollbackOnFailureWithoutConfirmation: z.boolean().default(true),
    manualRollbackRequiresConfirmation: z.boolean().default(true),
    destructiveCleanupRequiresConfirmation: z.boolean().default(true)
  }).default({}),
  workflow: z.object({
    maxFixIterations: z.number().int().min(1).max(10).default(2),
    stateDirectory: z.string().default(".codex-seo/state/workflows"),
    resumeInterrupted: z.boolean().default(true)
  }).default({}),
  lighthouse: z.object({
    enabled: z.boolean().default(false),
    device: z.enum(["mobile", "desktop"]).default("mobile"),
    runs: z.number().int().min(1).max(20).default(1)
  }).default({}),
  release: z.object({
    channel: z.string().default("stable"),
    manifestDirectory: z.string().default(".codex-seo/releases")
  }).default({}),
  security: z.object({
    allowedReadBytes: z.number().int().min(1024).max(10_000_000).default(1_000_000),
    commandTimeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
    outputLimitBytes: z.number().int().min(1024).max(10_000_000).default(200_000)
  }).default({})
}).strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type LoadedProjectConfig = {
  path?: string;
  localPath?: string;
  root: string;
  config?: ProjectConfig;
  diagnostics: ConfigDiagnostic[];
};

export type ConfigMigration = { from: string; to: string; changes: string[]; value: unknown };

export function migrateProjectConfig(input: unknown): ConfigMigration {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { from: "unknown", to: "1.1.0", changes: [], value: input };
  const source = structuredClone(input as Record<string, unknown>);
  const from = typeof source.schemaVersion === "string" ? source.schemaVersion : "1.0.0";
  if (from === "1.1.0") return { from, to: from, changes: [], value: source };
  if (from !== "1.0.0") return { from, to: from, changes: [], value: source };
  const changes: string[] = ["schemaVersion"];
  source.schemaVersion = "1.1.0";
  const deployment = source.deployment && typeof source.deployment === "object" && !Array.isArray(source.deployment)
    ? source.deployment as Record<string, unknown>
    : undefined;
  if (deployment) {
    if (deployment.user !== undefined && deployment.username === undefined) {
      deployment.username = deployment.user;
      changes.push("deployment.user->username");
    }
    if (deployment.releasesToKeep !== undefined && deployment.retention === undefined) {
      deployment.retention = deployment.releasesToKeep;
      changes.push("deployment.releasesToKeep->retention");
    }
    if (typeof deployment.healthCheckUrl === "string" && deployment.healthChecks === undefined) {
      deployment.healthChecks = [{ type: "http", url: deployment.healthCheckUrl, expectedStatus: [200] }];
      changes.push("deployment.healthCheckUrl->healthChecks");
    }
  }
  return { from, to: "1.1.0", changes, value: source };
}

const forbiddenSecretKey = /(^|_)(password|passwd|privateKey|clientSecret|accessToken|refreshToken|apiKey|secret|token|credential)(_|$)/i;
const secretValuePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:ghp|github_pat|sk|sbp)_[A-Za-z0-9_-]{16,}\b/,
  /(?:password|passwd)\s*[:=]\s*[^$\s{][^\s,;]*/i
];

function diagnostic(pathName: string, code: string, received: string, suggestion: string): ConfigDiagnostic {
  return { path: pathName, expected: "safe Codex SEO project configuration", received: redactSecrets(received).slice(0, 160), suggestion, code, severity: "error" };
}

function zodDiagnostics(error: ZodError): ConfigDiagnostic[] {
  return error.issues.map((issue) => diagnostic(issue.path.join(".") || "config", `config.${issue.code}`, issue.message, "Review the documented project configuration schema."));
}

export function detectInlineSecrets(value: unknown, currentPath = "config"): ConfigDiagnostic[] {
  if (typeof value === "string") {
    if (value.includes("${") && value.includes("}")) return [];
    return secretValuePatterns.some((pattern) => pattern.test(value))
      ? [diagnostic(currentPath, "config.secret-inline", value, "Replace the value with an environment reference such as ${DEPLOY_HOST}.")]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => detectInlineSecrets(item, `${currentPath}.${index}`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const itemPath = `${currentPath}.${key}`;
    if (forbiddenSecretKey.test(key) && item !== undefined && typeof item !== "boolean" && !(typeof item === "string" && /^\$\{[A-Z][A-Z0-9_]*\}$/.test(item))) {
      return [diagnostic(itemPath, "config.secret-key", String(item), "Store the secret in the environment and reference its variable name.")];
    }
    return detectInlineSecrets(item, itemPath);
  });
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!base || typeof base !== "object" || Array.isArray(base)) return override;
  if (!override || typeof override !== "object" || Array.isArray(override)) return override;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

function resolveEnvironment(value: unknown, diagnostics: ConfigDiagnostic[], currentPath = "config"): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (token, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        const missing = diagnostic(currentPath, "config.environment-missing", token, `Define ${name} in the process environment or local machine configuration.`);
        diagnostics.push({ ...missing, severity: "warning" });
        return token;
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item, index) => resolveEnvironment(item, diagnostics, `${currentPath}.${index}`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveEnvironment(item, diagnostics, `${currentPath}.${key}`)]));
}

async function readJson(file: string): Promise<{ value?: unknown; diagnostics: ConfigDiagnostic[] }> {
  const content = await readFile(file, "utf8").catch(() => undefined);
  if (content === undefined) return { diagnostics: [] };
  try {
    return { value: JSON.parse(content), diagnostics: [] };
  } catch (error) {
    return { diagnostics: [diagnostic("config", "config.invalid-json", error instanceof Error ? error.message : String(error), `Fix JSON syntax in ${path.basename(file)}.`)] };
  }
}

export async function findProjectConfig(start = process.cwd(), explicit?: string, maxParents = 20): Promise<string | undefined> {
  if (explicit) return path.resolve(start, explicit);
  let current = path.resolve(start);
  for (let depth = 0; depth <= maxParents; depth += 1) {
    const candidate = path.join(current, "codex-seo.config.json");
    if (await stat(candidate).then((entry) => entry.isFile()).catch(() => false)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function inside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function loadProjectConfig(options: { cwd?: string; configPath?: string; resolveEnv?: boolean } = {}): Promise<LoadedProjectConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const publicPath = await findProjectConfig(cwd, options.configPath);
  if (!publicPath) return { root: cwd, diagnostics: [diagnostic("config", "config.missing", "not found", "Run codex-seo init in the project root.")] };
  const publicRead = await readJson(publicPath);
  const localPath = path.join(path.dirname(publicPath), "codex-seo.local.json");
  const localRead = await readJson(localPath);
  const diagnostics = [...publicRead.diagnostics, ...localRead.diagnostics];
  if (publicRead.value === undefined) return { path: publicPath, localPath, root: path.dirname(publicPath), diagnostics };
  diagnostics.push(...detectInlineSecrets(publicRead.value), ...detectInlineSecrets(localRead.value));
  const merged = migrateProjectConfig(deepMerge(publicRead.value, localRead.value ?? {})).value;
  const resolved = options.resolveEnv === false ? merged : resolveEnvironment(merged, diagnostics);
  const parsed = projectConfigSchema.safeParse(resolved);
  if (!parsed.success) diagnostics.push(...zodDiagnostics(parsed.error));
  const configDir = await realpath(path.dirname(publicPath)).catch(() => path.resolve(path.dirname(publicPath)));
  const requestedRoot = parsed.success ? path.resolve(configDir, parsed.data.project.root) : configDir;
  const projectRoot = await realpath(requestedRoot).catch(() => requestedRoot);
  if (!inside(configDir, projectRoot)) diagnostics.push(diagnostic("project.root", "config.path-outside-root", requestedRoot, "Use the configuration directory or one of its descendants."));
  const pathFields = parsed.success ? [
    ["history.dir", parsed.data.history.dir],
    ["output.dir", parsed.data.output.dir],
    ["deployment.artifactPath", parsed.data.deployment.artifactPath],
    ["deployment.localPath", parsed.data.deployment.localPath],
    ["deployment.authentication.privateKeyPath", parsed.data.deployment.authentication.type === "key" ? parsed.data.deployment.authentication.privateKeyPath : undefined],
    ["deployment.hostVerification.knownHostsPath", parsed.data.deployment.hostVerification.knownHostsPath],
    ["workflow.stateDirectory", parsed.data.workflow.stateDirectory],
    ["release.manifestDirectory", parsed.data.release.manifestDirectory]
  ] as const : [];
  for (const [name, value] of pathFields) {
    if (!value || path.isAbsolute(value)) {
      if (value && !inside(projectRoot, path.resolve(value))) diagnostics.push(diagnostic(name, "config.path-outside-root", value, "Use a relative path inside the project root."));
      continue;
    }
    if (!inside(projectRoot, path.resolve(projectRoot, value))) diagnostics.push(diagnostic(name, "config.path-outside-root", value, "Use a relative path inside the project root."));
  }
  return {
    path: publicPath,
    localPath: await stat(localPath).then(() => localPath).catch(() => undefined),
    root: projectRoot,
    config: parsed.success && !diagnostics.some((item) => item.severity === "error") ? parsed.data : undefined,
    diagnostics
  };
}

export function publicConfigView(config: ProjectConfig): ProjectConfig {
  return redactObject(config, { privacyMode: true });
}
