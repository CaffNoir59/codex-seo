import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type SensitiveFinding = { file: string; line: number; rule: string; sample: string };

const ignoredDirectories = new Set(["node_modules", ".git"]);
const ignoredBinaryExtensions = /\.(?:png|jpg|jpeg|gif|pdf|zip|tgz|tar|gz|7z|woff2?|ico)$/i;
const forbiddenFileNames = /(^|\/)(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|known_hosts|authorized_keys|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|cookies?(?:\.[^/]*)?|sessions?(?:\.[^/]*)?|[^/]+\.(?:pem|key|p12|pfx|crt|cer|csr|jks|keystore|tgz|tar|gz|zip|7z|bak|backup|old|log))$/i;
const allowedFindingKeys = new Set([
  "src/core/redaction.ts:private-key",
  "dist/src/core/redaction.js:private-key",
  "CHANGELOG.md:service-reference",
  "README.md:service-reference",
  "docs/ecosystem.md:service-reference",
  "docs/hostinger.md:service-reference",
  "scripts/check-sensitive-content.ts:certificate",
  "scripts/check-sensitive-content.ts:service-reference",
  "dist/scripts/check-sensitive-content.js:certificate",
  "dist/scripts/check-sensitive-content.js:service-reference"
]);
const allowedServiceHosts = new Set([
  "chromeuxreport.googleapis.com",
  "developer.chrome.com",
  "github.com",
  "iana.org",
  "oauth2.googleapis.com",
  "opencollective.com",
  "registry.npmjs.org",
  "schema.org",
  "searchconsole.googleapis.com",
  "tidelift.com",
  "web.dev",
  "www.googleapis.com",
  "www.sitemaps.org"
]);

function safeSample(value: string): string {
  if (value.length <= 12) return "[redacted]";
  return value.slice(0, 4) + "?" + value.slice(-4);
}

function isExampleEmail(value: string): boolean {
  const domain = value.toLowerCase().split("@").at(-1) ?? "";
  return domain === "example.com" || domain === "example.test" || domain.endsWith(".example.com") || domain.endsWith(".example.test");
}

function isExampleHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "0.0.0.0"
    || normalized === "example.com" || normalized === "example.org" || normalized === "example.net"
    || normalized.endsWith(".example.com") || normalized.endsWith(".example.org") || normalized.endsWith(".example.net")
    || normalized.endsWith(".example") || normalized.endsWith(".test") || normalized.endsWith(".invalid")
    || allowedServiceHosts.has(normalized);
}

function isDocumentationIp(value: string): boolean {
  return value === "127.0.0.1" || value === "0.0.0.0" || value === "192.0.2.1" || value === "198.51.100.1" || value === "203.0.113.1";
}

function normalizeFile(file: string): string {
  return file.replace(/\\/g, "/");
}

export function scanSensitiveText(text: string, file = "input", forbiddenNames: string[] = []): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  const add = (index: number, rule: string, value: string): void => {
    const line = text.slice(0, index).split("\n").length;
    findings.push({ file: normalizeFile(file), line, rule, sample: safeSample(value) });
  };
  const rules: Array<[string, RegExp]> = [
    ["windows-personal-path", /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi],
    ["linux-personal-path", /\/home\/(?!example(?:\/|$))[^/\s"']+/gi],
    ["macos-personal-path", /\/Users\/(?!example(?:\/|$))[^/\s"']+/gi],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["certificate", /-----BEGIN CERTIFICATE-----/g],
    ["ssh-fingerprint", /\bSHA256:[A-Za-z0-9+/]{20,}={0,2}\b/g],
    ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
    ["common-token", /\b(?:ghp|github_pat|glpat|sk|sbp|xox[baprs])_[A-Za-z0-9_-]{12,}\b/g],
    ["npm-token", /\bnpm_[A-Za-z0-9]{36}\b/g],
    ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g],
    ["ssh-public-key", /\bssh-(?:rsa|ed25519|ecdsa-[A-Za-z0-9-]+)\s+[A-Za-z0-9+/]{40,}={0,3}(?:\s+[^\r\n]+)?/g],
    ["discord-token", /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}\b/g],
    ["steam-id", /\b7656119[0-9]{10}\b/g],
    ["discord-id", /\b(?:discord(?:Id)?|guildId|channelId|userId)["']?\s*[:=]\s*["']?[0-9]{17,20}\b/gi],
    ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ["google-api-key", /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ];
  for (const [rule, pattern] of rules) for (const match of text.matchAll(pattern)) add(match.index ?? 0, rule, match[0]);
  for (const match of text.matchAll(/\+[1-9][0-9]{9,14}\b/g)) if (match[0] !== "+10000000000") add(match.index ?? 0, "phone-number", match[0]);

  for (const match of text.matchAll(/\b(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|session)["']?\s*[:=]\s*["']([^"']{6,})["']/gi)) {
    const value = match[1].toLowerCase();
    if (!/^(?:\$\{[^}]+\}|example|placeholder|redacted|secret|topsecret|cruxsecret|abc123)$/.test(value)) add(match.index ?? 0, "inline-secret", match[0]);
  }

  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    if (!isExampleEmail(match[0])) add(match.index ?? 0, "email", match[0]);
  }
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (!isDocumentationIp(match[0])) add(match.index ?? 0, "ip-address", match[0]);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
    const raw = match[0].split("${", 1)[0].replace(/[),\]}.;]+$/, "");
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    const isIpHost = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname);
    if (!isIpHost && !isExampleHost(url.hostname)) add(match.index ?? 0, "non-generic-domain", url.hostname);
    const placeholderCredentials = isExampleHost(url.hostname) && /^(?:user|u)$/.test(url.username) && /^(?:pass|p)$/.test(url.password);
    if ((url.username || url.password) && !placeholderCredentials) add(match.index ?? 0, "url-credentials", raw);
    if (file !== "package-lock.json" && /^(?:github\.com|gitlab\.com|bitbucket\.org)$/i.test(url.hostname)) {
      const segments = url.pathname.split("/").filter(Boolean);
      const approvedOwners = new Set(["example", "caffnoir59"]);
      const approved = url.hostname.toLowerCase() === "github.com" && approvedOwners.has(segments[0]?.toLowerCase() ?? "") && segments[1]?.toLowerCase().replace(/\.git$/, "") === "codex-seo";
      if (segments.length >= 2 && !approved) add(match.index ?? 0, "personal-forge-url", raw);
    }
  }
  for (const match of text.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|dev|fr|de|uk|co|watch|cloud|ai|me|xyz)\b/gi)) {
    if (!isExampleHost(match[0])) add(match.index ?? 0, "non-generic-domain", match[0]);
  }
  for (const match of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi)) add(match.index ?? 0, "uuid", match[0]);

  const servicePattern = new RegExp("\\b(?:" + ["host" + "inger", "cloud" + "flare", "supa" + "base", "dis" + "cord", "ste" + "am"].join("|") + ")\\b", "gi");
  for (const match of text.matchAll(servicePattern)) add(match.index ?? 0, "service-reference", match[0]);

  for (const name of forbiddenNames.filter(Boolean)) {
    let index = text.toLowerCase().indexOf(name.toLowerCase());
    while (index >= 0) {
      add(index, "forbidden-name", name);
      index = text.toLowerCase().indexOf(name.toLowerCase(), index + name.length);
    }
  }
  return findings;
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export async function scanPublishableFiles(root = process.cwd()): Promise<SensitiveFinding[]> {
  const files = await filesIn(root);
  const forbiddenNames = (process.env.CODEX_SEO_FORBIDDEN_NAMES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const findings: SensitiveFinding[] = [];
  for (const file of files) {
    const relative = normalizeFile(path.relative(root, file));
    if (forbiddenFileNames.test(relative)) {
      findings.push({ file: relative, line: 1, rule: "sensitive-file-name", sample: "[redacted]" });
      continue;
    }
    if (ignoredBinaryExtensions.test(file)) continue;
    if (!await stat(file).then((entry) => entry.isFile()).catch(() => false)) continue;
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (text === undefined || text.includes("\0")) continue;
    findings.push(...scanSensitiveText(text, relative, forbiddenNames).filter((finding) => !allowedFindingKeys.has(relative + ":" + finding.rule)));
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const findings = await scanPublishableFiles();
  if (findings.length > 0) {
    for (const finding of findings) console.error(finding.file + ":" + finding.line + " [" + finding.rule + "] " + finding.sample);
    process.exitCode = 1;
  } else {
    console.log("sensitive content check ok");
  }
}