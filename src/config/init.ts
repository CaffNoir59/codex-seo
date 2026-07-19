import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "./config-schema.js";
import { assertSafeWritePath } from "../security/path-safety.js";
import { initializeProject, type ProjectInitOptions } from "../project/init.js";

export type InitOptions = ProjectInitOptions & { ci?: "github" };
export type InitResult = { created: string[]; updated: string[]; skipped: string[]; dryRun: boolean };

function githubWorkflow(environment: string): string {
  return `name: Codex SEO\n\non:\n  workflow_dispatch:\n  schedule:\n    - cron: "0 5 * * 1"\n\njobs:\n  audit:\n    runs-on: \${{ matrix.os }}\n    strategy:\n      fail-fast: false\n      matrix:\n        os: [ubuntu-latest, windows-latest, macos-latest]\n        node: [20, 22, 24]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.node }}\n          cache: npm\n      - run: npm ci\n      - run: npx playwright install chromium\n        if: \${{ vars.CODEX_SEO_PERFORMANCE == 'true' }}\n      - run: npm run build\n      - run: node dist/cli/index.js doctor --json\n      - run: node dist/cli/index.js audit \${{ vars.CODEX_SEO_URL }} --crawl --environment ${environment} --save-history\n      - run: node dist/cli/index.js history export-ci --format github\n        if: always()\n      - uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: codex-seo-reports-\${{ matrix.os }}-node\${{ matrix.node }}\n          path: reports/**\n      - uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: codex-seo-junit-\${{ matrix.os }}-node\${{ matrix.node }}\n          path: .codex-seo/history/trends/*.xml\n`;
}

async function writeNew(file: string, content: string, result: InitResult, options: InitOptions): Promise<void> {
  const exists = await stat(file).then(() => true).catch(() => false);
  if (exists && !options.force) { result.skipped.push(path.relative(options.cwd ?? process.cwd(), file)); return; }
  if (!options.dryRun) { await assertSafeWritePath(file, { mustBeFile: true }); await writeFile(file, content, "utf8"); }
  result.created.push(path.relative(options.cwd ?? process.cwd(), file));
}

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const initialized = await initializeProject({ ...options, cwd });
  const result: InitResult = {
    created: [...initialized.created],
    updated: [...initialized.updated],
    skipped: [...initialized.skipped],
    dryRun: initialized.dryRun
  };
  if (options.force && result.updated.includes("codex-seo.config.json") && !result.created.includes("codex-seo.config.json")) result.created.push("codex-seo.config.json");
  if (options.ci === "github" || options.full) await writeNew(path.join(cwd, ".github/workflows/codex-seo.yml"), githubWorkflow(options.environment ?? "production"), result, { ...options, cwd });
  return result;
}

export function formatInitResult(result: InitResult): string {
  return ["Codex SEO initialized", "", result.created.length ? "Created:" : "", ...result.created.map((item) => `- ${item}`), result.updated.length ? "" : "", result.updated.length ? "Updated:" : "", ...result.updated.map((item) => `- ${item}`), result.skipped.length ? "" : "", result.skipped.length ? "Skipped:" : "", ...result.skipped.map((item) => `- ${item}`)].filter(Boolean).join("\n");
}