import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { startPerformanceFixtureServer } from "./performance-fixture-server.js";

const root = process.cwd();
const outRoot = path.join(root, "reports", "performance-validation");

type RunResult = { code: number; stdout: string; stderr: string };

function q(value: string): string {
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function run(commandLine: string, expectedCodes = [0]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, { cwd: root, shell: true, env: { ...process.env, NODE_ENV: "test", CODEX_SEO_TEST_ALLOW_PRIVATE_NETWORK: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      const actual = code ?? 1;
      if (!expectedCodes.includes(actual)) reject(new Error(`${commandLine} exited ${actual}\n${stdout}\n${stderr}`));
      else resolve({ code: actual, stdout, stderr });
    });
  });
}

async function findFile(dir: string, name: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      try { return await findFile(full, name); } catch {}
    }
  }
  throw new Error(`${name} not found under ${dir}`);
}

const fixture = await startPerformanceFixtureServer();
try {
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  const light = await run(`npm run audit -- ${fixture.lightUrl} --performance --performance-mode local -o ${q(path.join(outRoot, "light"))}`);
  const heavy = await run(`npm run audit -- ${fixture.heavyUrl} --performance --performance-mode local --performance-runs 3 -o ${q(path.join(outRoot, "heavy"))}`);
  const site = await run(`npm run audit -- ${fixture.siteUrl} --crawl --ignore-robots --performance --performance-mode local --performance-sample-pages 5 -o ${q(path.join(outRoot, "site"))}`);
  const siteReport = await findFile(path.join(outRoot, "site"), "sitewide-report.json");
  const previous = JSON.parse(await readFile(siteReport, "utf8"));
  const current = JSON.parse(JSON.stringify(previous));
  current.performance = (current.performance ?? []).map((item: any) => ({ ...item, scores: { ...(item.scores ?? {}), performance: 40 }, metrics: { ...(item.metrics ?? {}), lcpMs: 5200, cls: 0.35, tbtMs: 900, ttfbMs: 1800 }, resources: { ...(item.resources ?? {}), transferBytes: 4000000, requestCount: 140 } }));
  const prevFile = path.join(outRoot, "performance-v1.json");
  const currFile = path.join(outRoot, "performance-v2.json");
  await writeFile(prevFile, JSON.stringify(previous, null, 2), "utf8");
  await writeFile(currFile, JSON.stringify(current, null, 2), "utf8");
  const diffPass = await run(`npm run diff -- ${q(prevFile)} ${q(currFile)} --html --pdf --output ${q(path.join(outRoot, "diff-pass"))} --max-performance-score-drop 80 --max-lcp 10000 --max-cls 1`);
  const diffFail = await run(`npm run diff -- ${q(prevFile)} ${q(currFile)} --output ${q(path.join(outRoot, "diff-fail"))} --max-performance-score-drop 1`, [2]);
  console.log(JSON.stringify({ fixture: { lightUrl: fixture.lightUrl, heavyUrl: fixture.heavyUrl, siteUrl: fixture.siteUrl }, commands: { light: light.code, heavy: heavy.code, site: site.code, diffPass: diffPass.code, diffFail: diffFail.code }, files: { siteReport, prevFile, currFile } }, null, 2));
} finally {
  await fixture.close();
}