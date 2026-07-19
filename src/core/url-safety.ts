import dns from "node:dns/promises";
import net from "node:net";

const FORBIDDEN_HOSTS = new Set(["localhost", "localhost."]);

export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlSafetyError";
  }
}

export type SafeUrl = {
  url: URL;
  resolvedAddresses: string[];
};

function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null;
  return nums;
}

export function isForbiddenIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const p = parseIPv4(address);
    if (!p) return true;
    const [a, b] = p;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

export function validateUrlSyntax(rawUrl: string, options: { allowPrivateNetwork?: boolean } = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlSafetyError(`Invalid URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new UrlSafetyError(`Blocked protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new UrlSafetyError("URLs with credentials are blocked");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host) {
    throw new UrlSafetyError(`Blocked host: ${parsed.hostname}`);
  }
  if (!options.allowPrivateNetwork && (FORBIDDEN_HOSTS.has(host) || host.endsWith(".localhost"))) {
    throw new UrlSafetyError(`Blocked host: ${parsed.hostname}`);
  }
  if (!options.allowPrivateNetwork && net.isIP(host) && isForbiddenIp(host)) {
    throw new UrlSafetyError(`Blocked private or local IP: ${host}`);
  }
  return parsed;
}

export async function assertSafeUrl(rawUrl: string): Promise<SafeUrl> {
  const url = validateUrlSyntax(rawUrl);
  const host = url.hostname;
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true, verbatim: true });
  const resolvedAddresses = addresses.map((entry) => entry.address);
  const forbidden = resolvedAddresses.find((address) => isForbiddenIp(address));
  if (forbidden) {
    throw new UrlSafetyError(`Host resolves to blocked IP: ${forbidden}`);
  }
  return { url, resolvedAddresses };
}

export async function assertSafeRedirectTarget(fromUrl: string | URL, location: string): Promise<URL> {
  const base = typeof fromUrl === "string" ? new URL(fromUrl) : fromUrl;
  const next = new URL(location, base);
  await assertSafeUrl(next.toString());
  return next;
}


