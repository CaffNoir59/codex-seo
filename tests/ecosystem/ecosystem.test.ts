import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectConfig, projectConfigSchema } from "../../src/project/config.js";
import { detectProject } from "../../src/project/detect.js";
import { initializeProject } from "../../src/project/init.js";
import { parseConfiguredCommand } from "../../src/project/command-runner.js";
import { runProjectValidation } from "../../src/project/validation.js";
import { initializeGit, createSnapshot, createWorkBranch, getGitStatus, gitDiff, restoreSnapshot } from "../../src/project/git.js";
import { startPreview, stopPreview, stopAllPreviews } from "../../src/project/preview.js";
import { deploymentStatus, deploymentUploadStaging, deploymentActivate } from "../../src/project/deployment.js";
import { CodexSeoMcpServer, toolDefinitions } from "../../src/mcp/server.js";
import { isProtectedFile, readProjectFile, resolveProjectPath } from "../../src/security/project-policy.js";
import { scanPublishableFiles, scanSensitiveText } from "../../scripts/check-sensitive-content.js";

const temporary: string[] = [];
async function temp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-seo-ecosystem-"));
  temporary.push(directory);
  return directory;
}
afterEach(async () => {
  await stopAllPreviews();
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function config(overrides: Record<string, unknown> = {}) {
  return projectConfigSchema.parse({ schemaVersion: "1.1.0", ...overrides });
}

describe("project configuration", () => {
  it("loads and merges public and local configuration", async () => {
    const root = await temp();
    await writeFile(path.join(root, "codex-seo.config.json"), JSON.stringify({ schemaVersion: "1.0.0", project: { name: "Example Project", root: "." }, commands: { lint: "npm run lint" } }));
    await writeFile(path.join(root, "codex-seo.local.json"), JSON.stringify({ commands: { test: "npm test" } }));
    const loaded = await loadProjectConfig({ cwd: root });
    expect(loaded.config?.commands).toMatchObject({ lint: "npm run lint", test: "npm test" });
  });

  it("resolves environment references", async () => {
    const root = await temp();
    process.env.CODEX_SEO_TEST_URL = "https://example.com";
    await writeFile(path.join(root, "codex-seo.config.json"), JSON.stringify({ schemaVersion: "1.0.0", project: { name: "Example Project", root: ".", productionUrl: "${CODEX_SEO_TEST_URL}" } }));
    const loaded = await loadProjectConfig({ cwd: root });
    expect(loaded.config?.project.productionUrl).toBe("https://example.com");
    delete process.env.CODEX_SEO_TEST_URL;
  });

  it("rejects inline secrets", async () => {
    const root = await temp();
    await writeFile(path.join(root, "codex-seo.config.json"), JSON.stringify({ schemaVersion: "1.0.0", project: { name: "Example Project", root: "." }, deployment: { provider: "ssh", password: "placeholder" } }));
    const loaded = await loadProjectConfig({ cwd: root });
    expect(loaded.config).toBeUndefined();
    expect(loaded.diagnostics.some((item) => item.code === "config.secret-key")).toBe(true);
  });

  it("rejects roots outside the configuration directory", async () => {
    const root = await temp();
    await writeFile(path.join(root, "codex-seo.config.json"), JSON.stringify({ schemaVersion: "1.0.0", project: { name: "Example Project", root: ".." } }));
    const loaded = await loadProjectConfig({ cwd: root });
    expect(loaded.config).toBeUndefined();
    expect(loaded.diagnostics.some((item) => item.code === "config.path-outside-root")).toBe(true);
  });

  it("rejects unsupported schema versions", () => {
    expect(projectConfigSchema.safeParse({ schemaVersion: "2.0.0" }).success).toBe(false);
  });
});

describe("project detection and init", () => {
  it("detects Next.js with npm evidence", async () => {
    const root = await temp();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "1.0.0" }, scripts: { build: "next build", start: "next start" } }));
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await writeFile(path.join(root, "next.config.js"), "export default {}");
    const detection = await detectProject(root);
    expect(detection.framework).toBe("next");
    expect(detection.packageManager).toBe("npm");
    expect(detection.confidence).toBeGreaterThan(0.9);
    expect(detection.evidence.length).toBeGreaterThan(2);
  });

  it.each([
    ["vite", "pnpm-lock.yaml", { vite: "1.0.0" }, "pnpm"],
    ["nuxt", "yarn.lock", { nuxt: "1.0.0" }, "yarn"],
    ["astro", "bun.lock", { astro: "1.0.0" }, "bun"]
  ])("detects %s projects", async (framework, lock, dependencies, manager) => {
    const root = await temp();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies }));
    await writeFile(path.join(root, lock), "");
    const detection = await detectProject(root);
    expect(detection.framework).toBe(framework);
    expect(detection.packageManager).toBe(manager);
  });

  it("reports unknown projects conservatively", async () => {
    expect((await detectProject(await temp())).framework).toBe("unknown");
  });

  it("supports dry-run without writes", async () => {
    const root = await temp();
    const result = await initializeProject({ cwd: root, dryRun: true, git: false });
    expect(result.created).toContain("codex-seo.config.json");
    expect(await stat(path.join(root, "codex-seo.config.json")).then(() => true).catch(() => false)).toBe(false);
  });

  it("is idempotent and backs up forced replacements", async () => {
    const root = await temp();
    await initializeProject({ cwd: root, git: false });
    const second = await initializeProject({ cwd: root, git: false });
    expect(second.skipped).toContain("codex-seo.config.json");
    const forced = await initializeProject({ cwd: root, git: false, force: true });
    expect(forced.backups.some((file) => file.startsWith("codex-seo.config.json.bak-"))).toBe(true);
  });
});

  it("preserves existing MCP servers and creates a backup", async () => {
    const root = await temp();
    await mkdir(path.join(root, ".codex"), { recursive: true });
    const existing = '[mcp_servers.existing]\ncommand = "node"\nargs = ["server.js"]\n';
    await writeFile(path.join(root, ".codex", "config.toml"), existing);
    const result = await initializeProject({ cwd: root, git: false });
    const generated = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
    expect(generated).toContain("[mcp_servers.existing]");
    expect(generated).toContain("[mcp_servers.codex_seo]");
    expect(result.backups.some((file) => file.startsWith(".codex/config.toml.bak-"))).toBe(true);
  });

describe("security and configured commands", () => {
  it("blocks protected files and traversal", async () => {
    const root = await temp();
    await writeFile(path.join(root, ".env"), "VALUE=secret");
    expect(isProtectedFile(".env")).toBe(true);
    await expect(readProjectFile(root, ".env")).rejects.toThrow(/Protected/);
    await expect(resolveProjectPath(root, "../outside.txt", { allowMissing: true })).rejects.toThrow(/outside/);
  });

  it("parses allowed commands without a shell", () => {
    expect(parseConfiguredCommand('npm run lint -- --fix')).toEqual({ command: "npm", args: ["run", "lint", "--", "--fix"] });
    expect(() => parseConfiguredCommand("npm test && echo bad")).toThrow(/Shell operators/);
    expect(() => parseConfiguredCommand("powershell script.ps1")).toThrow(/not allowed/);
  });

  it("marks missing validation commands as skipped", async () => {
    const result = await runProjectValidation(await temp(), config(), ["test"]);
    expect(result.results[0]).toMatchObject({ status: "skipped", reason: "command-not-configured" });
  });
});

describe("local Git workflow", () => {
  it("initializes, snapshots, branches, diffs, and restores", async () => {
    const root = await temp();
    await writeFile(path.join(root, "index.html"), "before");
    await initializeGit(root);
    const snapshot = await createSnapshot(root, { confirmed: true });
    expect(snapshot.id).toMatch(/^snapshot-/);
    const branch = await createWorkBranch(root);
    expect(branch.branch).toMatch(/^codex-seo\//);
    await writeFile(path.join(root, "index.html"), "after");
    expect(await gitDiff(root)).toContain("after");
    await restoreSnapshot(root, snapshot.id, true);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("before");
    expect((await getGitStatus(root)).repository).toBe(true);
  });
});

describe("preview and deployment", () => {
  it("starts and stops a localhost preview", async () => {
    const root = await temp();
    await writeFile(path.join(root, "server.mjs"), 'import http from "node:http"; const server=http.createServer((q,r)=>r.end("ok")); server.listen(Number(process.env.PORT), process.env.HOST);');
    const previewConfig = config({ commands: { preview: "node server.mjs" }, preview: { port: 43100, startupTimeoutMs: 10_000 } });
    const session = await startPreview(root, previewConfig);
    expect((await fetch(session.url)).status).toBe(200);
    expect((await stopPreview(session.id)).stopped).toBe(true);
  });

  it("supports provider none and local-directory staging", async () => {
    const root = await temp();
    expect((await deploymentStatus(root, config())).summary).toMatchObject({ configured: false });
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "index.html"), "release");
    const deployConfig = config({ deployment: { provider: "local-directory", artifactPath: "dist", localPath: ".codex-seo/deployments/local" } });
    const staged = await deploymentUploadStaging(root, deployConfig);
    const releaseId = String(staged.summary.releaseId);
    const activated = await deploymentActivate(root, deployConfig, releaseId, true);
    expect(activated.success).toBe(true);
    expect(await readFile(path.join(root, ".codex-seo/deployments/local/current/index.html"), "utf8")).toBe("release");
  });
});

describe("MCP and sensitive content", () => {
  it("lists the complete initial tool surface", async () => {
    expect(toolDefinitions.length).toBeGreaterThanOrEqual(38);
    const server = new CodexSeoMcpServer(await temp());
    const reply = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((reply?.result as { tools: unknown[] }).tools).toHaveLength(toolDefinitions.length);
  });

  it("allows detection but refuses writes without configuration", async () => {
    const server = new CodexSeoMcpServer(await temp());
    expect((await server.callTool("project_detect", {})).success).toBe(true);
    expect((await server.callTool("git_initialize", { confirmed: true })).success).toBe(false);
  });

  it("returns structured diagnostics with valid configuration", async () => {
    const root = await temp();
    await initializeProject({ cwd: root, git: false });
    const server = new CodexSeoMcpServer(root);
    const result = await server.callTool("project_status", {});
    expect(result).toMatchObject({ success: true, operation: "project_status", warnings: [] });
  });

  it("detects sensitive signatures across the clean repository", async () => {
    const tokenFixture = "ghp_" + "1234567890abcdefghijkl";
    const keyFixture = "-----BEGIN " + "PRIVATE KEY-----";
    const windowsPathFixture = "C:" + "\\Users\\real-person\\project";
    const fingerprintFixture = "SHA256:" + "A".repeat(43);
    const uuidFixture = "123e4567-" + "e89b-42d3-a456-426614174000";
    const forgeFixture = "https" + "://gitlab" + ".com/private/project";
    const serviceFixture = "cloud" + "flare";
    const phoneFixture = "+33" + "123456789";
    const modernKeyFixture = "sk-" + "projectexamplekey123456";
    const steamIdFixture = "7656119" + "1234567890";
    const discordIdFixture = "discordId=" + "123456789012345678";
    const sshPublicFixture = "ssh-ed25519 " + "A".repeat(44) + " author@example.com";
    expect(scanSensitiveText("token=" + tokenFixture).some((item) => item.rule === "common-token")).toBe(true);
    expect(scanSensitiveText(keyFixture).some((item) => item.rule === "private-key")).toBe(true);
    expect(scanSensitiveText(windowsPathFixture).some((item) => item.rule === "windows-personal-path")).toBe(true);
    expect(scanSensitiveText("/home/" + "private-user/project").some((item) => item.rule === "linux-personal-path")).toBe(true);
    expect(scanSensitiveText(fingerprintFixture).some((item) => item.rule === "ssh-fingerprint")).toBe(true);
    expect(scanSensitiveText(uuidFixture).some((item) => item.rule === "uuid")).toBe(true);
    expect(scanSensitiveText("person@" + "company" + ".fr").some((item) => item.rule === "email")).toBe(true);
    expect(scanSensitiveText(forgeFixture).some((item) => item.rule === "personal-forge-url")).toBe(true);
    expect(scanSensitiveText("client" + ".fr").some((item) => item.rule === "non-generic-domain")).toBe(true);
    expect(scanSensitiveText(serviceFixture).some((item) => item.rule === "service-reference")).toBe(true);
    expect(scanSensitiveText(phoneFixture).some((item) => item.rule === "phone-number")).toBe(true);
    expect(scanSensitiveText(modernKeyFixture).some((item) => item.rule === "openai-key")).toBe(true);
    expect(scanSensitiveText(steamIdFixture).some((item) => item.rule === (String.fromCharCode(115, 116, 101, 97, 109) + "-id"))).toBe(true);
    expect(scanSensitiveText(discordIdFixture).some((item) => item.rule === (String.fromCharCode(100, 105, 115, 99, 111, 114, 100) + "-id"))).toBe(true);
    expect(scanSensitiveText(sshPublicFixture).some((item) => item.rule === "ssh-public-key")).toBe(true);
    expect(scanSensitiveText("${DEPLOY_HOST} author@example.com https://example.com")).toEqual([]);
    expect(await scanPublishableFiles(process.cwd())).toEqual([]);
  });
});
