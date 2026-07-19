const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid"
]);

export function normalizeUrl(rawUrl: string, base?: string | URL): string {
  const url = new URL(rawUrl, base);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  const sorted = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

export function sameNormalizedUrl(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

export function isSameAllowedDomain(candidate: string, root: string, includeSubdomains: boolean): boolean {
  const c = new URL(candidate).hostname.toLowerCase();
  const r = new URL(root).hostname.toLowerCase();
  return includeSubdomains ? c === r || c.endsWith(`.${r}`) : c === r;
}

export function urlPatternKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.pathname
    .replace(/\d{4}-\d{2}-\d{2}/g, ":date")
    .replace(/\d+/g, ":num")
    .replace(/[a-f0-9]{16,}/gi, ":hash");
}