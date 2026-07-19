import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CURRENT_PRODUCT_VERSION = "1.1.0";

export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function readPackageJson(): { name: string; version: string; description?: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8"));
}

export function getVersion(): string { return readPackageJson().version; }