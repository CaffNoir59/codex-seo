import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "../project/config.js";
import { resolveProjectPath } from "../security/project-policy.js";
import { getGitStatus } from "../project/git.js";
import { getVersion } from "../version.js";
import { LocalLogStore } from "../observability/logs.js";
import { runHealthChecks, type HealthReport } from "./health-checks.js";
import { SshSftpTransport, validateRemotePath, type RemoteTransport } from "./remote-transport.js";

export type ReleaseStatus = "prepared" | "staged" | "activated" | "healthy" | "failed" | "rolled-back";
export type ReleaseManifest = {
  schemaVersion: "1.1.0";
  releaseId: string;
  date: string;
  pluginVersion: string;
  commit?: string;
  branch?: string;
  artifactHash: string;
  targetUrl?: string;
  previousRelease?: string;
  strategy: "symlink" | "rename" | "copy";
  validations?: unknown;
  audits: { before?: string; preview?: string; production?: string };
  healthChecks?: HealthReport;
  status: ReleaseStatus;
  rollbackTarget?: string;
  incident?: { at: string; cause: string; rollbackSucceeded: boolean; rollbackError?: string };
};

function releaseId(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "") + "-" + Math.random().toString(36).slice(2, 8);
}

async function artifactHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string, relative = ""): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const nextRelative = (relative ? relative + "/" : "") + entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full, nextRelative);
      else if (entry.isFile()) hash.update(nextRelative).update(await readFile(full));
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function countRemoteFiles(transport: RemoteTransport, root: string): Promise<number> {
  const entries = await transport.list(root);
  let count = 0;
  for (const entry of entries) count += entry.type === "directory" ? await countRemoteFiles(transport, entry.path) : entry.type === "file" ? 1 : 0;
  return count;
}

export class RemoteReleaseManager {
  private readonly logs: LocalLogStore;
  private strategy?: "symlink" | "rename" | "copy";

  constructor(
    private readonly projectRoot: string,
    private readonly config: ProjectConfig,
    private readonly transport: RemoteTransport
  ) {
    this.logs = new LocalLogStore(projectRoot);
  }

  private root(): string {
    if (!this.config.deployment.remotePath) throw Object.assign(new Error("deployment.remotePath is required"), { code: "remote.config-invalid" });
    return validateRemotePath(this.config.deployment.remotePath);
  }

  private remote(name: "current" | "previous" | "releases" | "shared" | "backups" | "staging"): string {
    return this.root() + "/" + name;
  }

  private async detectStrategy(): Promise<"symlink" | "rename" | "copy"> {
    if (this.strategy) return this.strategy;
    const configured = this.config.deployment.releaseStrategy;
    if (configured !== "auto") return this.strategy = configured;
    const probeTarget = this.remote("staging") + "/.symlink-probe-target";
    const probeLink = this.remote("staging") + "/.symlink-probe-link";
    try {
      await this.transport.mkdir(probeTarget);
      await this.transport.symlink(probeTarget, probeLink);
      const resolved = await this.transport.readlink(probeLink);
      await this.transport.remove(probeLink);
      await this.transport.remove(probeTarget, true);
      return this.strategy = resolved ? "symlink" : "rename";
    } catch {
      await this.transport.remove(probeLink).catch(() => undefined);
      await this.transport.remove(probeTarget, true).catch(() => undefined);
      return this.strategy = "rename";
    }
  }

  async prepare(): Promise<{ strategy: "symlink" | "rename" | "copy"; current?: string }> {
    await this.transport.connect();
    for (const directory of ["releases", "shared", "backups", "staging"] as const) await this.transport.mkdir(this.remote(directory));
    const strategy = await this.detectStrategy();
    const current = strategy === "symlink"
      ? await this.transport.readlink(this.remote("current"))
      : await this.transport.exists(this.remote("current")) ? this.remote("current") : undefined;
    await this.logs.write({ category: "deployment", event: "remote-prepared", success: true, details: { strategy, current: Boolean(current) } });
    return { strategy, current };
  }

  async snapshot(id = releaseId()): Promise<{ verified: boolean; target?: string; previousRelease?: string }> {
    const { strategy, current } = await this.prepare();
    if (!current) return { verified: true };
    if (strategy === "symlink") {
      const verified = await this.transport.exists(current);
      if (!verified) throw Object.assign(new Error("The active release symlink target does not exist"), { code: "release.snapshot-unverified" });
      return { verified, target: current, previousRelease: current.split("/").pop() };
    }
    const target = this.remote("backups") + "/" + id;
    await this.transport.copy(this.remote("current"), target);
    const verified = await this.transport.exists(target) && await countRemoteFiles(this.transport, target) > 0;
    if (!verified) throw Object.assign(new Error("Remote snapshot could not be verified"), { code: "release.snapshot-unverified" });
    await this.logs.write({ category: "deployment", event: "snapshot-created", success: true, releaseId: id, details: { target } });
    return { verified, target, previousRelease: "current" };
  }

  async stage(options: { releaseId?: string; validations?: unknown; audits?: ReleaseManifest["audits"] } = {}): Promise<ReleaseManifest> {
    const artifact = this.config.deployment.artifactPath;
    if (!artifact) throw Object.assign(new Error("deployment.artifactPath is required"), { code: "release.artifact-missing" });
    const localArtifact = await resolveProjectPath(this.projectRoot, artifact);
    if (!(await stat(localArtifact)).isDirectory()) throw Object.assign(new Error("Deployment artifact must be a directory"), { code: "release.artifact-invalid" });
    const id = options.releaseId ?? releaseId();
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw Object.assign(new Error("Release identifier is invalid"), { code: "release.id-invalid" });
    const prepared = await this.prepare();
    const snapshot = await this.snapshot(id);
    const staging = this.remote("staging") + "/" + id;
    const destination = this.remote("releases") + "/" + id;
    if (await this.transport.exists(staging) || await this.transport.exists(destination)) throw Object.assign(new Error("Release identifier already exists remotely"), { code: "release.exists" });
    const uploaded = await this.transport.upload(localArtifact, staging);
    const remoteFiles = await countRemoteFiles(this.transport, staging);
    if (uploaded.files === 0 || remoteFiles !== uploaded.files) throw Object.assign(new Error("Uploaded artifact verification failed"), { code: "release.upload-unverified" });
    try {
      await this.transport.rename(staging, destination);
    } catch {
      await this.transport.copy(staging, destination);
      await this.transport.remove(staging, true);
    }
    for (const configuredPath of this.config.deployment.sharedPaths) {
      const relative = validateRemotePath("/" + configuredPath.replace(/^\/+/, "")).slice(1);
      const shared = this.remote("shared") + "/" + relative;
      const target = destination + "/" + relative;
      if (!await this.transport.exists(shared)) continue;
      if (await this.transport.exists(target)) await this.transport.remove(target, true);
      if (prepared.strategy === "symlink") await this.transport.symlink(shared, target);
      else await this.transport.copy(shared, target);
    }
    const git = await getGitStatus(this.projectRoot);
    const manifest: ReleaseManifest = {
      schemaVersion: "1.1.0",
      releaseId: id,
      date: new Date().toISOString(),
      pluginVersion: getVersion(),
      commit: git.head,
      branch: git.branch,
      artifactHash: await artifactHash(localArtifact),
      targetUrl: this.config.project.productionUrl,
      previousRelease: snapshot.previousRelease,
      strategy: prepared.strategy,
      validations: options.validations,
      audits: options.audits ?? {},
      status: "staged",
      rollbackTarget: snapshot.target
    };
    await this.writeManifest(manifest, destination);
    if (this.config.deployment.release.createManifest) {
      const marker = validateRemotePath("/" + this.config.deployment.release.markerFile.replace(/^\/+/, "")).slice(1);
      if (!await this.transport.exists(destination + "/" + marker)) throw Object.assign(new Error("Remote release marker could not be verified"), { code: "release.marker-missing" });
    }
    await this.logs.write({ category: "deployment", event: "release-staged", success: true, releaseId: id, details: { files: uploaded.files, bytes: uploaded.bytes, strategy: prepared.strategy } });
    return manifest;
  }

  private async localManifestPath(id: string): Promise<string> {
    const directory = await resolveProjectPath(this.projectRoot, this.config.release.manifestDirectory, { allowMissing: true, allowProtected: true });
    await mkdir(directory, { recursive: true });
    return path.join(directory, id + ".json");
  }

  async readManifest(id: string): Promise<ReleaseManifest> {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw Object.assign(new Error("Release identifier is invalid"), { code: "release.id-invalid" });
    return JSON.parse(await readFile(await this.localManifestPath(id), "utf8")) as ReleaseManifest;
  }

  private async writeManifest(manifest: ReleaseManifest, releaseDirectory?: string): Promise<void> {
    const content = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(await this.localManifestPath(manifest.releaseId), content, "utf8");
    if (releaseDirectory && this.config.deployment.release.createManifest) {
      const marker = validateRemotePath("/" + this.config.deployment.release.markerFile.replace(/^\/+/, "")).slice(1);
      await this.transport.write(releaseDirectory + "/" + marker, content);
    }
  }

  async activate(id: string): Promise<ReleaseManifest> {
    const manifest = await this.readManifest(id);
    const release = this.remote("releases") + "/" + id;
    if (!await this.transport.exists(release)) throw Object.assign(new Error("Prepared release is missing"), { code: "release.missing" });
    const current = this.remote("current");
    const previous = this.remote("previous");
    try {
      if (manifest.strategy === "symlink") {
        const next = this.root() + "/.current-" + id;
        await this.transport.symlink(release, next);
        if (await this.transport.exists(previous)) await this.transport.remove(previous, true);
        if (await this.transport.exists(current) || await this.transport.readlink(current)) await this.transport.rename(current, previous);
        await this.transport.rename(next, current);
      } else {
        if (await this.transport.exists(previous)) await this.transport.remove(previous, true);
        if (await this.transport.exists(current)) await this.transport.rename(current, previous);
        await this.transport.copy(release, current);
      }
      manifest.status = "activated";
      await this.writeManifest(manifest, release);
      await this.logs.write({ category: "deployment", event: "release-activated", success: true, releaseId: id, details: { strategy: manifest.strategy } });
      return manifest;
    } catch (error) {
      manifest.status = "failed";
      await this.writeManifest(manifest, release).catch(() => undefined);
      if (this.config.deployment.release.autoRollback && this.config.automation.rollbackOnFailureWithoutConfirmation) {
        await this.rollback(id, error instanceof Error ? error.message : String(error), true).catch(() => undefined);
      }
      throw error;
    }
  }

  async health(id: string): Promise<ReleaseManifest> {
    const manifest = await this.readManifest(id);
    const report = await runHealthChecks(this.config, this.transport);
    manifest.healthChecks = report;
    manifest.status = report.success ? "healthy" : "failed";
    await this.writeManifest(manifest, this.remote("releases") + "/" + id);
    await this.logs.write({ category: "deployment", event: "health-checks", success: report.success, releaseId: id, details: { checks: report.checks.length } });
    if (!report.success && this.config.deployment.release.autoRollback && this.config.automation.rollbackOnFailureWithoutConfirmation) {
      await this.rollback(id, "Post-activation health checks failed", true);
    }
    return manifest;
  }

  async rollback(failedReleaseId: string, cause: string, automatic = false): Promise<ReleaseManifest> {
    const manifest = await this.readManifest(failedReleaseId);
    if (!automatic && this.config.automation.manualRollbackRequiresConfirmation) {
      throw Object.assign(new Error("Explicit confirmation is required for manual rollback"), { code: "confirmation.required" });
    }
    let rollbackSucceeded = false;
    let rollbackError: string | undefined;
    try {
      const current = this.remote("current");
      if (manifest.strategy === "symlink" && manifest.rollbackTarget) {
        const next = this.root() + "/.rollback-" + failedReleaseId;
        await this.transport.symlink(manifest.rollbackTarget, next);
        const failed = this.root() + "/failed-" + failedReleaseId;
        if (await this.transport.exists(current) || await this.transport.readlink(current)) await this.transport.rename(current, failed);
        await this.transport.rename(next, current);
      } else {
        const source = manifest.rollbackTarget && await this.transport.exists(manifest.rollbackTarget) ? manifest.rollbackTarget : this.remote("previous");
        if (!source || !await this.transport.exists(source)) throw Object.assign(new Error("No verified rollback target exists"), { code: "rollback.target-missing" });
        const failed = this.root() + "/failed-" + failedReleaseId;
        if (await this.transport.exists(current)) await this.transport.rename(current, failed);
        await this.transport.copy(source, current);
      }
      rollbackSucceeded = await this.transport.exists(current) || Boolean(await this.transport.readlink(current));
      if (!rollbackSucceeded) throw new Error("Restored release could not be verified");
    } catch (error) {
      rollbackError = error instanceof Error ? error.message : String(error);
    }
    manifest.status = rollbackSucceeded ? "rolled-back" : "failed";
    manifest.incident = { at: new Date().toISOString(), cause, rollbackSucceeded, rollbackError };
    await this.writeManifest(manifest, this.remote("releases") + "/" + failedReleaseId).catch(() => undefined);
    await this.logs.write({ category: "rollback", event: "rollback-completed", success: rollbackSucceeded, releaseId: failedReleaseId, details: { cause, rollbackError } });
    if (!rollbackSucceeded) throw Object.assign(new Error("Rollback failed: " + rollbackError), { code: "rollback.failed", manifest });
    return manifest;
  }

  async prune(): Promise<string[]> {
    const entries = (await this.transport.list(this.remote("releases"))).filter((entry) => entry.type === "directory").sort((a, b) => b.name.localeCompare(a.name));
    const removed = entries.slice(this.config.deployment.retention);
    for (const entry of removed) await this.transport.remove(entry.path, true);
    await this.logs.write({ category: "deployment", event: "retention-pruned", success: true, details: { removed: removed.map((entry) => entry.name) } });
    return removed.map((entry) => entry.name);
  }
}

export async function withRemoteReleaseManager<T>(
  projectRoot: string,
  config: ProjectConfig,
  operation: (manager: RemoteReleaseManager, transport: RemoteTransport) => Promise<T>,
  injected?: RemoteTransport
): Promise<T> {
  const logs = new LocalLogStore(projectRoot);
  const transport = injected ?? new SshSftpTransport({
    projectRoot,
    deployment: config.deployment,
    onLog: (event) => logs.write({ category: "deployment", event: String(event.event ?? "transport"), details: event })
  });
  try {
    const manager = new RemoteReleaseManager(projectRoot, config, transport);
    return await operation(manager, transport);
  } finally {
    await transport.close().catch(() => undefined);
  }
}
