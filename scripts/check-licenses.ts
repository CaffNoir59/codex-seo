import { readFile } from "node:fs/promises";
import path from "node:path";

type PackageLock = {
  packages?: Record<string, LockPackage>;
};

type LockPackage = {
  name?: string;
  version?: string;
  license?: string;
  licenses?: Array<{ type?: string }>;
  dev?: boolean;
  optional?: boolean;
};

type Manifest = {
  name?: string;
  license?: string;
  licenses?: Array<{ type?: string }>;
};

const allowedLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "MPL-2.0",
]);

const disallowedPattern = /\b(?:GPL|LGPL|AGPL|SSPL|UNLICENSED|PROPRIETARY|COMMERCIAL|NON[-\s]?COMMERCIAL|CC-BY-NC|NOASSERTION|UNKNOWN)\b/i;

const normalizedByPackage = new Map<string, Record<string, string>>([
  ["parse-cache-control", { BSD: "BSD-3-Clause" }],
]);

function packageNameFromPath(packagePath: string, entry: LockPackage): string {
  if (entry.name) return entry.name;
  const parts = packagePath.replace(/\\/g, "/").split("/");
  const lastNodeModules = parts.lastIndexOf("node_modules");
  const first = parts[lastNodeModules + 1] ?? packagePath;
  if (first.startsWith("@")) return `${first}/${parts[lastNodeModules + 2] ?? ""}`;
  return first;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function licenseFrom(value: LockPackage | Manifest | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value.license === "string" && value.license.trim()) return value.license.trim();
  const legacy = value.licenses?.map((item) => item.type).filter((item): item is string => Boolean(item?.trim()));
  if (legacy?.length) return legacy.join(" OR ");
  return undefined;
}

function normalizeLicense(packageName: string, license: string): string {
  const value = license.trim().replace(/^\((.*)\)$/u, "$1").trim();
  return normalizedByPackage.get(packageName)?.[value] ?? value;
}

function licenseTokens(expression: string): string[] {
  return expression
    .replace(/[()]/gu, " ")
    .split(/\s+(?:AND|OR|WITH)\s+|\s+/iu)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(?:AND|OR|WITH)$/iu.test(item));
}

function isAllowed(packageName: string, expression: string): boolean {
  if (disallowedPattern.test(expression)) return false;
  const normalized = normalizeLicense(packageName, expression);
  const tokens = licenseTokens(normalized);
  return tokens.length > 0 && tokens.every((token) => allowedLicenses.has(normalizeLicense(packageName, token)));
}

async function licenseFor(root: string, packagePath: string, packageName: string, entry: LockPackage): Promise<string | undefined> {
  const fromLock = licenseFrom(entry);
  if (fromLock) return fromLock;
  const manifest = await readJson<Manifest>(path.join(root, packagePath, "package.json"));
  return licenseFrom(manifest);
}

const root = process.cwd();
const lock = await readJson<PackageLock>(path.join(root, "package-lock.json"));

if (!lock?.packages) {
  console.error("package-lock.json is missing or does not contain package metadata.");
  process.exit(1);
}

const failures: string[] = [];
let checked = 0;

for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (!packagePath.startsWith("node_modules/")) continue;
  checked += 1;
  const packageName = packageNameFromPath(packagePath, entry);
  const license = await licenseFor(root, packagePath, packageName, entry);
  if (!license) {
    failures.push(`${packageName}@${entry.version ?? "unknown"}: missing license metadata`);
    continue;
  }
  if (!isAllowed(packageName, license)) {
    failures.push(`${packageName}@${entry.version ?? "unknown"}: disallowed license "${license}"`);
  }
}

if (failures.length > 0) {
  console.error("license check failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`license check ok (${checked} dependencies, ${[...allowedLicenses].join(", ")})`);
