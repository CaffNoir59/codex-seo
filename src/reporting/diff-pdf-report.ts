import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function writeDiffPdf(htmlPath: string, pdfPath: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "networkidle" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" } });
    return pdfPath;
  } finally {
    await browser.close();
  }
}
