import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type GscCacheOptions = { root?: string; ttlSeconds?: number; enabled?: boolean };

export function gscCacheKey(input: unknown): string {
  const stable = JSON.stringify(input, Object.keys(input as Record<string, unknown>).sort());
  return createHash("sha256").update(stable).digest("hex");
}

export class GscCache {
  readonly root: string;
  readonly ttlSeconds: number;
  readonly enabled: boolean;
  constructor(options: GscCacheOptions = {}) {
    this.root = options.root ?? ".codex-seo/gsc-cache";
    this.ttlSeconds = options.ttlSeconds ?? 0;
    this.enabled = Boolean(options.enabled && this.ttlSeconds > 0);
  }
  file(key: string): string { return path.join(this.root, `${key}.json`); }
  async get<T>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    const file = this.file(key);
    try {
      const meta = await stat(file);
      if ((Date.now() - meta.mtimeMs) / 1000 > this.ttlSeconds) return undefined;
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch { return undefined; }
  }
  async set<T>(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(key), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  async invalidate(): Promise<void> { await rm(this.root, { recursive: true, force: true }); }
}