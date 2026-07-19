import { chromium } from "playwright";
import { assertPolicyUrl, validatePolicyUrlSyntax, type NetworkAccessPolicy } from "./network-policy.js";
import { getVersion } from "../version.js";

export type RenderPageOptions = {
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  networkPolicy?: NetworkAccessPolicy;
};

export type RenderPageResult = {
  finalUrl: string;
  status: number | null;
  html: string;
  text: string;
  durationMs: number;
  rendered: true;
};

export function shouldRenderWithBrowser(html: string): boolean {
  const trimmed = html.replace(/\s+/g, " ").trim();
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const rootShell = /<div[^>]+id=["'](?:root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html);
  return trimmed.length < 500 || rootShell || scriptCount >= 12;
}

function fallbackPolicy(rawUrl: string, allowPrivateNetwork: boolean | undefined): NetworkAccessPolicy | undefined {
  if (!allowPrivateNetwork) return undefined;
  const origin = new URL(rawUrl).origin;
  return { allowPrivateNetwork: true, allowedOrigins: [origin], initialOrigin: origin };
}

export async function renderPage(rawUrl: string, options: RenderPageOptions = {}): Promise<RenderPageResult> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const networkPolicy = options.networkPolicy ?? fallbackPolicy(rawUrl, options.allowPrivateNetwork);
  const safe = await assertPolicyUrl(rawUrl, networkPolicy);
  const started = Date.now();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: `codex-seo/${getVersion()} Playwright`,
      viewport: { width: 1366, height: 900 }
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      try {
        validatePolicyUrlSyntax(route.request().url(), networkPolicy);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const response = await page.goto(safe.url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
    const html = await page.content();
    const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
    return {
      finalUrl: page.url(),
      status: response?.status() ?? null,
      html,
      text,
      durationMs: Date.now() - started,
      rendered: true
    };
  } finally {
    await browser.close();
  }
}
