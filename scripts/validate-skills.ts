import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const skillRoot = "skills";
const namePattern = /^[a-z0-9-]+$/;
const errors: string[] = [];

async function skillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skillFiles(full);
    return entry.name === "SKILL.md" ? [full] : [];
  }));
  return found.flat();
}

for (const file of await skillFiles(skillRoot)) {
  const text = await readFile(file, "utf8");
  const match = text.match(/^---\n([\s\S]+?)\n---\n/);
  if (!match) {
    errors.push(`${file}: missing YAML frontmatter`);
    continue;
  }
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !namePattern.test(name)) errors.push(`${file}: invalid name`);
  if (!description || description.length < 40) errors.push(`${file}: description is too short`);
  for (const section of ["Inputs", "Analysis Steps", "Output Format", "Known Limits", "Project Commands"]) {
    if (!text.includes(`## ${section}`)) errors.push(`${file}: missing section ${section}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("skills ok");
