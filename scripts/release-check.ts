import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readPackageJson } from "../src/version.js";

const checks: { name: string; ok: boolean; detail?: string }[] = [];
async function exists(file: string) { return await stat(file).then(() => true).catch(() => false); }
function add(name: string, ok: boolean, detail?: string) { checks.push({ name, ok, detail }); }
const pkg = readPackageJson();
add("version", pkg.version === "1.1.0", String(pkg.version));
add("license", Boolean(pkg.license), String(pkg.license ?? "missing"));
add("README", await exists("README.md"));
add("CHANGELOG", await exists("CHANGELOG.md"));
add("SECURITY", await exists("SECURITY.md"));
add("bin", Boolean((pkg.bin as Record<string, string> | undefined)?.["codex-seo"]));
add("types", await exists("dist/src/index.d.ts"));
add("schemas", await exists("src/schemas/schema-registry.ts") && await exists("src/schemas/schema-migrations.ts"));
add("migrations", await exists("src/schemas/schema-migrations.ts"));
const pack = process.platform === "win32"
  ? spawnSync("npm pack --dry-run --json", { encoding: "utf8", shell: true })
  : spawnSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const packStdout = typeof pack.stdout === "string" ? pack.stdout : "";
const packStderr = typeof pack.stderr === "string" ? pack.stderr : "";
let packFiles: string[] = [];
let packDetail = packStderr.split(/\r?\n/).find((line) => line.includes("package size"));
try {
  const json = packStdout.match(/(\[\s*\{\s*"id"[\s\S]*\]\s*)$/)?.[1] ?? packStdout;
  const parsed = JSON.parse(json) as Array<{ filename?: string; size?: number; unpackedSize?: number; files?: Array<{ path: string }> }>;
  const entry = parsed[0];
  packFiles = entry?.files?.map((file) => file.path) ?? [];
  packDetail = entry ? `${entry.filename ?? "package"}, ${entry.files?.length ?? 0} files, ${entry.size ?? 0} bytes` : packDetail;
} catch {
  packFiles = packStdout.split(/\r?\n/).filter(Boolean);
}
add("npm pack", pack.status === 0, packDetail);
const sensitive = packFiles.some((file) => /(^|\/)(node_modules|reports|\.codex-seo|\.env|credentials|secrets|tokens|cache)(\/|$)/i.test(file) || /private_key/i.test(file));
add("sensitive files excluded", !sensitive, `${packFiles.length} packaged files`);
const git = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
add("working tree accessible", git.status === 0 || /not a git repository/i.test(git.stderr), git.status === 0 ? (git.stdout.trim() ? "dirty" : "clean") : "not a git repository");
for (const file of ["package-lock.json", "docs/cli-reference.md", "docs/schemas-and-migrations.md"]) add(file, await exists(file));
const ok = checks.every((check) => check.ok);
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
console.log(`Status: ${ok ? "READY" : "BLOCKED"}`);
process.exit(ok ? 0 : 1);