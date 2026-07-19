import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { Server, utils } from "ssh2";
import { afterEach, describe, expect, it } from "vitest";
import { projectConfigSchema, migrateProjectConfig, type ProjectConfig } from "../../src/project/config.js";
import { SshSftpTransport, sshHostFingerprint, verifySshHostKey, validateRemotePath, type RemoteCommand, type RemoteEntry, type RemoteTransport } from "../../src/deployment/remote-transport.js";
import { RemoteReleaseManager } from "../../src/deployment/release-manager.js";
import { runHealthChecks } from "../../src/deployment/health-checks.js";
import { evaluateRegression } from "../../src/deployment/regression.js";
import { WorkflowStore } from "../../src/workflow/store.js";
import { SeoWorkflowOrchestrator } from "../../src/workflow/orchestrator.js";
import { LocalLogStore } from "../../src/observability/logs.js";
import { toolDefinitions } from "../../src/mcp/server.js";

const roots: string[] = [];
async function temp(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-seo-v11-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }));
});

function config(root: string, deployment: Partial<ProjectConfig["deployment"]> = {}): ProjectConfig {
  return projectConfigSchema.parse({
    schemaVersion: "1.1.0",
    project: { name: "Example Project", root: ".", productionUrl: "https://example.com" },
    deployment: {
      provider: "ssh",
      host: "example.com",
      username: "example",
      remotePath: "/application",
      artifactPath: "dist",
      hostVerification: { strict: false },
      releaseStrategy: "auto",
      healthChecks: [{ type: "remote-file", path: "index.html" }],
      ...deployment
    },
    workflow: { stateDirectory: ".codex-seo/state/workflows" },
    release: { manifestDirectory: ".codex-seo/releases" },
    output: { dir: path.join(root, "reports") }
  });
}

class MemoryTransport implements RemoteTransport {
  readonly directories = new Set<string>(["/"]);
  readonly files = new Map<string, Buffer>();
  readonly links = new Map<string, string>();
  connected = false;
  failSymlink = false;
  failNextRename = false;

  async connect(): Promise<void> { this.connected = true; }
  async close(): Promise<void> { this.connected = false; }
  async exists(value: string): Promise<boolean> { const safe = validateRemotePath(value); return this.directories.has(safe) || this.files.has(safe) || this.links.has(safe); }
  async list(value: string): Promise<RemoteEntry[]> {
    const root = validateRemotePath(value);
    if (!this.directories.has(root)) throw new Error("not a directory");
    const prefix = root === "/" ? "/" : root + "/";
    const names = new Map<string, RemoteEntry>();
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === root) continue;
      const name = directory.slice(prefix.length).split("/")[0];
      names.set(name, { name, path: prefix + name, type: "directory", size: 0 });
    }
    for (const [file, data] of this.files) {
      if (!file.startsWith(prefix)) continue;
      const relative = file.slice(prefix.length);
      if (!relative.includes("/")) names.set(relative, { name: relative, path: prefix + relative, type: "file", size: data.length });
    }
    for (const link of this.links.keys()) {
      if (!link.startsWith(prefix)) continue;
      const name = link.slice(prefix.length).split("/")[0];
      names.set(name, { name, path: prefix + name, type: "symlink", size: 0 });
    }
    return [...names.values()];
  }
  async mkdir(value: string): Promise<void> {
    const safe = validateRemotePath(value);
    const parts = safe.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) this.directories.add("/" + parts.slice(0, index + 1).join("/"));
  }
  async upload(local: string, remote: string): Promise<{ files: number; bytes: number; checksum: string }> {
    const hash = createHash("sha256");
    let files = 0;
    let bytes = 0;
    const visit = async (current: string, target: string): Promise<void> => {
      const entry = await stat(current);
      if (entry.isDirectory()) {
        await this.mkdir(target);
        for (const name of await readdir(current)) await visit(path.join(current, name), target + "/" + name);
      } else {
        const data = await readFile(current);
        await this.write(target, data);
        hash.update(target).update(data);
        files += 1;
        bytes += data.length;
      }
    };
    await visit(local, validateRemotePath(remote));
    return { files, bytes, checksum: hash.digest("hex") };
  }
  async write(value: string, data: string | Buffer): Promise<void> {
    const safe = validateRemotePath(value);
    await this.mkdir(safe.slice(0, safe.lastIndexOf("/")));
    this.files.set(safe, Buffer.from(data));
  }
  async read(value: string): Promise<Buffer> { const found = this.files.get(validateRemotePath(value)); if (!found) throw new Error("missing"); return found; }
  private moveMap<T>(map: Map<string, T>, from: string, to: string): void {
    for (const [key, value] of [...map]) if (key === from || key.startsWith(from + "/")) { map.delete(key); map.set(to + key.slice(from.length), value); }
  }
  async rename(source: string, destination: string): Promise<void> {
    if (this.failNextRename) { this.failNextRename = false; throw new Error("rename failed"); }
    const from = validateRemotePath(source); const to = validateRemotePath(destination);
    this.moveMap(this.files, from, to); this.moveMap(this.links, from, to);
    for (const directory of [...this.directories].sort((a, b) => a.length - b.length)) if (directory === from || directory.startsWith(from + "/")) { this.directories.delete(directory); this.directories.add(to + directory.slice(from.length)); }
  }
  async copy(source: string, destination: string): Promise<void> {
    const from = validateRemotePath(source); const to = validateRemotePath(destination);
    if (this.files.has(from)) return this.write(to, this.files.get(from)!);
    await this.mkdir(to);
    for (const [file, data] of [...this.files]) if (file.startsWith(from + "/")) await this.write(to + file.slice(from.length), data);
    for (const directory of [...this.directories]) if (directory.startsWith(from + "/")) await this.mkdir(to + directory.slice(from.length));
  }
  async remove(value: string, _recursive = false): Promise<void> {
    const safe = validateRemotePath(value);
    for (const key of [...this.files.keys()]) if (key === safe || key.startsWith(safe + "/")) this.files.delete(key);
    for (const key of [...this.links.keys()]) if (key === safe || key.startsWith(safe + "/")) this.links.delete(key);
    for (const key of [...this.directories]) if (key === safe || key.startsWith(safe + "/")) this.directories.delete(key);
  }
  async checksum(value: string): Promise<string> { return createHash("sha256").update(await this.read(value)).digest("hex"); }
  async chmod(): Promise<void> {}
  async symlink(target: string, link: string): Promise<void> { if (this.failSymlink) throw new Error("unsupported"); this.links.set(validateRemotePath(link), validateRemotePath(target)); }
  async readlink(link: string): Promise<string | undefined> { return this.links.get(validateRemotePath(link)); }
  async run(command: RemoteCommand): Promise<{ code: number; stdout: string; stderr: string }> { return { code: 0, stdout: command, stderr: "" }; }
}

describe("configuration 1.1", () => {
  it("migrates compatible deployment fields from 1.0", () => {
    const migrated = migrateProjectConfig({ schemaVersion: "1.0.0", deployment: { provider: "ssh", user: "example", releasesToKeep: 7, healthCheckUrl: "https://example.com" } });
    expect(migrated).toMatchObject({ from: "1.0.0", to: "1.1.0" });
    expect(migrated.changes).toContain("deployment.user->username");
    expect(projectConfigSchema.parse(migrated.value).deployment).toMatchObject({ username: "example", retention: 7 });
  });

  it("uses safe automation and strict-host defaults", () => {
    const parsed = projectConfigSchema.parse({ schemaVersion: "1.1.0" });
    expect(parsed.automation.deployRequiresConfirmation).toBe(true);
    expect(parsed.automation.rollbackOnFailureWithoutConfirmation).toBe(true);
    expect(parsed.deployment.hostVerification.strict).toBe(true);
  });
});

describe("remote path and release manager", () => {
  it.each(["../outside", "/safe/../outside", "/safe;rm", "/safe\nbad", "relative"])("rejects unsafe remote path %s", (value) => {
    expect(() => validateRemotePath(value)).toThrow();
  });

  it("stages, verifies, activates with symlink, snapshots, and rolls back", async () => {
    const root = await temp();
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "index.html"), "first");
    const transport = new MemoryTransport();
    const manager = new RemoteReleaseManager(root, config(root), transport);
    const first = await manager.stage({ releaseId: "release-001" });
    expect(first.status).toBe("staged");
    await manager.activate(first.releaseId);
    expect(await transport.readlink("/application/current")).toBe("/application/releases/release-001");
    await writeFile(path.join(root, "dist", "index.html"), "second");
    const second = await manager.stage({ releaseId: "release-002" });
    expect(second.rollbackTarget).toBe("/application/releases/release-001");
    await manager.activate(second.releaseId);
    const rolledBack = await manager.rollback(second.releaseId, "simulated regression", true);
    expect(rolledBack.status).toBe("rolled-back");
    expect(await transport.readlink("/application/current")).toBe("/application/releases/release-001");
  });

  it("falls back without symlink, verifies backup, and prunes retention", async () => {
    const root = await temp();
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "index.html"), "release");
    const transport = new MemoryTransport();
    transport.failSymlink = true;
    const cfg = config(root, { releaseStrategy: "auto", retention: 1 });
    const manager = new RemoteReleaseManager(root, cfg, transport);
    const first = await manager.stage({ releaseId: "release-001" });
    expect(first.strategy).toBe("rename");
    await manager.activate(first.releaseId);
    await writeFile(path.join(root, "dist", "index.html"), "release-two");
    await manager.stage({ releaseId: "release-002" });
    expect(await transport.exists("/application/backups/release-002")).toBe(true);
    expect(await manager.prune()).toEqual(["release-001"]);
  });

  it("retains the original failure when rollback also fails", async () => {
    const root = await temp();
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "index.html"), "release");
    const transport = new MemoryTransport();
    const manager = new RemoteReleaseManager(root, config(root), transport);
    const release = await manager.stage({ releaseId: "release-001" });
    await manager.activate(release.releaseId);
    await transport.remove("/application/releases/release-001", true);
    await expect(manager.rollback(release.releaseId, "activation failed", true)).rejects.toMatchObject({ code: "rollback.failed" });
  });
});

describe("health, regression, workflows, and logs", () => {
  it("retries detailed HTTP checks and validates remote files", async () => {
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.statusCode = requests === 1 ? 503 : 200;
      response.end("healthy");
    });
    server.on("error", () => undefined);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = "http://127.0.0.1:" + (typeof address === "object" && address ? address.port : 0);
    const transport = new MemoryTransport();
    await transport.mkdir("/application/current");
    await transport.write("/application/current/index.html", "ok");
    try {
      const cfg = config(await temp(), { healthChecks: [
        { type: "http", url, expectedStatus: [200], expectedContent: "healthy", allowRedirects: false, maxLatencyMs: 5_000, timeoutMs: 2_000, retries: 2, retryDelayMs: 1 },
        { type: "remote-file", path: "index.html" }
      ] });
      const report = await runHealthChecks(cfg, transport);
      expect(report.success).toBe(true);
      expect(report.checks[0].attempts).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("flags only severe configured regressions for rollback", async () => {
    const cfg = config(await temp());
    const result = evaluateRegression(
      { summary: { score: 90 }, pages: [{ status: 200 }], issues: [] },
      { summary: { score: 80 }, pages: [{ status: 500 }], issues: [{ severity: "critical", ruleId: "canonical-broken" }] },
      cfg
    );
    expect(result.rollbackRequired).toBe(true);
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["regression.score", "regression.new-critical", "regression.http-5xx", "regression.canonical"]));
  });

  it("persists, resumes, cancels, restores, and cleans workflows", async () => {
    const root = await temp();
    const store = new WorkflowStore(root, config(root));
    const state = await store.start({ mode: "full" });
    await store.transition(state.id, "git");
    const resumed = await store.resume(state.id);
    expect(resumed.stage).toBe("git");
    const cancelled = await store.cancel(state.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await store.clean({ completedOnly: true })).toContain(state.id);
  });

  it("rotates and redacts structured logs", async () => {
    const root = await temp();
    const store = new LocalLogStore(root, { maxBytes: 80, maxFiles: 2 });
    const tokenFixture = "ghp_" + "1234567890abcdefghijkl";
    await store.write({ category: "security", event: "first", details: { token: tokenFixture } });
    await store.write({ category: "security", event: "second", details: { value: "x".repeat(100) } });
    const logs = await store.list({ category: "security" });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(logs)).not.toContain(tokenFixture);
  });

  it("publishes strict schemas and operational metadata for every MCP tool", () => {
    expect(toolDefinitions.length).toBeGreaterThanOrEqual(40);
    for (const tool of toolDefinitions) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool._meta).toMatchObject({ confirmationRequired: expect.any(Boolean), reversible: expect.any(Boolean), timeoutMs: expect.any(Number) });
    }
  });
});

describe("complete persistent orchestration", () => {
  it("runs audit, Git safety, controlled fix handoff, validation, preview, comparison, and commit", async () => {
    const root = await temp();
    const htmlFile = path.join(root, "index.html");
    await writeFile(htmlFile, "<!doctype html><html><head><title>Before</title></head><body><h1>Before</h1></body></html>");
    await writeFile(path.join(root, "server.mjs"), 'import http from "node:http"; import { readFile } from "node:fs/promises"; const server=http.createServer(async (_q,r)=>r.end(await readFile("index.html","utf8"))); server.listen(Number(process.env.PORT),process.env.HOST);');
    await writeFile(path.join(root, ".gitignore"), "reports/\n.codex-seo/\n");
    const production = http.createServer(async (_request, response) => response.end(await readFile(htmlFile, "utf8")));
    await new Promise<void>((resolve) => production.listen(0, "127.0.0.1", resolve));
    const address = production.address();
    const productionUrl = "http://127.0.0.1:" + (typeof address === "object" && address ? address.port : 0);
    const cfg = projectConfigSchema.parse({
      schemaVersion: "1.1.0",
      project: { name: "Example Project", root: ".", productionUrl },
      commands: { preview: "node server.mjs" },
      audit: { crawl: false, performance: false, environment: "test" },
      git: { enabled: true, autoInitialize: true, createWorkBranches: true, defaultBranch: "main" },
      preview: { host: "127.0.0.1", port: 43320, startupTimeoutMs: 10_000 },
      deployment: { provider: "none" },
      output: { dir: "reports" },
      workflow: { stateDirectory: ".codex-seo/state/workflows", maxFixIterations: 2 }
    });
    try {
      const orchestrator = new SeoWorkflowOrchestrator(root, cfg);
      const started = await orchestrator.start({ mode: "quick", autoCommit: true, prepareDeployment: false });
      expect(started).toMatchObject({ stage: "awaiting-fixes", status: "awaiting-action" });
      expect(started.snapshotId).toMatch(/^snapshot-/);
      await writeFile(htmlFile, "<!doctype html><html><head><title>After</title><meta name=\"description\" content=\"Useful example description\"></head><body><h1>After</h1></body></html>");
      const completed = await orchestrator.advanceAfterFixes(started.id);
      expect(completed).toMatchObject({ stage: "completed", status: "completed" });
      expect(completed.reports.before).toBeTruthy();
      expect(completed.reports.preview).toBeTruthy();
      expect((await orchestrator.workflowStore().read(started.id)).history.some((entry) => entry.event === "audit-compared")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => production.close(() => resolve()));
    }
  }, 20_000);
});

describe("real SSH client connection", () => {
  it("connects with a key and exact SHA256 host fingerprint", async () => {
    const root = await temp();
    const host = utils.generateKeyPairSync("ed25519");
    const clientKey = utils.generateKeyPairSync("ed25519");
    await mkdir(path.join(root, ".codex-seo", "secrets"), { recursive: true });
    await writeFile(path.join(root, ".codex-seo", "secrets", "deploy-key"), clientKey.private);
    const parsedHost = utils.parseKey(host.public);
    if (parsedHost instanceof Error) throw parsedHost;
    const serverFingerprint = sshHostFingerprint(parsedHost.getPublicSSH());
    expect(verifySshHostKey(parsedHost.getPublicSSH(), serverFingerprint)).toBe(true);
    expect(verifySshHostKey(parsedHost.getPublicSSH(), "SHA256:" + "A".repeat(43))).toBe(false);
    const parsedClient = utils.parseKey(clientKey.public);
    if (parsedClient instanceof Error) throw parsedClient;
    const server = new Server({ hostKeys: [host.private] }, (connection) => {
      connection.on("authentication", (context) => context.method === "publickey" && parsedClient.equals(context.key.data) ? context.accept() : context.reject());
      connection.on("ready", () => undefined);
    });
    server.on("error", () => undefined);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const badKey = utils.generateKeyPairSync("ed25519");
    await writeFile(path.join(root, ".codex-seo", "secrets", "bad-key"), badKey.private);
    const rejectedAuthentication = new SshSftpTransport({
      projectRoot: root,
      deployment: config(root, {
        host: "127.0.0.1",
        port,
        authentication: { type: "key", privateKeyPath: ".codex-seo/secrets/bad-key" },
        hostVerification: { strict: true, fingerprint: serverFingerprint },
        transport: { connectTimeoutMs: 2_000, operationTimeoutMs: 2_000, reconnectAttempts: 0, preserveTimestamps: true }
      }).deployment
    });
    await expect(rejectedAuthentication.connect()).rejects.toBeTruthy();
    await rejectedAuthentication.close();
    const transport = new SshSftpTransport({
      projectRoot: root,
      deployment: config(root, {
        host: "127.0.0.1",
        port,
        authentication: { type: "key", privateKeyPath: ".codex-seo/secrets/deploy-key" },
        hostVerification: { strict: true, fingerprint: serverFingerprint },
        transport: { connectTimeoutMs: 2_000, operationTimeoutMs: 2_000, reconnectAttempts: 0, preserveTimestamps: true }
      }).deployment
    });
    try {
      await expect(transport.connect()).resolves.toBeUndefined();
    } finally {
      await transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses unknown and incorrect host verification", async () => {
    const root = await temp();
    await mkdir(path.join(root, ".codex-seo", "secrets"), { recursive: true });
    const key = utils.generateKeyPairSync("ed25519");
    await writeFile(path.join(root, ".codex-seo", "secrets", "deploy-key"), key.private);
    const unknown = new SshSftpTransport({
      projectRoot: root,
      deployment: config(root, {
        host: "127.0.0.1",
        port: 9,
        authentication: { type: "key", privateKeyPath: ".codex-seo/secrets/deploy-key" },
        hostVerification: { strict: true },
        transport: { connectTimeoutMs: 200, operationTimeoutMs: 200, reconnectAttempts: 0, preserveTimestamps: true }
      }).deployment
    });
    await expect(unknown.connect()).rejects.toMatchObject({ code: "remote.host-unverified" });
  });
});
