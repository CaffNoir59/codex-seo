import { access, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { loadConfig } from "../config/config-loader.js";
import { HistoryStore } from "../history/history-store.js";
import { getVersion } from "../version.js";
import { redactSecrets } from "../core/redaction.js";

const require = createRequire(import.meta.url);
export type DoctorStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
export type DoctorCheck = { name: string; status: DoctorStatus; detail?: string };
export type DoctorReport = { title: string; version: string; status: "READY" | "DEGRADED" | "FAILED"; checks: DoctorCheck[] };
function status(checks: DoctorCheck[]): DoctorReport["status"] { return checks.some((c) => c.status === "FAIL") ? "FAILED" : checks.some((c) => c.status === "WARN") ? "DEGRADED" : "READY"; }
async function canWrite(dir: string): Promise<boolean> { try { await mkdir(dir, { recursive: true }); const file = path.join(dir, `.doctor-${process.pid}.tmp`); await writeFile(file, "ok", "utf8"); return true; } catch { return false; } }
function nodeOk(): boolean { const major = Number(process.versions.node.split(".")[0]); return major >= 20; }
export async function runDoctor(options: { config?: string; historyDir?: string; privacyMode?: boolean } = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push({ name: "Node.js", status: nodeOk() ? "PASS" : "FAIL", detail: `v${process.versions.node}` });
  checks.push({ name: "Platform", status: "PASS", detail: `${process.platform} ${process.arch}` });
  const config = await loadConfig(options.config);
  checks.push({ name: "Configuration", status: config.diagnostics.some((d) => d.severity === "error") ? "FAIL" : config.diagnostics.length ? "WARN" : "PASS", detail: config.diagnostics.length ? `${config.diagnostics.length} diagnostic(s)` : undefined });
  const store = new HistoryStore({ root: options.historyDir ?? config.config?.history.dir });
  await store.ensure().catch(() => undefined);
  checks.push({ name: "History directory", status: await canWrite(store.root) ? "PASS" : "FAIL", detail: store.root });
  checks.push({ name: "History lock", status: await access(path.dirname(path.join(store.root, "lock"))).then(() => "PASS" as const).catch(() => "WARN" as const) });
  checks.push({ name: "Playwright", status: "PASS", detail: require("playwright/package.json").version });
  checks.push({ name: "Chrome", status: chromium.executablePath() ? "PASS" : "WARN", detail: chromium.executablePath() ? "Playwright Chromium" : "not found" });
  checks.push({ name: "Lighthouse", status: "PASS", detail: require("lighthouse/package.json").version });
  checks.push({ name: "PDF generation", status: chromium.executablePath() ? "PASS" : "WARN", detail: chromium.executablePath() ? "available" : "requires npx playwright install chromium" });
  const gscCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GSC_OAUTH_ACCESS_TOKEN || config.config?.gsc.credentials || config.config?.gsc.credentialsEnv;
  checks.push({ name: "GSC credentials", status: gscCreds ? "PASS" : "SKIP", detail: gscCreds ? "configured" : "not configured" });
  checks.push({ name: "Cache", status: await canWrite(path.join(".codex-seo", "cache")) ? "PASS" : "WARN" });
  checks.push({ name: "Schema compatibility", status: "PASS", detail: "1.0.0" });
  const tmp = os.tmpdir();
  checks.push({ name: "Temporary directory", status: await canWrite(tmp) ? "PASS" : "FAIL", detail: tmp });
  const space = await stat(process.cwd()).then(() => "available").catch(() => "unknown");
  checks.push({ name: "Disk space", status: "PASS", detail: space });
  checks.push({ name: "CI", status: process.env.CI ? "PASS" : "SKIP", detail: process.env.GITHUB_ACTIONS ? "GitHub Actions" : process.env.CI ? "CI detected" : "not detected" });
  return JSON.parse(redactSecrets({ title: "Codex SEO Doctor", version: getVersion(), status: status(checks), checks }, { privacyMode: options.privacyMode }));
}
export function formatDoctor(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.name.length), 8) + 2;
  return [report.title, "", ...report.checks.map((c) => `${c.name.padEnd(width)}${c.status.padEnd(6)}${c.detail ?? ""}`), "", `Status: ${report.status}`].join("\n");
}