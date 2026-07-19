import { copyFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "../config/config-schema.js";
import { packageRoot } from "../version.js";
import { detectProject, type Framework, type PackageManager, type ProjectDetection } from "./detect.js";
import { initializeGit } from "./git.js";
import { projectConfigSchema, type ProjectConfig } from "./config.js";
import { resolveProjectPath } from "../security/project-policy.js";

export type ProjectInitOptions = {
  cwd?: string;
  yes?: boolean;
  projectRoot?: string;
  productionUrl?: string;
  framework?: Framework;
  packageManager?: PackageManager;
  git?: boolean;
  deployment?: ProjectConfig["deployment"]["provider"];
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  minimal?: boolean;
  full?: boolean;
  environment?: string;
};
export type ProjectInitResult = {
  success: boolean;
  dryRun: boolean;
  root: string;
  detection: ProjectDetection;
  created: string[];
  updated: string[];
  skipped: string[];
  backups: string[];
  diagnostics: string[];
  git: { requested: boolean; initialized: boolean };
};

const ignoreEntries = [
  ".env",
  ".env.*",
  "!.env.example",
  "codex-seo.local.json",
  ".codex-seo/secrets/",
  ".codex-seo/state/",
  ".codex-seo/logs/",
  ".codex-seo/snapshots/",
  ".codex-seo/backups/",
  ".codex-seo/releases/",
  ".codex-seo/workspaces/",
  ".codex-seo/reports/",
  "reports/",
  "history/",
  "backups/",
  "releases/",
  "tmp/",
  "coverage/",
  "playwright-report/",
  "test-results/",
  "*.log",
  "*.pem",
  "*.key"
];

function relative(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/");
}

function mcpToml(): string {
  return [
    "[mcp_servers.codex_seo]",
    'command = "npx"',
    'args = ["-y", "--package", "codex-seo", "codex-seo-mcp"]',
    'cwd = "."',
    'default_tools_approval_mode = "writes"',
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 300',
    ""
  ].join("\n");
}

function localExample(): Record<string, unknown> {
  return {
    project: { productionUrl: "${PRODUCTION_URL}" },
    deployment: {
      host: "${DEPLOY_HOST}",
      username: "${DEPLOY_USER}",
      remotePath: "${DEPLOY_PATH}",
      authentication: { type: "agent", agentEnv: "SSH_AUTH_SOCK" },
      hostVerification: { strict: true },
      releaseStrategy: "auto"
    }
  };
}

function buildConfig(detection: ProjectDetection, options: ProjectInitOptions): ProjectConfig {
  const base = defaultConfig(options.environment ?? "production");
  return projectConfigSchema.parse({
    ...base,
    project: {
      name: "Example Project",
      root: ".",
      productionUrl: options.productionUrl ?? "${PRODUCTION_URL}",
      developmentUrl: detection.probablePort ? "http://127.0.0.1:" + detection.probablePort : undefined
    },
    commands: detection.commands,
    git: {
      enabled: options.git !== false,
      autoInitialize: options.git !== false,
      createWorkBranches: true,
      defaultBranch: "main"
    },
    audit: {
      crawl: !options.minimal,
      performance: Boolean(options.full),
      environment: options.environment ?? "production"
    },
    preview: {
      port: detection.probablePort ?? 3000,
      host: "127.0.0.1"
    },
    deployment: {
      provider: options.deployment ?? "none",
      requireConfirmation: true,
      artifactPath: detection.buildDirectory && detection.buildDirectory !== "." ? detection.buildDirectory : undefined,
      localPath: options.deployment === "local-directory" ? ".codex-seo/deployments/local" : undefined
    }
  });
}

async function backup(file: string, result: ProjectInitResult): Promise<void> {
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = file + ".bak-" + suffix;
  await copyFile(file, backupFile);
  result.backups.push(relative(result.root, backupFile));
}

async function writeManaged(file: string, content: string, result: ProjectInitResult, options: ProjectInitOptions): Promise<void> {
  const exists = await stat(file).then(() => true).catch(() => false);
  if (exists && !options.force) {
    result.skipped.push(relative(result.root, file));
    return;
  }
  if (!options.dryRun) {
    await resolveProjectPath(result.root, file, { allowMissing: true, allowProtected: true });
    await mkdir(path.dirname(file), { recursive: true });
    if (exists) await backup(file, result);
    await writeFile(file, content, "utf8");
  }
  (exists ? result.updated : result.created).push(relative(result.root, file));
}

async function updateGitignore(root: string, result: ProjectInitResult, options: ProjectInitOptions): Promise<void> {
  const file = path.join(root, ".gitignore");
  const original = await readFile(file, "utf8").catch(() => "");
  const missing = ignoreEntries.filter((entry) => !original.split(/\r?\n/).includes(entry));
  if (missing.length === 0) {
    result.skipped.push(".gitignore");
    return;
  }
  if (!options.dryRun) {
    const separator = original && !original.endsWith("\n") ? "\n" : "";
    await writeFile(file, original + separator + "\n# Codex SEO local and sensitive artifacts\n" + missing.join("\n") + "\n", "utf8");
  }
  result.updated.push(".gitignore");
}


async function updateMcpConfig(root: string, result: ProjectInitResult, options: ProjectInitOptions): Promise<void> {
  const file = path.join(root, ".codex", "config.toml");
  const existing = await readFile(file, "utf8").catch(() => "");
  if (existing.includes("[mcp_servers.codex_seo]")) {
    result.skipped.push(".codex/config.toml");
    return;
  }
  const existed = await stat(file).then(() => true).catch(() => false);
  if (!options.dryRun) {
    await resolveProjectPath(root, file, { allowMissing: true, allowProtected: true });
    await mkdir(path.dirname(file), { recursive: true });
    if (existed) await backup(file, result);
    const separator = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
    await writeFile(file, existing + separator + mcpToml(), "utf8");
  }
  (existed ? result.updated : result.created).push(".codex/config.toml");
}
export async function initializeProject(options: ProjectInitOptions = {}): Promise<ProjectInitResult> {
  const requestedRoot = path.resolve(options.cwd ?? process.cwd(), options.projectRoot ?? ".");
  const detection = await detectProject(requestedRoot);
  if (options.framework) {
    detection.framework = options.framework;
    detection.evidence.push({ field: "framework", value: options.framework, confidence: 1, source: "explicit option" });
  }
  if (options.packageManager) {
    detection.packageManager = options.packageManager;
    detection.evidence.push({ field: "packageManager", value: options.packageManager, confidence: 1, source: "explicit option" });
  }
  const result: ProjectInitResult = {
    success: true,
    dryRun: Boolean(options.dryRun),
    root: requestedRoot,
    detection,
    created: [],
    updated: [],
    skipped: [],
    backups: [],
    diagnostics: [],
    git: { requested: options.git !== false, initialized: false }
  };
  const config = buildConfig(detection, options);
  await writeManaged(path.join(requestedRoot, "codex-seo.config.json"), JSON.stringify(config, null, 2) + "\n", result, options);
  await writeManaged(path.join(requestedRoot, "codex-seo.local.example.json"), JSON.stringify(localExample(), null, 2) + "\n", result, options);
  await updateMcpConfig(requestedRoot, result, options);
  await updateGitignore(requestedRoot, result, options);
  const directories = [".codex-seo/state", ".codex-seo/state/workflows", ".codex-seo/snapshots", ".codex-seo/logs", ".codex-seo/releases"];
  for (const directory of directories) {
    if (!options.dryRun) await mkdir(path.join(requestedRoot, directory), { recursive: true });
    result.created.push(directory + "/");
  }
  const sourceSkill = path.join(packageRoot(), "plugin", "codex-seo", "skills", "seo-maintainer");
  const targetSkill = path.join(requestedRoot, ".agents", "skills", "seo-maintainer");
  if (await stat(sourceSkill).then(() => true).catch(() => false)) {
    const targetExists = await stat(targetSkill).then(() => true).catch(() => false);
    if (targetExists && !options.force) result.skipped.push(".agents/skills/seo-maintainer/");
    else {
      if (!options.dryRun) {
        if (targetExists) {
          const skillFile = path.join(targetSkill, "SKILL.md");
          if (await stat(skillFile).then(() => true).catch(() => false)) await backup(skillFile, result);
        }
        await cp(sourceSkill, targetSkill, { recursive: true, force: Boolean(options.force) });
      }
      (targetExists ? result.updated : result.created).push(".agents/skills/seo-maintainer/");
    }
  } else {
    result.diagnostics.push("Bundled seo-maintainer skill is not available in this package.");
  }
  if (options.git !== false && !options.dryRun) {
    const before = detection.git.present;
    await initializeGit(requestedRoot, "main");
    result.git.initialized = !before;
  }
  return result;
}

export function formatProjectInitResult(result: ProjectInitResult): string {
  return [
    "Codex SEO project initialized",
    "",
    "Framework: " + result.detection.framework + " (confidence " + Math.round(result.detection.confidence * 100) + "%)",
    "Package manager: " + result.detection.packageManager,
    "Git: " + (result.git.requested ? result.git.initialized ? "initialized" : "available" : "disabled"),
    "",
    result.created.length ? "Created:\n- " + result.created.join("\n- ") : "",
    result.updated.length ? "Updated:\n- " + result.updated.join("\n- ") : "",
    result.skipped.length ? "Skipped:\n- " + result.skipped.join("\n- ") : "",
    result.backups.length ? "Backups:\n- " + result.backups.join("\n- ") : "",
    result.diagnostics.length ? "Diagnostics:\n- " + result.diagnostics.join("\n- ") : ""
  ].filter(Boolean).join("\n");
}
