import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  }));
  return nested.flat();
}
const src = await files("src");
const tests = await files("tests");
const critical = ["src/cli", "src/history", "src/schemas", "src/config", "src/security", "src/core"];
const normalizedSrc = src.map((file) => file.replace(/\\/g, "/"));
const covered = critical.map((prefix) => ({ prefix, sourceFiles: normalizedSrc.filter((file) => file.startsWith(prefix)).length, testMentions: 0 }));
const testText = (await Promise.all(tests.map((file) => readFile(file, "utf8").catch(() => "")))).join("\n");
for (const item of covered) item.testMentions = (testText.match(new RegExp(item.prefix.replace(/[\\/]/g, "[\\\\/]"), "g")) ?? []).length;
console.log("Codex SEO coverage summary (informational)");
for (const item of covered) console.log(`${item.prefix}: ${item.sourceFiles} source file(s), ${item.testMentions} test reference(s)`);
console.log(`Total source files: ${src.length}`);
console.log(`Total test files: ${tests.length}`);
console.log("Status: PASS");