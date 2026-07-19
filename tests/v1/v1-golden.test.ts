import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCiMarkdown, renderGithubAnnotations, renderJunit } from "../../src/ci/ci-export.js";
import { defaultConfig } from "../../src/config/config-schema.js";
import { redactSecrets } from "../../src/core/redaction.js";
import { hasWindowsForbiddenName } from "../../src/security/path-safety.js";
import { schemaVersions } from "../../src/schemas/schema-versions.js";
import { historyEntrySchema, type HistoryEntry } from "../../src/history/history-schema.js";
import { buildTrendReport } from "../../src/trends/trend-engine.js";

const entries: HistoryEntry[] = JSON.parse(readFileSync("tests/fixtures/history/history-entries.json", "utf8")).map((entry: unknown) => historyEntrySchema.parse(entry));
const trend = buildTrendReport(entries.filter((entry) => entry.target.origin === "https://example.test"), { metrics: ["seo.score", "performance.lcpMs", "gsc.clicks"] });

describe("v1 documentation files", () => {
  const docs = ["getting-started.md", "configuration.md", "cli-reference.md", "github-actions.md", "performance.md", "gsc.md", "baselines-and-diff.md", "history-and-trends.md", "quality-gates.md", "privacy-and-security.md", "schemas-and-migrations.md", "troubleshooting.md", "architecture.md", "contributing.md"];
  it.each(docs)("docs/%s exists and has heading", (file) => { const text = readFileSync(path.join("docs", file), "utf8"); expect(text).toMatch(/^# /); expect(text.length).toBeGreaterThan(40); });
  it.each(["README.md", "CHANGELOG.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md"])("%s exists", (file) => { expect(readFileSync(file, "utf8").length).toBeGreaterThan(20); });
});

describe("v1 example configs", () => {
  const configs = ["minimal.json", "complete.json", "performance.json", "gsc.json", "ci.json"];
  it.each(configs)("examples/config/%s parses", (file) => { const json = JSON.parse(readFileSync(path.join("examples/config", file), "utf8")); expect(json.schemaVersion).toBe("1.1.0"); });
  it.each(configs)("examples/config/%s has no real secrets", (file) => { const text = readFileSync(path.join("examples/config", file), "utf8"); expect(text).not.toMatch(/private_key|-----BEGIN|ya29\.|Bearer /); });
});

describe("v1 workflow files", () => {
  const workflows = [".github/workflows/codex-seo.yml", "examples/github-actions/public-audit.yml", "examples/github-actions/gsc-audit.yml", ".github/actions/codex-seo/action.yml"];
  it.each(workflows)("%s has yaml shape", (file) => { const text = readFileSync(file, "utf8"); expect(text).toMatch(/name:|runs:/); expect(text).not.toMatch(/GSC_SERVICE_ACCOUNT_JSON: \{/); });
  it.each(["actions/setup-node", "actions/upload-artifact", "npm ci", "doctor", "export-ci"])("workflow mentions %s", (needle) => { expect(readFileSync(".github/workflows/codex-seo.yml", "utf8")).toContain(needle); });
});

describe("v1 ci golden outputs", () => {
  it.each(["seo.score", "performance.lcpMs", "gsc.clicks"])("markdown contains %s", (metric) => { expect(renderCiMarkdown(trend)).toContain(metric); });
  it.each(["testsuite", "testcase", "property", "confidence"])("junit contains %s", (needle) => { expect(renderJunit(trend)).toContain(needle); });
  it.each(["::notice", "title=seo.score", "confidence"])("annotations contain %s", (needle) => { expect(renderGithubAnnotations(trend)).toContain(needle); });
  it.each(["<script>alert(1)</script>", "line\nbreak", "100%", "a,b:c"])("junit/annotation escapes %#", (value) => { const xml = renderJunit({ ...trend, gate: { passed: false, reasons: [value] } }); expect(xml).not.toContain("<script>"); expect(xml).not.toContain("line\nbreak"); expect(renderGithubAnnotations({ ...trend, gate: { passed: false, reasons: [value] } })).not.toContain("line\nbreak"); });
});

describe("v1 schemas golden", () => {
  it.each(Object.entries(schemaVersions))("%s schema is 1.0.0", (_type, version) => { expect(version).toBe("1.0.0"); });
  it.each(["production", "staging", "preview", "ci", "dev"])("default config supports environment %s", (env) => { expect(defaultConfig(env).target.environment).toBe(env); });
});

describe("v1 redaction golden", () => {
  const secrets = ["Authorization: Bearer abc123", "Bearer xyz", "https://u:p@example.com/", "?token=abc", "?refresh_token=abc", "?client_secret=abc", '"private_key":"abc"', '"api_key":"abc"', "service@example.com"];
  it.each(secrets)("redacts %#", (secret) => { const redacted = redactSecrets(secret, { privacyMode: true }); expect(redacted).not.toMatch(/abc123|Bearer xyz|u:p|token=abc|private_key":"abc|service@example/); expect(redacted).not.toContain('"api_' + 'key":"abc"'); });
});

describe("v1 windows filename golden", () => {
  const invalid = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1", "a<b", "a>b", "a:b", "a\"b", "a|b", "a?b", "a*b"];
  const valid = ["report.json", "history-entry.json", "ÃƒÆ’Ã‚Â©quipe.json", "a-b_c.1.json", "release-v1.0.0.json"];
  it.each(invalid)("rejects %s", (name) => { expect(hasWindowsForbiddenName(name)).toBe(true); });
  it.each(valid)("accepts %s", (name) => { expect(hasWindowsForbiddenName(name)).toBe(false); });
});

describe("v1 package file policy", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  it.each(pkg.files as string[])("package file allowlist %s is safe", (item) => { expect(item).not.toMatch(/node_modules|reports|\.codex-seo|credentials|secret|cache/); });
  it.each(["dist/src", "dist/cli", "skills", "docs", "examples"])("package includes %s", (item) => { expect(pkg.files).toContain(item); });
});

describe("v1 generated skill files", () => {
  const skills = ["codex-seo-setup", "codex-seo-ci", "codex-seo-doctor", "codex-seo-release", "codex-seo-migration"];
  it.each(skills)("skill %s validates basic shape", (skill) => { const text = readFileSync(path.join("skills", skill, "SKILL.md"), "utf8"); expect(text).toContain("## Inputs"); expect(text).toContain("## Project Commands"); });
});

describe("v1 report accessibility static checks", () => {
  it.each(["src/reporting/trend-html.ts", "src/reporting/html-report.ts", "src/reporting/diff-html-report.ts"])("%s contains semantic/reporting affordances", (file) => { const text = readFileSync(file, "utf8"); expect(text).toMatch(/<h1|<title|table|svg|main|section/i); });
});

describe("v1 deterministic fixtures", () => {
  it.each(entries)("entry %s has deterministic id and checksum", (entry) => { expect(entry.historyId).toMatch(/^2026/); expect(entry.checksum).toHaveLength(64); });
  it("fixture ordering is stable", () => { expect(entries.map((e) => e.createdAt)).toEqual([...entries.map((e) => e.createdAt)].sort()); });
});