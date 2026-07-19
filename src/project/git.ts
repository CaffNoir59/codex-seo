import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { redactObject } from "../core/redaction.js";
import { resolveProjectPath } from "../security/project-policy.js";

type GitOutput = { exitCode: number | null; stdout: string; stderr: string };
export type GitStatus = { repository: boolean; branch?: string; head?: string; clean: boolean; changes: string[]; remote: boolean };
export type SnapshotManifest = {
  schemaVersion: "1.0.0";
  id: string;
  createdAt: string;
  baseCommit: string;
  branch: string;
  description: string;
  auditBefore?: string;
  auditAfter?: string;
  status: "created" | "restored";
  rollbackTarget: string;
};

async function git(root: string, args: string[], timeoutMs = 60_000): Promise<GitOutput> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, ...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-200_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-200_000); });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function assertSuccess(operation: string, result: GitOutput): GitOutput {
  if (result.exitCode !== 0) throw new Error(operation + " failed: " + (result.stderr.trim() || result.stdout.trim()));
  return result;
}

async function auditLog(root: string, operation: string, detail: unknown): Promise<void> {
  const directory = await resolveProjectPath(root, ".codex-seo/state", { allowMissing: true, allowProtected: true });
  await mkdir(directory, { recursive: true });
  const line = JSON.stringify(redactObject({ at: new Date().toISOString(), operation, detail }, { privacyMode: true })) + "\n";
  await appendFile(path.join(directory, "audit.jsonl"), line, "utf8");
}

export async function getGitStatus(root: string): Promise<GitStatus> {
  const probe = await git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
  if (probe.exitCode !== 0 || probe.stdout.trim() !== "true") return { repository: false, clean: true, changes: [], remote: false };
  const [branch, head, status, remotes] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1"]),
    git(root, ["remote"])
  ]);
  const changes = status.stdout.split(/\r?\n/).filter(Boolean);
  return {
    repository: true,
    branch: branch.stdout.trim() || undefined,
    head: head.exitCode === 0 ? head.stdout.trim() : undefined,
    clean: changes.length === 0,
    changes,
    remote: remotes.stdout.trim().length > 0
  };
}

export async function initializeGit(root: string, defaultBranch = "main"): Promise<GitStatus> {
  const before = await getGitStatus(root);
  if (!before.repository) assertSuccess("git init", await git(root, ["init", "-b", defaultBranch]));
  await auditLog(root, "git_initialize", { initialized: !before.repository, defaultBranch });
  return await getGitStatus(root);
}

function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "");
}

export async function createSnapshot(root: string, options: { description?: string; auditBefore?: string; confirmed?: boolean } = {}): Promise<SnapshotManifest> {
  if (!options.confirmed) throw new Error("Explicit confirmation is required to create a Git snapshot commit");
  const status = await getGitStatus(root);
  if (!status.repository) throw new Error("Git repository is not initialized");
  assertSuccess("git add", await git(root, ["add", "-A"]));
  const message = "chore(codex-seo): local snapshot " + timestamp();
  const commit = await git(root, ["-c", "user.name=Codex SEO", "-c", "user.email=codex-seo@example.com", "commit", "--allow-empty", "-m", message]);
  assertSuccess("git commit", commit);
  const head = assertSuccess("git rev-parse", await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const branch = (await git(root, ["branch", "--show-current"])).stdout.trim() || "HEAD";
  const id = "snapshot-" + timestamp();
  const manifest: SnapshotManifest = {
    schemaVersion: "1.0.0",
    id,
    createdAt: new Date().toISOString(),
    baseCommit: head,
    branch,
    description: options.description ?? "Codex SEO safety snapshot",
    auditBefore: options.auditBefore,
    status: "created",
    rollbackTarget: head
  };
  const directory = await resolveProjectPath(root, ".codex-seo/snapshots", { allowMissing: true, allowProtected: true });
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, id + ".json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await auditLog(root, "git_create_snapshot", { id, commit: head });
  return manifest;
}

export async function listSnapshots(root: string): Promise<SnapshotManifest[]> {
  const directory = await resolveProjectPath(root, ".codex-seo/snapshots", { allowMissing: true, allowProtected: true });
  const indexFile = path.join(directory, ".index");
  await mkdir(directory, { recursive: true });
  const listing = await import("node:fs/promises").then(({ readdir }) => readdir(directory)).catch(() => []);
  const manifests = await Promise.all(listing.filter((file) => file.endsWith(".json")).map(async (file) => {
    return await readFile(path.join(directory, file), "utf8").then((text) => JSON.parse(text) as SnapshotManifest).catch(() => undefined);
  }));
  void indexFile;
  return manifests.filter((item): item is SnapshotManifest => Boolean(item)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createWorkBranch(root: string, name?: string): Promise<{ branch: string; created: boolean }> {
  const status = await getGitStatus(root);
  if (!status.repository) throw new Error("Git repository is not initialized");
  const branch = name ?? "codex-seo/audit-fix-" + timestamp();
  if (!/^codex-seo\/[A-Za-z0-9._-]+$/.test(branch)) throw new Error("Work branch must use the codex-seo/ namespace");
  assertSuccess("git switch", await git(root, ["switch", "-c", branch]));
  await auditLog(root, "git_create_work_branch", { branch });
  return { branch, created: true };
}

export async function gitDiff(root: string, staged = false): Promise<string> {
  const result = assertSuccess("git diff", await git(root, ["diff", ...(staged ? ["--cached"] : []), "--no-ext-diff", "--"]));
  return result.stdout;
}

export async function commitChanges(root: string, message: string, confirmed = false): Promise<{ commit: string }> {
  if (!confirmed) throw new Error("Explicit confirmation is required to commit");
  if (!/^[\w][\w .:()\/-]{2,120}$/u.test(message)) throw new Error("Commit message is invalid");
  assertSuccess("git add", await git(root, ["add", "-A"]));
  assertSuccess("git commit", await git(root, ["-c", "user.name=Codex SEO", "-c", "user.email=codex-seo@example.com", "commit", "-m", message]));
  const commit = assertSuccess("git rev-parse", await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await auditLog(root, "git_commit", { commit });
  return { commit };
}

export async function restoreSnapshot(root: string, id: string, confirmed = false): Promise<SnapshotManifest> {
  if (!confirmed) throw new Error("Explicit confirmation is required to restore a snapshot");
  if (!/^snapshot-[0-9TZ-]+$/.test(id)) throw new Error("Snapshot identifier is invalid");
  const file = await resolveProjectPath(root, path.join(".codex-seo", "snapshots", id + ".json"), { allowProtected: true });
  const manifest = JSON.parse(await readFile(file, "utf8")) as SnapshotManifest;
  assertSuccess("git restore", await git(root, ["restore", "--source", manifest.rollbackTarget, "--staged", "--worktree", "--", "."]));
  const restored = { ...manifest, status: "restored" as const };
  await writeFile(file, JSON.stringify(restored, null, 2) + "\n", "utf8");
  await auditLog(root, "git_restore_snapshot", { id, commit: manifest.rollbackTarget });
  return restored;
}
