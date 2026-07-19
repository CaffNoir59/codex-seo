import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const protectedBasenames = [
  /^\.env(?:\..+)?$/i,
  /^(?:id_rsa|id_ed25519)$/i,
  /^credentials\.json$/i,
  /(?:secret|token|credential|password)/i,
  /\.(?:pem|key)$/i
];

export function isProtectedFile(file: string): boolean {
  const name = path.basename(file);
  return protectedBasenames.some((pattern) => pattern.test(name)) && name !== ".env.example";
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveProjectPath(rootInput: string, requested: string, options: { allowMissing?: boolean; allowProtected?: boolean } = {}): Promise<string> {
  const root = await realpath(path.resolve(rootInput));
  const lexical = path.resolve(root, requested);
  if (!inside(root, lexical)) throw new Error("Path is outside the configured project root");
  if (!options.allowProtected && isProtectedFile(lexical)) throw new Error("Protected file content is not available");
  const existing = await stat(lexical).then(() => true).catch(() => false);
  if (!existing && !options.allowMissing) throw new Error("Path does not exist");
  const resolved = existing ? await realpath(lexical) : lexical;
  if (!inside(root, resolved)) throw new Error("Resolved path leaves the configured project root");
  let current = existing ? resolved : path.dirname(resolved);
  while (inside(root, current) && current !== root) {
    const metadata = await lstat(current).catch(() => undefined);
    if (metadata?.isSymbolicLink()) {
      const actual = await realpath(current);
      if (!inside(root, actual)) throw new Error("Symlink leaves the configured project root");
    }
    current = path.dirname(current);
  }
  return resolved;
}

export async function readProjectFile(root: string, requested: string, maxBytes = 1_000_000): Promise<string> {
  const file = await resolveProjectPath(root, requested);
  const metadata = await stat(file);
  if (!metadata.isFile()) throw new Error("Requested path is not a file");
  if (metadata.size > maxBytes) throw new Error("File exceeds read limit of " + maxBytes + " bytes");
  return await readFile(file, "utf8");
}

export const protectedFilePatterns = protectedBasenames.map((pattern) => pattern.source);
