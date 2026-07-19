import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportSchema, type SeoReport } from "../schemas/report-schema.js";

export async function writeJsonReport(report: SeoReport, outputDir: string): Promise<string> {
  const parsed = reportSchema.parse(report);
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "report.json");
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
}
