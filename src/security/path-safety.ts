import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export function hasWindowsForbiddenName(filePath: string): boolean {
  return filePath.split(/[\\/]/).some((part) => !/^[A-Za-z]:$/.test(part) && (/[<>:"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)));
}

export function isRootOrHome(target: string, home = process.env.HOME || process.env.USERPROFILE || ""): boolean {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  return resolved === root || (home ? resolved === path.resolve(home) : false);
}

export async function assertSafeWritePath(target: string, options: { allowWithin?: string; mustBeFile?: boolean } = {}): Promise<string> {
  if (!target.trim()) throw new Error("Output path is empty");
  if (hasWindowsForbiddenName(target)) throw new Error(`Unsafe output path: forbidden filename in ${target}`);
  const resolved = path.resolve(target);
  if (isRootOrHome(resolved)) throw new Error(`Unsafe output path: refusing to write to ${resolved}`);
  if (options.allowWithin) {
    const base = path.resolve(options.allowWithin);
    const rel = path.relative(base, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Unsafe output path outside ${base}`);
  }
  const stat = await lstat(resolved).catch(() => undefined);
  if (stat?.isSymbolicLink()) throw new Error(`Unsafe output path: symlink ${resolved}`);
  if (options.mustBeFile && stat?.isDirectory()) throw new Error(`Unsafe output path: ${resolved} is a directory`);
  await mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

export async function safeRealPath(target: string): Promise<string> { return await realpath(target).catch(() => path.resolve(target)); }