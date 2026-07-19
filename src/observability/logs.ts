import { appendFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { redactObject } from "../core/redaction.js";
import { resolveProjectPath } from "../security/project-policy.js";

export type LogCategory = "workflow" | "audit" | "git" | "preview" | "deployment" | "rollback" | "security" | "mcp";
export type StructuredLogEntry = {
  at: string;
  category: LogCategory;
  event: string;
  success?: boolean;
  workflowId?: string;
  releaseId?: string;
  details?: Record<string, unknown>;
};

export class LocalLogStore {
  constructor(
    private readonly projectRoot: string,
    private readonly options: { maxBytes?: number; maxFiles?: number } = {}
  ) {}

  private async directory(): Promise<string> {
    const directory = await resolveProjectPath(this.projectRoot, ".codex-seo/logs", { allowMissing: true, allowProtected: true });
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private async rotate(file: string): Promise<void> {
    const maxBytes = this.options.maxBytes ?? 1_000_000;
    const current = await stat(file).catch(() => undefined);
    if (!current || current.size < maxBytes) return;
    const maxFiles = this.options.maxFiles ?? 5;
    await rm(file + "." + maxFiles, { force: true });
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = file + "." + index;
      if (await stat(source).then(() => true).catch(() => false)) await rename(source, file + "." + (index + 1));
    }
    await rename(file, file + ".1");
  }

  async write(entry: Omit<StructuredLogEntry, "at"> & { at?: string }): Promise<void> {
    const directory = await this.directory();
    const file = path.join(directory, entry.category + ".jsonl");
    await this.rotate(file);
    const sanitized = redactObject({ ...entry, at: entry.at ?? new Date().toISOString() }, { privacyMode: true });
    await appendFile(file, JSON.stringify(sanitized) + "\n", "utf8");
  }

  async list(options: { category?: LogCategory; limit?: number } = {}): Promise<Array<{ file: string; size: number; modifiedAt: string; entries: unknown[] }>> {
    const directory = await this.directory();
    const files = (await readdir(directory)).filter((name) => name.endsWith(".jsonl") || /\.jsonl\.\d+$/.test(name))
      .filter((name) => !options.category || name.startsWith(options.category + ".jsonl"));
    const records = await Promise.all(files.map(async (name) => {
      const file = path.join(directory, name);
      const metadata = await stat(file);
      const lines = (await readFile(file, "utf8")).trim().split(/\r?\n/).filter(Boolean).slice(-(options.limit ?? 100));
      return {
        file: ".codex-seo/logs/" + name,
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        entries: lines.map((line) => {
          try { return JSON.parse(line) as unknown; } catch { return { malformed: true }; }
        })
      };
    }));
    return records.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }
}
