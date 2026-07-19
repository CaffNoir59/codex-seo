import { access, copyFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { packageRoot, getVersion } from "../version.js";
import { findProjectConfig, loadProjectConfig, migrateProjectConfig } from "../project/config.js";
import { deploymentStatus } from "../project/deployment.js";

export type PluginDiagnostic = { check: string; status: "passed" | "failed" | "skipped"; detail: string };

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true).catch(() => false);
}

async function executable(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export async function pluginDoctor(cwd = process.cwd()): Promise<{ ready: boolean; version: string; diagnostics: PluginDiagnostic[] }> {
  const root = packageRoot();
  const bundle = path.join(root, "plugin", "codex-seo");
  const diagnostics: PluginDiagnostic[] = [];
  const manifestPath = path.join(bundle, ".codex-plugin", "plugin.json");
  const skillPath = path.join(bundle, "skills", "seo-maintainer", "SKILL.md");
  const mcpPath = path.join(bundle, ".mcp.json");
  diagnostics.push({ check: "node", status: Number(process.versions.node.split(".")[0]) >= 20 ? "passed" : "failed", detail: process.version });
  diagnostics.push({ check: "bundle", status: await exists(manifestPath) ? "passed" : "failed", detail: manifestPath });
  diagnostics.push({ check: "permissions", status: await access(manifestPath, constants.R_OK).then(() => "passed" as const).catch(() => "failed" as const), detail: "plugin manifest readable" });
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: string };
    diagnostics.push({ check: "version", status: manifest.version === getVersion() ? "passed" : "failed", detail: String(manifest.version ?? "missing") });
  }
  diagnostics.push({ check: "skill", status: await exists(skillPath) ? "passed" : "failed", detail: skillPath });
  diagnostics.push({ check: "mcp-bundle", status: await exists(mcpPath) ? "passed" : "failed", detail: mcpPath });
  diagnostics.push({ check: "npm-executable", status: await exists(path.join(root, "dist", "cli", "index.js")) ? "passed" : "skipped", detail: "dist/cli/index.js" });
  diagnostics.push({ check: "git", status: await executable("git", ["--version"]) ? "passed" : "failed", detail: "git --version" });
  const loaded = await loadProjectConfig({ cwd });
  diagnostics.push({ check: "project-config", status: loaded.config ? "passed" : "failed", detail: loaded.path ?? "not found" });
  const codexConfig = path.join(loaded.root, ".codex", "config.toml");
  const codexContent = await readFile(codexConfig, "utf8").catch(() => "");
  diagnostics.push({ check: "codex-mcp", status: codexContent.includes("[mcp_servers.codex_seo]") ? "passed" : "failed", detail: codexConfig });
  if (loaded.config?.lighthouse.enabled) {
    diagnostics.push({ check: "lighthouse", status: await exists(path.join(root, "node_modules", "lighthouse")) ? "passed" : "failed", detail: "runtime dependency" });
  } else diagnostics.push({ check: "lighthouse", status: "skipped", detail: "not configured" });
  if (loaded.config && ["ssh", "sftp"].includes(loaded.config.deployment.provider)) {
    const deployment = loaded.config.deployment;
    const configured = Boolean(deployment.host && (deployment.username ?? deployment.user) && deployment.remotePath);
    const verified = !deployment.hostVerification.strict || Boolean(deployment.hostVerification.fingerprint || deployment.hostVerification.knownHostsPath);
    const connection = configured && verified ? await deploymentStatus(loaded.root, loaded.config) : undefined;
    diagnostics.push({ check: "ssh-config", status: configured && verified && connection?.success ? "passed" : "failed", detail: !verified ? "strict host verification evidence missing" : connection?.success ? "transport connected" : String(connection?.summary.error ?? "transport configuration incomplete") });
  } else diagnostics.push({ check: "ssh-config", status: "skipped", detail: "not configured" });
  return { ready: diagnostics.every((item) => item.status !== "failed"), version: getVersion(), diagnostics };
}

export async function updateProjectPlugin(cwd = process.cwd(), dryRun = false): Promise<{ updated: string[]; backups: string[]; diff: string[] }> {
  const configPath = await findProjectConfig(cwd);
  if (!configPath) throw Object.assign(new Error("Project configuration was not found"), { code: "config.missing" });
  const projectRoot = path.dirname(configPath);
  const sourceSkill = path.join(packageRoot(), "plugin", "codex-seo", "skills", "seo-maintainer");
  const targetSkill = path.join(projectRoot, ".agents", "skills", "seo-maintainer");
  const updated: string[] = [];
  const backups: string[] = [];
  const diff: string[] = [];
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  if (await exists(targetSkill)) {
    const backup = targetSkill + ".bak-" + suffix;
    backups.push(path.relative(projectRoot, backup).replace(/\\/g, "/"));
    if (!dryRun) await cp(targetSkill, backup, { recursive: true });
  }
  updated.push(".agents/skills/seo-maintainer/");
  diff.push("replace managed seo-maintainer skill");
  if (!dryRun) {
    await mkdir(path.dirname(targetSkill), { recursive: true });
    await cp(sourceSkill, targetSkill, { recursive: true, force: true });
  }
  const codexConfig = path.join(projectRoot, ".codex", "config.toml");
  const mcp = '[mcp_servers.codex_seo]\ncommand = "npx"\nargs = ["-y", "--package", "codex-seo", "codex-seo-mcp"]\ncwd = "."\ndefault_tools_approval_mode = "writes"\nstartup_timeout_sec = 20\ntool_timeout_sec = 300\n';
  const existingMcp = await readFile(codexConfig, "utf8").catch(() => "");
  if (!existingMcp.includes("[mcp_servers.codex_seo]")) {
    if (existingMcp) {
      const backup = codexConfig + ".bak-" + suffix;
      backups.push(path.relative(projectRoot, backup).replace(/\\/g, "/"));
      if (!dryRun) await copyFile(codexConfig, backup);
    }
    updated.push(".codex/config.toml");
    diff.push("append codex_seo MCP server while preserving existing servers");
    if (!dryRun) {
      await mkdir(path.dirname(codexConfig), { recursive: true });
      await writeFile(codexConfig, existingMcp + (existingMcp ? "\n" : "") + mcp, "utf8");
    }
  }
  const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  const migration = migrateProjectConfig(raw);
  if (migration.changes.length) {
    const backup = configPath + ".bak-" + suffix;
    backups.push(path.relative(projectRoot, backup).replace(/\\/g, "/"));
    updated.push(path.basename(configPath));
    diff.push("migrate config " + migration.from + " -> " + migration.to + ": " + migration.changes.join(", "));
    if (!dryRun) {
      await copyFile(configPath, backup);
      await writeFile(configPath, JSON.stringify(migration.value, null, 2) + "\n", "utf8");
    }
  }
  return { updated, backups, diff };
}
