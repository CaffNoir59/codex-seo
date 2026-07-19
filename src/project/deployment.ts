import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "./config.js";
import { resolveProjectPath } from "../security/project-policy.js";
import { runHealthChecks } from "../deployment/health-checks.js";
import { withRemoteReleaseManager } from "../deployment/release-manager.js";

export type DeploymentResult = { success: boolean; operation: string; provider: ProjectConfig["deployment"]["provider"]; summary: Record<string, unknown>; warnings: string[]; code?: string };

function result(operation: string, provider: ProjectConfig["deployment"]["provider"], success: boolean, summary: Record<string, unknown> = {}, warnings: string[] = []): DeploymentResult {
  return { success, operation, provider, summary, warnings, ...(success ? {} : { code: operation + ".failed" }) };
}

function releaseId(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "");
}

async function localRoot(projectRoot: string, config: ProjectConfig): Promise<string> {
  if (!config.deployment.localPath) throw new Error("deployment.localPath is required for local-directory");
  const target = await resolveProjectPath(projectRoot, config.deployment.localPath, { allowMissing: true, allowProtected: true });
  await mkdir(target, { recursive: true });
  return target;
}

export async function deploymentStatus(projectRoot: string, config: ProjectConfig): Promise<DeploymentResult> {
  if (config.deployment.provider === "none") return result("deployment_status", "none", true, { configured: false, deployable: false });
  if (config.deployment.provider === "ssh" || config.deployment.provider === "sftp") {
    const configured = Boolean(config.deployment.host && (config.deployment.username ?? config.deployment.user) && config.deployment.remotePath);
    if (!configured) return result("deployment_status", config.deployment.provider, false, { configured: false, connected: false });
    try {
      const remote = await withRemoteReleaseManager(projectRoot, config, (manager) => manager.prepare());
      return result("deployment_status", config.deployment.provider, true, { configured: true, connected: true, ...remote });
    } catch (error) {
      return result("deployment_status", config.deployment.provider, false, { configured: true, connected: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const root = await localRoot(projectRoot, config);
  return result("deployment_status", "local-directory", true, {
    configured: true,
    root,
    current: await stat(path.join(root, "current")).then(() => true).catch(() => false)
  });
}

export async function deploymentPrepare(projectRoot: string, config: ProjectConfig): Promise<DeploymentResult> {
  if (config.deployment.provider === "none") return result("deployment_prepare", "none", true, { prepared: false, reason: "provider-none" });
  if (config.deployment.provider === "ssh" || config.deployment.provider === "sftp") {
    const artifact = config.deployment.artifactPath;
    if (!artifact) throw new Error("deployment.artifactPath is required");
    const artifactPath = await resolveProjectPath(projectRoot, artifact);
    if (!(await stat(artifactPath)).isDirectory()) throw new Error("Deployment artifact must be a directory");
    const remote = await withRemoteReleaseManager(projectRoot, config, (manager) => manager.prepare());
    return result("deployment_prepare", config.deployment.provider, true, { prepared: true, artifactPath, ...remote });
  }
  if (config.deployment.provider !== "local-directory") return result("deployment_prepare", config.deployment.provider, false);
  const artifact = config.deployment.artifactPath;
  if (!artifact) throw new Error("deployment.artifactPath is required");
  const artifactPath = await resolveProjectPath(projectRoot, artifact);
  if (!(await stat(artifactPath)).isDirectory()) throw new Error("Deployment artifact must be a directory");
  return result("deployment_prepare", "local-directory", true, { prepared: true, artifactPath });
}

export async function deploymentCreateSnapshot(projectRoot: string, config: ProjectConfig): Promise<DeploymentResult> {
  if (config.deployment.provider === "ssh" || config.deployment.provider === "sftp") {
    const snapshot = await withRemoteReleaseManager(projectRoot, config, (manager) => manager.snapshot());
    return result("deployment_create_snapshot", config.deployment.provider, snapshot.verified, snapshot);
  }
  if (config.deployment.provider !== "local-directory") return result("deployment_create_snapshot", config.deployment.provider, config.deployment.provider === "none", { skipped: true });
  const root = await localRoot(projectRoot, config);
  const current = path.join(root, "current");
  if (!await stat(current).then(() => true).catch(() => false)) return result("deployment_create_snapshot", "local-directory", true, { skipped: true, reason: "no-current-release" });
  const backups = path.join(root, "backups");
  await mkdir(backups, { recursive: true });
  const snapshot = path.join(backups, releaseId());
  await cp(current, snapshot, { recursive: true, errorOnExist: true });
  return result("deployment_create_snapshot", "local-directory", true, { snapshot });
}

export async function deploymentUploadStaging(projectRoot: string, config: ProjectConfig): Promise<DeploymentResult> {
  if (config.deployment.provider === "ssh" || config.deployment.provider === "sftp") {
    const manifest = await withRemoteReleaseManager(projectRoot, config, (manager) => manager.stage());
    return result("deployment_upload_staging", config.deployment.provider, true, { releaseId: manifest.releaseId, status: manifest.status, strategy: manifest.strategy, artifactHash: manifest.artifactHash });
  }
  if (config.deployment.provider !== "local-directory") return result("deployment_upload_staging", config.deployment.provider, false);
  const artifact = config.deployment.artifactPath;
  if (!artifact) throw new Error("deployment.artifactPath is required");
  const artifactPath = await resolveProjectPath(projectRoot, artifact);
  const root = await localRoot(projectRoot, config);
  const releases = path.join(root, "releases");
  await mkdir(releases, { recursive: true });
  const id = releaseId();
  const staging = path.join(releases, id);
  await cp(artifactPath, staging, { recursive: true, errorOnExist: true });
  return result("deployment_upload_staging", "local-directory", true, { releaseId: id, staging });
}

export async function deploymentActivate(projectRoot: string, config: ProjectConfig, release: string, confirmed = false): Promise<DeploymentResult> {
  if (!confirmed) throw new Error("Explicit confirmation is required to activate a release");
  if (config.deployment.provider === "ssh" || config.deployment.provider === "sftp") {
    const manifest = await withRemoteReleaseManager(projectRoot, config, (manager) => manager.activate(release));
    return result("deployment_activate_release", config.deployment.provider, manifest.status === "activated", { releaseId: manifest.releaseId, status: manifest.status, strategy: manifest.strategy, rollbackTarget: manifest.rollbackTarget });
  }
  if (config.deployment.provider !== "local-directory") return result("deployment_activate_release", config.deployment.provider, false);
  if (!/^[0-9TZ-]+$/.test(release)) throw new Error("Release identifier is invalid");
  const root = await localRoot(projectRoot, config);
  const source = path.join(root, "releases", release);
  if (!await stat(source).then(() => true).catch(() => false)) throw new Error("Release does not exist");
  const current = path.join(root, "current");
  const previous = path.join(root, "previous");
  await rm(previous, { recursive: true, force: true });
  if (await stat(current).then(() => true).catch(() => false)) await rename(current, previous);
  await cp(source, current, { recursive: true, errorOnExist: true });
  return result("deployment_activate_release", "local-directory", true, { release, current, rollbackAvailable: await stat(previous).then(() => true).catch(() => false) });
}

export async function deploymentHealthCheck(config: ProjectConfig, projectRoot = process.cwd()): Promise<DeploymentResult> {
  const report = config.deployment.provider === "ssh" || config.deployment.provider === "sftp"
    ? await withRemoteReleaseManager(projectRoot, config, async (_manager, transport) => runHealthChecks(config, transport))
    : await runHealthChecks(config);
  return result("deployment_health_check", config.deployment.provider, report.success, { checked: report.checks.length > 0, durationMs: report.durationMs, checks: report.checks.length, report }, report.success ? [] : ["One or more health checks failed."]);
}

export async function deploymentRollback(projectRoot: string, config: ProjectConfig, confirmed = false, release?: string): Promise<DeploymentResult> {
  if (!confirmed) throw new Error("Explicit confirmation is required to roll back");
  if (config.deployment.provider === "ssh" || config.deployment.provider === "sftp") {
    if (!release) throw new Error("A release identifier is required for remote rollback");
    const manifest = await withRemoteReleaseManager(projectRoot, config, (manager) => manager.rollback(release, "Manual rollback requested", true));
    return result("deployment_rollback", config.deployment.provider, manifest.status === "rolled-back", { releaseId: manifest.releaseId, status: manifest.status, incident: manifest.incident });
  }
  if (config.deployment.provider !== "local-directory") return result("deployment_rollback", config.deployment.provider, false);
  const root = await localRoot(projectRoot, config);
  const current = path.join(root, "current");
  const previous = path.join(root, "previous");
  if (!await stat(previous).then(() => true).catch(() => false)) throw new Error("No previous release is available");
  const failed = path.join(root, "failed-" + releaseId());
  if (await stat(current).then(() => true).catch(() => false)) await rename(current, failed);
  await rename(previous, current);
  return result("deployment_rollback", "local-directory", true, { current, failed });
}

export async function pruneLocalReleases(projectRoot: string, config: ProjectConfig, confirmed = false): Promise<DeploymentResult> {
  if (!confirmed) throw new Error("Explicit confirmation is required to delete old releases");
  if (config.deployment.provider !== "local-directory") return result("deployment_prune", config.deployment.provider, false);
  const root = await localRoot(projectRoot, config);
  const releases = path.join(root, "releases");
  const entries = (await readdir(releases).catch(() => [])).sort().reverse();
  const removed = entries.slice(config.deployment.releasesToKeep);
  for (const entry of removed) await rm(path.join(releases, entry), { recursive: true, force: true });
  return result("deployment_prune", "local-directory", true, { removed });
}
