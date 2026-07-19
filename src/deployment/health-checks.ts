import type { ProjectConfig } from "../project/config.js";
import type { RemoteTransport } from "./remote-transport.js";

export type HealthCheckAttempt = { attempt: number; success: boolean; status?: number; latencyMs: number; error?: string; url?: string };
export type HealthCheckResult = {
  index: number;
  type: "http" | "remote-file" | "remote-command";
  success: boolean;
  attempts: HealthCheckAttempt[];
  details: Record<string, unknown>;
};
export type HealthReport = { success: boolean; startedAt: string; durationMs: number; checks: HealthCheckResult[] };

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function resolveHttpUrl(check: Extract<ProjectConfig["deployment"]["healthChecks"][number], { type: "http" }>, productionUrl?: string): string {
  if (check.url) return check.url;
  if (!productionUrl || productionUrl.includes("$" + "{")) throw new Error("A resolved production URL is required for path-based health checks");
  return new URL(check.path ?? "/", productionUrl).toString();
}

async function httpCheck(index: number, check: Extract<ProjectConfig["deployment"]["healthChecks"][number], { type: "http" }>, productionUrl?: string): Promise<HealthCheckResult> {
  const url = resolveHttpUrl(check, productionUrl);
  const attempts: HealthCheckAttempt[] = [];
  let details: Record<string, unknown> = { url, expectedStatus: check.expectedStatus };
  for (let attempt = 1; attempt <= check.retries + 1; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(url, { redirect: check.allowRedirects ? "follow" : "manual", signal: AbortSignal.timeout(check.timeoutMs) });
      const body = await response.text();
      const latencyMs = Date.now() - started;
      const statusOk = check.expectedStatus.includes(response.status);
      const contentOk = check.expectedContent === undefined || body.includes(check.expectedContent);
      const forbiddenOk = check.forbiddenContent === undefined || !body.includes(check.forbiddenContent);
      const redirectOk = check.allowRedirects || ![301, 302, 303, 307, 308].includes(response.status);
      const latencyOk = check.maxLatencyMs === undefined || latencyMs <= check.maxLatencyMs;
      const success = statusOk && contentOk && forbiddenOk && redirectOk && latencyOk;
      attempts.push({ attempt, success, status: response.status, latencyMs, url });
      details = { ...details, status: response.status, contentMatched: contentOk, forbiddenContentAbsent: forbiddenOk, redirectAccepted: redirectOk, latencyAccepted: latencyOk };
      if (success) return { index, type: "http", success: true, attempts, details };
    } catch (error) {
      attempts.push({ attempt, success: false, latencyMs: Date.now() - started, url, error: error instanceof Error ? error.message : String(error) });
    }
    if (attempt <= check.retries) await sleep(check.retryDelayMs);
  }
  return { index, type: "http", success: false, attempts, details };
}

export async function runHealthChecks(config: ProjectConfig, remote?: RemoteTransport): Promise<HealthReport> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const configured = config.deployment.healthChecks.length
    ? config.deployment.healthChecks
    : config.deployment.healthCheckUrl
      ? [{ type: "http" as const, url: config.deployment.healthCheckUrl, expectedStatus: [200], allowRedirects: true, timeoutMs: 15_000, retries: 2, retryDelayMs: 1_000 }]
      : config.project.productionUrl && !config.project.productionUrl.includes("$" + "{")
        ? [{ type: "http" as const, url: config.project.productionUrl, expectedStatus: [200], allowRedirects: true, timeoutMs: 15_000, retries: 2, retryDelayMs: 1_000 }]
        : [];
  const checks: HealthCheckResult[] = [];
  for (const [index, check] of configured.entries()) {
    if (check.type === "http") {
      checks.push(await httpCheck(index, check, config.project.productionUrl));
      continue;
    }
    if (!remote || !config.deployment.remotePath) {
      checks.push({ index, type: check.type, success: false, attempts: [], details: { error: "Remote transport is unavailable" } });
      continue;
    }
    if (check.type === "remote-file") {
      const remotePath = config.deployment.remotePath + "/current/" + check.path.replace(/^\/+/, "");
      const exists = await remote.exists(remotePath);
      const actualChecksum = exists && check.checksum ? await remote.checksum(remotePath) : undefined;
      const success = exists && (check.checksum === undefined || actualChecksum === check.checksum.toLowerCase());
      checks.push({ index, type: check.type, success, attempts: [], details: { path: check.path, exists, checksumMatched: check.checksum ? actualChecksum === check.checksum.toLowerCase() : undefined } });
      continue;
    }
    const result = await remote.run(check.command, config.deployment.remotePath);
    checks.push({ index, type: check.type, success: result.code === 0, attempts: [], details: { command: check.command, code: result.code, stdout: result.stdout, stderr: result.stderr } });
  }
  return { success: checks.length > 0 && checks.every((check) => check.success), startedAt, durationMs: Date.now() - started, checks };
}
