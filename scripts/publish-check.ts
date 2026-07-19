import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

type RunResult = { code: number; stdout: string; stderr: string };

async function run(name: string, args: string[], cwd: string, input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const npmCli = name === "npm" ? process.env.npm_execpath : undefined;
    const executable = npmCli ? process.execPath : name;
    const executableArgs = npmCli ? [npmCli, ...args] : args;
    const child = spawn(executable, executableArgs, { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

function parsePackOutput(stdout: string): Array<{ filename: string; files: Array<{ path: string }> }> {
  const json = stdout.match(/(\[\s*\{\s*"id"[\s\S]*\]\s*)$/)?.[1] ?? stdout;
  return JSON.parse(json) as Array<{ filename: string; files: Array<{ path: string }> }>;
}

function passed(label: string, result: RunResult): RunResult {
  if (result.code !== 0) throw new Error(label + " failed\n" + (result.stderr || result.stdout).slice(-20_000));
  return result;
}

const repository = process.cwd();
const workspace = await mkdtemp(path.join(tmpdir(), "codex-seo-publish-"));
let tarball: string | undefined;
try {
  passed("validation", await run("npm", ["run", "validate"], repository));
  passed("dependency audit", await run("npm", ["audit", "--audit-level=moderate"], repository));
  const dry = passed("npm pack dry-run", await run("npm", ["pack", "--dry-run", "--json"], repository));
  const dryResult = parsePackOutput(dry.stdout);
  const dryFiles = dryResult[0]?.files.map((entry) => entry.path) ?? [];
  if (!dryFiles.some((file) => file === "dist/cli/index.js") || !dryFiles.some((file) => file === "dist/src/index.d.ts") || !dryFiles.some((file) => file.includes("plugin/codex-seo/.codex-plugin/plugin.json"))) {
    throw new Error("Dry-run tarball is missing executables or plugin metadata");
  }
  const forbidden = dryFiles.filter((file) => /^(?:reports|history|coverage|test-results|backups|logs|codex-seo\.local\.json)(?:\/|$)/i.test(file) || /\.(?:pem|key|log)$/i.test(file));
  if (forbidden.length) throw new Error("Tarball contains forbidden artifacts: " + forbidden.join(", "));
  const packed = passed("npm pack", await run("npm", ["pack", "--json"], repository));
  const packResult = parsePackOutput(packed.stdout);
  tarball = path.join(repository, packResult[0].filename);
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "codex-seo-publication-check", version: "1.0.0", private: true }, null, 2), "utf8");
  passed("temporary package install", await run("npm", ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], workspace));
  const cli = path.join(workspace, "node_modules", "codex-seo", "dist", "cli", "index.js");
  passed("installed executable", await run(process.execPath, [cli, "version"], workspace));
  passed("temporary init", await run(process.execPath, [cli, "init", "--yes", "--no-git", "--json"], workspace));
  const mcp = path.join(workspace, "node_modules", "codex-seo", "dist", "cli", "mcp.js");
  const mcpInput = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n"
    + JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n";
  const mcpResult = passed("temporary MCP", await run(process.execPath, [mcp], workspace, mcpInput));
  const messages = mcpResult.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { result?: { tools?: unknown[] } });
  if (!messages.some((message) => Array.isArray(message.result?.tools))) throw new Error("Installed MCP did not return a tool list");
  passed("plugin doctor", await run(process.execPath, [cli, "plugin", "doctor", "--json"], workspace));
  const installedManifest = JSON.parse(await readFile(path.join(workspace, "node_modules", "codex-seo", "plugin", "codex-seo", ".codex-plugin", "plugin.json"), "utf8")) as { version: string };
  if (installedManifest.version !== "1.1.0") throw new Error("Installed plugin version is not synchronized");
  console.log(JSON.stringify({ ready: true, version: installedManifest.version, files: dryFiles.length, toolsListed: true, temporaryInstall: true }, null, 2));
} finally {
  if (tarball && path.dirname(tarball) === repository && /^codex-seo-1\.1\.0\.tgz$/.test(path.basename(tarball))) await rm(tarball, { force: true });
  await rm(workspace, { recursive: true, force: true });
}
