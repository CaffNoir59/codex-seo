import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "tests", "scripts", "skills"];
const forbidden = ["TO" + "DO", "Claude " + "Code", "~/" + ".claude"];

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return [full];
  }));
  return found.flat();
}

const allFiles = (await Promise.all(roots.map(async (root) => {
  try {
    const s = await stat(root);
    return s.isDirectory() ? files(root) : [];
  } catch {
    return [];
  }
}))).flat().filter((file) => /\.(ts|md)$/.test(file));

const errors: string[] = [];
for (const file of allFiles) {
  const text = await readFile(file, "utf8");
  for (const token of forbidden) {
    if (text.includes(token)) errors.push(`${file}: forbidden token ${token}`);
  }
  if (/\s+$ /m.test(text)) errors.push(`${file}: suspicious trailing whitespace`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`lint ok (${allFiles.length} files)`);
