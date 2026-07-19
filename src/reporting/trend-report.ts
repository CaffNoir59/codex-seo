import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { TrendReport } from "../trends/trend-schema.js";
import { renderTrendHtml } from "./trend-html.js";

export async function writeTrendReport(report: TrendReport, outputDir: string, pdf = false): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "trend-report.json");
  const htmlPath = path.join(outputDir, "trend-report.html");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(htmlPath, renderTrendHtml(report), "utf8");
  const files = [jsonPath, htmlPath];
  if (pdf) {
    const pdfPath = path.join(outputDir, "trend-report.pdf");
    const browser = await chromium.launch({ headless: true });
    try { const page = await browser.newPage(); await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "networkidle" }); await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" } }); files.push(pdfPath); }
    finally { await browser.close(); }
  }
  return files;
}