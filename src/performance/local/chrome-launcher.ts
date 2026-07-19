import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "playwright";

export type ChromeResolution = { path: string; source: "explicit" | "env" | "playwright" | "system" };
export type LaunchedChrome = { port: number; process: ChildProcess; userDataDir: string; chromePath: string; close(): Promise<void> };

const envChromePath = "CODEX_SEO_CHROME_PATH";

function systemCandidates(): string[] {
  if (process.platform === "win32") return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  if (process.platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

export function resolveChromePath(explicitPath?: string): ChromeResolution {
  if (explicitPath) {
    if (existsSync(explicitPath)) return { path: explicitPath, source: "explicit" };
    throw new Error(`Chrome path not found: ${explicitPath}`);
  }
  const envPath = process.env[envChromePath];
  if (envPath) {
    if (existsSync(envPath)) return { path: envPath, source: "env" };
    throw new Error(`${envChromePath} points to a missing file: ${envPath}`);
  }
  try {
    const playwrightPath = chromium.executablePath();
    if (existsSync(playwrightPath)) return { path: playwrightPath, source: "playwright" };
  } catch {
    // Continue to system Chrome candidates.
  }
  const found = systemCandidates().find((candidate) => candidate && existsSync(candidate));
  if (found) return { path: found, source: "system" };
  throw new Error(`No compatible Chrome/Chromium executable found. Set --chrome-path or ${envChromePath}, or run npx playwright install chromium.`);
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) { server.close(); reject(new Error("Unable to allocate port")); return; }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function launchChromeForLighthouse(chromePath?: string): Promise<LaunchedChrome> {
  const resolved = resolveChromePath(chromePath);
  const port = await freePort();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "codex-seo-lh-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-background-networking"
  ];
  const child = spawn(resolved.path, args, { stdio: "ignore" });
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve)).catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  child.once("error", () => { void close(); });
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { port, process: child, userDataDir, chromePath: resolved.path, close };
}