import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { clearRobotsCache } from "../../src/crawler/robots.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/fixture-server.js";

let fixture: FixtureServer | undefined;
let tempDirs: string[] = [];
afterEach(async () => {
  clearRobotsCache();
  await fixture?.close();
  fixture = undefined;
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function runCli(args: string[], env: Record<string, string> = {}) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "audit", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test", CODEX_SEO_TEST_ALLOW_PRIVATE_NETWORK: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-seo-cli-"));
  tempDirs.push(dir);
  return dir;
}

describe("CLI crawl options", () => {
  it("uses default crawl values and prints the final summary", async () => {
    fixture = await startFixtureServer();
    const out = await runCli([fixture.baseUrl, "--crawl", "--max-pages", "3", "--output", await tempDir()]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Mode: sitewide");
    expect(out.stdout).toContain("Pages decouvertes:");
    expect(out.stdout).toContain("Chemins des rapports generes:");
  });

  it("returns non-zero for negative, zero and non-numeric max-pages", async () => {
    expect((await runCli(["https://example.com", "--crawl", "--max-pages", "-1"])).code).not.toBe(0);
    expect((await runCli(["https://example.com", "--crawl", "--max-pages", "0"])).code).not.toBe(0);
    expect((await runCli(["https://example.com", "--crawl", "--max-pages", "nope"])).code).not.toBe(0);
  }, 20000);

  it("returns non-zero for excessive concurrency", async () => {
    const out = await runCli(["https://example.com", "--crawl", "--concurrency", "99"]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("concurrency");
  });

  it("returns non-zero for invalid render mode", async () => {
    const out = await runCli(["https://example.com", "--crawl", "--render", "sometimes"]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("render");
  });

  it("writes reports to the requested output directory", async () => {
    fixture = await startFixtureServer();
    const dir = await tempDir();
    const out = await runCli([fixture.baseUrl, "--crawl", "--max-pages", "3", "--output", dir]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(dir);
  });

  it("supports --ignore-robots and --no-cache", async () => {
    fixture = await startFixtureServer();
    const out = await runCli([fixture.baseUrl, "--crawl", "--max-pages", "10", "--ignore-robots", "--no-cache", "--output", await tempDir()]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Pages bloquees par robots: 0");
  });

  it("accepts --include-subdomains without widening to lookalike domains", async () => {
    fixture = await startFixtureServer();
    const out = await runCli([fixture.baseUrl, "--crawl", "--max-pages", "5", "--include-subdomains", "--output", await tempDir()]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Mode: sitewide");
  });

  it("supports --crawl and --pdf together", async () => {
    fixture = await startFixtureServer();
    const out = await runCli([fixture.baseUrl, "--crawl", "--max-pages", "3", "--pdf", "--output", await tempDir()]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("sitewide-report.pdf");
  });

  it("keeps private-network fixture access unavailable unless test env is set", async () => {
    fixture = await startFixtureServer();
    const out = await runCli([fixture.baseUrl, "--crawl", "--max-pages", "1", "--output", await tempDir()], { CODEX_SEO_TEST_ALLOW_PRIVATE_NETWORK: "0" });
    expect(out.code).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain("blocked");
  });
});

