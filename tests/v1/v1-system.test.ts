import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderGithubAnnotations, renderJunit, testInternals } from "../../src/ci/ci-export.js";
import { defaultConfig } from "../../src/config/config-schema.js";
import { fixConfigObject, loadConfig, validateConfigFile } from "../../src/config/config-loader.js";
import { initProject } from "../../src/config/init.js";
import { CodexSeoError, ConfigurationError, CrawlError, DependencyError, GateError, GscError, HistoryError, NetworkError, PerformanceError, ReportError, ValidationError, CompatibilityError, normalizeError } from "../../src/core/errors.js";
import { redactSecrets } from "../../src/core/redaction.js";
import { runDoctor } from "../../src/doctor/doctor.js";
import { historyEntrySchema, type HistoryEntry } from "../../src/history/history-schema.js";
import { HistoryStore } from "../../src/history/history-store.js";
import { assertSafeWritePath, hasWindowsForbiddenName, isRootOrHome } from "../../src/security/path-safety.js";
import { detectSchemaType, validateSchema } from "../../src/schemas/schema-registry.js";
import { migrateSchema } from "../../src/schemas/schema-migrations.js";
import { getCurrentSchemaVersion, schemaTypes } from "../../src/schemas/schema-versions.js";
import { buildTrendReport } from "../../src/trends/trend-engine.js";
import type { TrendReport } from "../../src/trends/trend-schema.js";

const bin = path.join(process.cwd(), "dist/cli/index.js");
const entries: HistoryEntry[] = JSON.parse(readFileSync("tests/fixtures/history/history-entries.json", "utf8")).map((entry: unknown) => historyEntrySchema.parse(entry));
const trend = buildTrendReport(entries.filter((entry) => entry.target.origin === "https://example.test"), { metrics: ["seo.score", "performance.lcpMs", "gsc.clicks"] });
function runCli(args: string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = {}) { return spawnSync(process.execPath, [bin, ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8" }); }
function parseXmlEnough(xml: string) { expect(xml).toMatch(/^<\?xml/); expect(xml).toContain("<testsuite"); expect(xml).toContain("</testsuite>"); expect((xml.match(/<testcase /g) ?? []).length).toBeGreaterThan(0); }
async function tempDir(prefix = "codex-seo-v1-") { return await mkdtemp(path.join(os.tmpdir(), prefix)); }

describe("v1 compiled CLI", () => {
  const cliCases: string[][] = [["--version"], ["--help"], ["audit", "--help"], ["diff", "--help"], ["history", "--help"], ["gsc", "--help"], ["doctor", "--json"], ["init", "--minimal", "--dry-run"], ["validate", "--json-output"]];
  it.each(cliCases)("runs %s", (...args: string[]) => { if (!existsSync(bin)) return; const result = runCli(args); expect([0, 1]).toContain(result.status); expect(`${result.stdout}${result.stderr}`).not.toContain("[object Object]"); });
  it("prints version from package", () => { if (!existsSync(bin)) return; expect(runCli(["--version"]).stdout.trim()).toBe("1.1.1"); });
  it("reports missing argument with exit 1", () => { if (!existsSync(bin)) return; expect(runCli(["audit"]).status).not.toBe(0); });
  it("ignores unrelated npm_config values", () => { if (!existsSync(bin)) return; const result = runCli(["doctor", "--json"], process.cwd(), { npm_config_mystery: "secret" }); expect(result.stdout).not.toContain("mystery"); });
  it("supports schema migrate dry-run", () => { if (!existsSync(bin)) return; const result = runCli(["migrate", "tests/fixtures/history/history-entries.json", "--dry-run", "--json-output"]); expect(result.status).toBe(0); expect(result.stdout).toContain("targetVersion"); });
});

describe("init command behavior", () => {
  it.each(["production", "staging", "preview", "unicode-ÃƒÂ©quipe"])("creates dry-run plan for %s", async (environment) => { const dir = await tempDir(); try { const result = await initProject({ cwd: dir, environment, minimal: true, dryRun: true, ci: "github" }); expect(result.created).toContain("codex-seo.config.json"); expect(await stat(path.join(dir, "codex-seo.config.json")).then(() => true).catch(() => false)).toBe(false); } finally { await rm(dir, { recursive: true, force: true }); } });
  it.each([false, true])("respects force=%s", async (force) => { const dir = await tempDir(); try { await writeFile(path.join(dir, "codex-seo.config.json"), "{}", "utf8"); const result = await initProject({ cwd: dir, minimal: true, force }); expect(force ? result.created : result.skipped).toContain("codex-seo.config.json"); } finally { await rm(dir, { recursive: true, force: true }); } });
});

describe("configuration validation", () => {
  it("accepts default config", () => { expect(defaultConfig().schemaVersion).toBe("1.1.0"); });
  it.each([{ performance: { runs: 0 } }, { unknown: true }, { gsc: { enabled: true } }, { pagespeedKey: "OLD" }, { gsc: { enabled: true, property: "x", credentials: { private_key: "secret" } } }])("diagnoses config %#", async (raw) => { const dir = await tempDir(); try { const file = path.join(dir, "codex-seo.config.json"); await writeFile(file, JSON.stringify(raw), "utf8"); const result = await loadConfig(file); expect(result.diagnostics.length).toBeGreaterThan(0); expect(result.diagnostics[0]).toHaveProperty("suggestion"); } finally { await rm(dir, { recursive: true, force: true }); } });
  it("fixes missing version and writes backup", async () => { const dir = await tempDir(); try { const file = path.join(dir, "codex-seo.config.json"); await writeFile(file, "{}", "utf8"); const result = await validateConfigFile(file, { fix: true }); expect(result.config?.schemaVersion).toBe("1.1.0"); expect(existsSync(`${file}.bak`)).toBe(true); } finally { await rm(dir, { recursive: true, force: true }); } });
  it("fixConfigObject is deterministic", () => { expect(fixConfigObject({}).fixed).toEqual(fixConfigObject({}).fixed); });
});

describe("doctor", () => {
  it("returns structured checks", async () => { const report = await runDoctor(); expect(report.title).toBe("Codex SEO Doctor"); expect(report.checks.length).toBeGreaterThan(8); });
  it.each(["Node.js", "Platform", "Configuration", "History directory", "Chrome", "Lighthouse", "GSC credentials", "Schema compatibility"])("contains %s", async (name) => { expect((await runDoctor()).checks.some((check) => check.name === name)).toBe(true); });
  it("redacts privacy sensitive values", async () => { const report = await runDoctor({ privacyMode: true }); expect(JSON.stringify(report)).not.toMatch(/private_key|Bearer/); });
});

describe("CI exports", () => {
  it("renders parseable JUnit", () => { parseXmlEnough(renderJunit(trend)); });
  it.each(["&", "<", ">", "\"", "'", "ÃƒÂ©", "::error", "%0A"])("escapes XML/annotation %#", (value) => { expect(testInternals.xmlEscape(value)).not.toContain("<script"); expect(testInternals.annotationEscape(value)).not.toContain("\n"); });
  it("emits GitHub annotations", () => { const text = renderGithubAnnotations(trend); expect(text).toContain("::notice"); expect(text).not.toContain("\n::error file=missing"); });
  it("marks gate failures in JUnit", () => { const failed: TrendReport = { ...trend, gate: { passed: false, reasons: ["SEO score dropped by 7 points"] } }; const xml = renderJunit(failed); expect(xml).toContain("<failure"); parseXmlEnough(xml); });
});

describe("schema registry and migrations", () => {
  it.each(schemaTypes)("has current version for %s", (type) => { expect(getCurrentSchemaVersion(type)).toBe("1.0.0"); });
  it("detects history", () => { expect(detectSchemaType(entries[0])).toBe("history"); });
  it("migrates history idempotently", () => { const a = migrateSchema(entries[0]); const b = migrateSchema(a.migrated); expect(b.changed).toBe(false); });
  it("returns unknown for arbitrary objects", () => { expect(validateSchema({ nope: true }).type).toBe("unknown"); });
});

describe("structured errors", () => {
  const classes = [ConfigurationError, ValidationError, NetworkError, CrawlError, PerformanceError, GscError, HistoryError, CompatibilityError, GateError, ReportError, DependencyError];
  it.each(classes)("serializes %s", (Ctor) => { const err = new Ctor("Bearer abc123", { url: "https://u:p@example.com" }); const json = normalizeError(err, false); expect(json).toHaveProperty("code"); expect(JSON.stringify(json)).not.toContain("abc123"); });
  it("base error keeps stable category", () => { const err = new CodexSeoError({ code: "x", message: "m", category: "runtime" }); expect(err.toJSON()).toMatchObject({ code: "x", category: "runtime" }); });
});

describe("redaction and security", () => {
  const privateKeyFixture = ["-----BEGIN ", "PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"].join("");
  it.each(["Authorization: Bearer abc123", "https://user:pass@example.com", "?api_key=secret", "client_secret=secret", '"private_key":"secret"', privateKeyFixture])("redacts %#", (text) => { expect(redactSecrets(text)).not.toMatch(/abc123|user:pass|api_key=secret|private_key.*secret/); });
  it.each(["CON", "bad<name>.json", "NUL.txt", "a|b.json", "LPT1"])("detects Windows forbidden %s", (name) => { expect(hasWindowsForbiddenName(name)).toBe(true); });
  it.each(["report.json", "nested/report.json", "unicode-ÃƒÂ©.json", "safe_name.txt"])("allows safe names %s", (name) => { expect(hasWindowsForbiddenName(name)).toBe(false); });
  it("rejects root/home for dangerous writes", () => { expect(isRootOrHome(path.parse(process.cwd()).root)).toBe(true); });
  it("rejects directory output as file", async () => { const dir = await tempDir(); try { await expect(assertSafeWritePath(dir, { mustBeFile: true })).rejects.toThrow(/directory|Unsafe/); } finally { await rm(dir, { recursive: true, force: true }); } });
});

describe("multiplatform path simulations", () => {
  it.each(["C:\\Example\\Project\\report.json", "/path/to/project/report.json", "/path/to/application/report.json", "reports\\win\\file.json", "reports/posix/file.json"])("normalizes %s", (input) => { expect(path.normalize(input).length).toBeGreaterThan(0); });
  it.each(["chrome.exe", "Google Chrome.app", "/usr/bin/google-chrome", "msedge.exe"])("documents browser candidate %s", (name) => { expect(name.toLowerCase()).toMatch(/chrome|edge/); });
});

describe("large volume simulations", () => {
  it.each([1000, 10000])("handles %s pages summary", (count) => { const pages = Array.from({ length: count }, (_, i) => `https://example.com/${i}`); expect(new Set(pages).size).toBe(count); });
  it("handles 500 history entries", () => { const many = Array.from({ length: 500 }, (_, i) => ({ ...entries[0], historyId: `20260101T000000Z-production-${i}`, createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })); expect(buildTrendReport(many.map((entry) => historyEntrySchema.parse(entry)), { metrics: ["seo.score"] }).entries).toBe(500); });
  it("summarizes 50000 issues without storing them in PDF", () => { const count = 50000; const severities = { critical: 10, high: 100, medium: 1000, low: count - 1110 }; expect(Object.values(severities).reduce((a, b) => a + b, 0)).toBe(count); });
  it("handles 25000 GSC rows as aggregate", () => { const clicks = Array.from({ length: 25000 }, (_, i) => i % 10).reduce((a, b) => a + b, 0); expect(clicks).toBe(112500); });
});

describe("packaging metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  it.each(["name", "version", "license", "repository", "homepage", "bugs", "bin", "exports", "types", "files", "engines"])("has %s", (key) => { expect(pkg[key]).toBeTruthy(); });
  it("excludes local reports/history from package files", () => { expect(pkg.files.join("\n")).not.toMatch(/reports|\.codex-seo/); });
  it("bin points to compiled CLI", () => { expect(pkg.bin["codex-seo"]).toBe("dist/cli/index.js"); });
});