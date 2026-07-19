import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readProjectFile, resolveProjectPath, isProtectedFile } from "../security/project-policy.js";
import { listSnapshots } from "./git.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", "reports", ".codex-seo"]);

export type SearchMatch = { path: string; line: number; text: string };
export type ControlledEdit = { path: string; find: string; replace: string; expectedOccurrences?: number };

async function walk(root: string, current = root, limit = 5_000): Promise<string[]> {
  if (limit <= 0) return [];
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (files.length >= limit) break;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(root, full, limit - files.length));
    } else if (entry.isFile() && !isProtectedFile(full)) {
      files.push(full);
    }
  }
  return files;
}

export async function searchProject(root: string, query: string, options: { maxMatches?: number; filePattern?: string } = {}): Promise<SearchMatch[]> {
  if (!query || query.length > 500) throw new Error("Search query must contain 1 to 500 characters");
  const maxMatches = Math.min(options.maxMatches ?? 100, 500);
  const pattern = options.filePattern ? new RegExp(options.filePattern) : undefined;
  const files = await walk(root);
  const matches: SearchMatch[] = [];
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    if (pattern && !pattern.test(relative)) continue;
    const metadata = await stat(file);
    if (metadata.size > 1_000_000) continue;
    const text = await readProjectFile(root, relative, 1_000_000).catch(() => undefined);
    if (text === undefined || text.includes("\0")) continue;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (line.includes(query)) matches.push({ path: relative, line: index + 1, text: line.slice(0, 500) });
      if (matches.length >= maxMatches) return matches;
    }
  }
  return matches;
}

export async function applyControlledEdits(root: string, edits: ControlledEdit[], options: { confirmed?: boolean; snapshotId?: string } = {}): Promise<{ files: string[]; replacements: number }> {
  if (!options.confirmed) throw new Error("Explicit confirmation is required before modifying project files");
  if (edits.length === 0 || edits.length > 50) throw new Error("Provide between 1 and 50 controlled edits");
  const snapshots = await listSnapshots(root);
  if (!options.snapshotId || !snapshots.some((snapshot) => snapshot.id === options.snapshotId)) throw new Error("A valid Git snapshot identifier is required before editing");
  const prepared: Array<{ file: string; content: string; replacements: number }> = [];
  for (const edit of edits) {
    if (!edit.find) throw new Error("Edit find text cannot be empty");
    const file = await resolveProjectPath(root, edit.path);
    const original = await readProjectFile(root, edit.path, 2_000_000);
    const occurrences = original.split(edit.find).length - 1;
    const expected = edit.expectedOccurrences ?? 1;
    if (occurrences !== expected) throw new Error("Expected " + expected + " occurrence(s) in " + edit.path + " but found " + occurrences);
    prepared.push({ file, content: original.split(edit.find).join(edit.replace), replacements: occurrences });
  }
  for (const item of prepared) await writeFile(item.file, item.content, "utf8");
  return {
    files: [...new Set(prepared.map((item) => path.relative(root, item.file).replace(/\\/g, "/")))],
    replacements: prepared.reduce((sum, item) => sum + item.replacements, 0)
  };
}
