import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { parseConfiguredCommand } from "./command-runner.js";
import type { ProjectConfig } from "./config.js";
import { redactSecrets } from "../core/redaction.js";

export type PreviewSession = { id: string; pid: number; url: string; port: number; startedAt: string; logs: string[] };
const processes = new Map<string, { child: ChildProcess; session: PreviewSession }>();

async function portAvailable(port: number, host: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function choosePort(start: number, host: string): Promise<number> {
  for (let port = start; port < Math.min(65536, start + 100); port += 1) if (await portAvailable(port, host)) return port;
  throw new Error("No available preview port found");
}

async function waitForUrl(url: string, timeoutMs: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Preview process exited before becoming ready");
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1_000) });
      if (response.status > 0) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Preview startup timed out");
}

export async function startPreview(root: string, config: ProjectConfig): Promise<PreviewSession> {
  if (!config.commands.preview) throw new Error("Preview command is not configured");
  const parsed = parseConfiguredCommand(config.commands.preview);
  const host = config.preview.host;
  const port = await choosePort(config.preview.port, host);
  const logs: string[] = [];
  const child = spawn(parsed.command, parsed.args, {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: host },
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (!child.pid) throw new Error("Preview process did not start");
  const addLog = (chunk: unknown): void => {
    const sanitized = redactSecrets(String(chunk));
    logs.push(...sanitized.split(/\r?\n/).filter(Boolean));
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  child.stdout?.on("data", addLog);
  child.stderr?.on("data", addLog);
  const url = "http://" + host + ":" + port;
  const id = "preview-" + child.pid;
  const session: PreviewSession = { id, pid: child.pid, url, port, startedAt: new Date().toISOString(), logs };
  processes.set(id, { child, session });
  try {
    await waitForUrl(url, config.preview.startupTimeoutMs, child);
    return session;
  } catch (error) {
    await stopPreview(id);
    throw error;
  }
}

export async function stopPreview(id: string): Promise<{ stopped: boolean; id: string }> {
  const tracked = processes.get(id);
  if (!tracked) return { stopped: false, id };
  processes.delete(id);
  const pid = tracked.child.pid;
  if (pid && process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, windowsHide: true });
      killer.on("error", () => { tracked.child.kill("SIGTERM"); resolve(); });
      killer.on("close", () => resolve());
    });
  } else if (pid) {
    try { process.kill(-pid, "SIGTERM"); } catch { tracked.child.kill("SIGTERM"); }
  }
  return { stopped: true, id };
}

export async function stopAllPreviews(): Promise<void> {
  await Promise.all([...processes.keys()].map((id) => stopPreview(id)));
}

export function listPreviews(): PreviewSession[] {
  return [...processes.values()].map(({ session }) => ({ ...session, logs: [...session.logs] }));
}
