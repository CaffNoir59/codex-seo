import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SeoDiffReport } from "../diff/diff-schema.js";
import { renderDiffHtml } from "./diff-html-report.js";
import { writeDiffPdf } from "./diff-pdf-report.js";

export async function writeDiffReport(report: SeoDiffReport, outputDir: string, options: { html?: boolean; pdf?: boolean } = {}): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "diff-report.json");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const files = [jsonPath];
  if (options.html || options.pdf) {
    const htmlPath = path.join(outputDir, "diff-report.html");
    await writeFile(htmlPath, renderDiffHtml(report), "utf8");
    files.push(htmlPath);
    if (options.pdf) files.push(await writeDiffPdf(htmlPath, path.join(outputDir, "diff-report.pdf")));
  }
  return files;
}
