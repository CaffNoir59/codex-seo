import { fetch, Headers } from "undici";
import { UrlSafetyError } from "./url-safety.js";
import { assertPolicyRedirectTarget, assertPolicyUrl, type NetworkAccessPolicy } from "./network-policy.js";
import { getVersion } from "../version.js";

export type FetchPageOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  allowPrivateNetwork?: boolean;
  networkPolicy?: NetworkAccessPolicy;
};

export type FetchPageResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  html: string;
  redirects: string[];
  durationMs: number;
};

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function fallbackPolicy(rawUrl: string, allowPrivateNetwork: boolean | undefined): NetworkAccessPolicy | undefined {
  if (!allowPrivateNetwork) return undefined;
  const origin = new URL(rawUrl).origin;
  return { allowPrivateNetwork: true, allowedOrigins: [origin], initialOrigin: origin };
}

export async function fetchPage(rawUrl: string, options: FetchPageOptions = {}): Promise<FetchPageResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxRedirects = options.maxRedirects ?? 5;
  const started = Date.now();
  const networkPolicy = options.networkPolicy ?? fallbackPolicy(rawUrl, options.allowPrivateNetwork);
  let current = (await assertPolicyUrl(rawUrl, networkPolicy)).url;
  const redirects: string[] = [];

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": `codex-seo/${getVersion()} (+https://example.com/codex-seo)`,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const status = response.status;
      const location = response.headers.get("location");
      if (location && status >= 300 && status < 400) {
        const next = await assertPolicyRedirectTarget(current, location, networkPolicy);
        redirects.push(next.toString());
        current = next;
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const html = contentType.includes("text") || contentType.includes("html") || contentType.includes("xml")
        ? await response.text()
        : "";
      return {
        requestedUrl: rawUrl,
        finalUrl: current.toString(),
        status,
        headers: headersToObject(response.headers),
        html,
        redirects,
        durationMs: Date.now() - started
      };
    } catch (error) {
      if (error instanceof UrlSafetyError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fetch failed for ${current.toString()}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new UrlSafetyError(`Too many redirects; limit is ${maxRedirects}`);
}
