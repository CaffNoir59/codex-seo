import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seoBaselineSchema, type SeoBaseline } from "./baseline-schema.js";

export class BaselineStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineStorageError";
  }
}

export function safeBaselineName(name: string | true | undefined): string {
  const value = name === true || name === undefined ? "default" : String(name).trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(value) || value.includes("..")) throw new BaselineStorageError(`Invalid baseline name: ${value}`);
  return value;
}

export function safeSiteName(startUrl: string): string {
  const host = new URL(startUrl).hostname.toLowerCase().replace(/^www\./, "");
  return host.replace(/[^a-z0-9.-]/g, "-").replace(/\.+/g, ".").replace(/^-|-$/g, "") || "site";
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new BaselineStorageError("Resolved baseline path escapes baseline directory");
}

export function baselinePath(baselineDir: string, startUrl: string, name: string): string {
  const root = path.resolve(baselineDir);
  const file = path.join(root, safeSiteName(startUrl), `${safeBaselineName(name)}.json`);
  assertInside(root, file);
  return file;
}

export async function saveBaseline(baseline: SeoBaseline, options: { baselineDir?: string; overwrite?: boolean } = {}): Promise<string> {
  const dir = options.baselineDir ?? ".codex-seo/baselines";
  const file = baselinePath(dir, baseline.baseline.startUrl, baseline.baseline.name);
  await mkdir(path.dirname(file), { recursive: true });
  if (!options.overwrite) {
    try {
      await readFile(file, "utf8");
      throw new BaselineStorageError(`Baseline already exists: ${file}`);
    } catch (error) {
      if (error instanceof BaselineStorageError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await writeFile(file, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  await writeFile(path.join(path.dirname(file), "metadata.json"), `${JSON.stringify({ updatedAt: new Date().toISOString(), baselinesDir: path.dirname(file) }, null, 2)}\n`, "utf8");
  return file;
}

export async function loadBaselineByName(baselineDir: string | undefined, startUrl: string, name: string): Promise<{ baseline: SeoBaseline; path: string }> {
  const dir = baselineDir ?? ".codex-seo/baselines";
  const file = baselinePath(dir, startUrl, name);
  try {
    const baseline = seoBaselineSchema.parse(JSON.parse(await readFile(file, "utf8")));
    return { baseline, path: file };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new BaselineStorageError(`Baseline not found: ${file}`);
    throw error;
  }
}

export async function loadBaselineFile(file: string): Promise<SeoBaseline> {
  return seoBaselineSchema.parse(JSON.parse(await readFile(file, "utf8")));
}
