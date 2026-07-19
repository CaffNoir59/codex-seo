import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { startPerformanceFixtureServer } from "./performance-fixture-server.js";

const root = process.cwd();
const outRoot = path.join(root, "reports", "lighthouse-validation");
type RunResult = { code: number; stdout: string; stderr: string };
const q = (value: string) => `"${value.replace(/"/g, "\\\"")}"`;

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

async function metric(reportPath: string) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const p = report.performance?.[0];
  return { score: p?.lighthousePerformanceScore ?? p?.internalPerformanceScore ?? p?.scores?.performance, engine: p?.engine, scoreKind: p?.scoreKind, lcp: p?.metrics?.lcpMs, tbt: p?.metrics?.tbtMs, transfer: p?.resources?.transferBytes, requests: p?.resources?.requestCount, opportunities: p?.opportunities?.length ?? 0, version: p?.lighthouse?.lighthouseVersion, variance: p?.statistics?.coefficientOfVariation };
}

const fixture = await startPerformanceFixtureServer();
try {
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  const commands: Record<string, number> = {};
  async function audit(name: string, url: string, extra = "") {
    const output = path.join(outRoot, name);
    const result = await run(`npm run audit -- ${url} --performance --local-performance-engine lighthouse ${extra} -o ${q(output)}`);
    commands[name] = result.code;
    return await findFile(output, "report.json");
  }

  const fastReport = await audit("fast", fixture.fastUrl);
  const mediumReport = await audit("medium", fixture.mediumUrl);
  const slowReport = await audit("slow", fixture.slowUrl, "--performance-runs 3");
  const verySlowReport = await audit("very-slow", fixture.verySlowUrl, "--performance-runs 3");

  const playwrightOut = path.join(outRoot, "fast-playwright");
  commands.fastPlaywright = (await run(`npm run audit -- ${fixture.fastUrl} --performance --local-performance-engine playwright -o ${q(playwrightOut)}`)).code;
  const playwrightReport = await findFile(playwrightOut, "report.json");

  const fastDiffOut = path.join(outRoot, "fast-diff");
  const slowDiffOut = path.join(outRoot, "slow-diff");
  commands.fastDiffCrawl = (await run(`npm run audit -- ${fixture.fastUrl} --crawl --ignore-robots --performance --local-performance-engine lighthouse --performance-sample-pages 1 -o ${q(fastDiffOut)}`)).code;
  commands.slowDiffCrawl = (await run(`npm run audit -- ${fixture.slowUrl} --crawl --ignore-robots --performance --local-performance-engine lighthouse --performance-sample-pages 1 -o ${q(slowDiffOut)}`)).code;
  const fastDiffReport = await findFile(fastDiffOut, "sitewide-report.json");
  const slowDiffReport = await findFile(slowDiffOut, "sitewide-report.json");
  commands.diff = (await run(`npm run diff -- ${q(fastDiffReport)} ${q(slowDiffReport)} --html --pdf --output ${q(path.join(outRoot, "diff"))}`)).code;

  commands.gateOfficialPass = (await run(`npm run audit -- ${fixture.fastUrl} --performance --local-performance-engine lighthouse --require-official-lighthouse -o ${q(path.join(outRoot, "gate-official-pass"))}`)).code;
  commands.gateOfficialFail = (await run(`npm run audit -- ${fixture.fastUrl} --performance --local-performance-engine playwright --require-official-lighthouse -o ${q(path.join(outRoot, "gate-official-fail"))}`, [2])).code;
  commands.gateFieldMissing = (await run(`npm run audit -- ${fixture.fastUrl} --performance --local-performance-engine lighthouse --require-field-data -o ${q(path.join(outRoot, "gate-field-missing"))}`, [2])).code;
  commands.gateTransfer = (await run(`npm run audit -- ${fixture.slowUrl} --performance --local-performance-engine lighthouse --max-total-transfer-bytes 1000 -o ${q(path.join(outRoot, "gate-transfer"))}`, [2])).code;

  const variancePrevious = JSON.parse(await readFile(slowDiffReport, "utf8"));
  const varianceCurrent = JSON.parse(JSON.stringify(variancePrevious));
  varianceCurrent.performance = (varianceCurrent.performance ?? []).map((item: any) => ({ ...item, statistics: { ...(item.statistics ?? {}), coefficientOfVariation: 0.9 } }));
  const variancePrevFile = path.join(outRoot, "variance-prev.json");
  const varianceCurrFile = path.join(outRoot, "variance-curr.json");
  await writeFile(variancePrevFile, JSON.stringify(variancePrevious, null, 2), "utf8");
  await writeFile(varianceCurrFile, JSON.stringify(varianceCurrent, null, 2), "utf8");
  commands.gateVariance = (await run(`npm run diff -- ${q(variancePrevFile)} ${q(varianceCurrFile)} --max-performance-variance 0 --output ${q(path.join(outRoot, "gate-variance"))}`, [2])).code;

  const diffReport = JSON.parse(await readFile(path.join(outRoot, "diff", "diff-report.json"), "utf8"));
  console.log(JSON.stringify({
    fixture: { fastUrl: fixture.fastUrl, mediumUrl: fixture.mediumUrl, slowUrl: fixture.slowUrl, verySlowUrl: fixture.verySlowUrl },
    commands,
    metrics: { fast: await metric(fastReport), medium: await metric(mediumReport), slow: await metric(slowReport), verySlow: await metric(verySlowReport), playwright: await metric(playwrightReport) },
    diff: { performanceChanges: diffReport.performanceChanges?.length, gatePassed: diffReport.gate?.passed, files: await readdir(path.join(outRoot, "diff")) }
  }, null, 2));
} finally {
  await fixture.close();
}