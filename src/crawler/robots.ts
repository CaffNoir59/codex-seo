import { fetchPage } from "../core/fetch-page.js";
import type { NetworkAccessPolicy } from "../core/network-policy.js";

export type RobotsRules = {
  origin: string;
  sitemaps: string[];
  crawlDelayMs: number;
  errors: string[];
  isAllowed(url: string): boolean;
};

type Rule = { type: "allow" | "disallow"; path: string };
const cache = new Map<string, RobotsRules>();

function pathMatches(pathname: string, rulePath: string): boolean {
  if (!rulePath) return false;
  const escaped = rulePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}`).test(pathname);
}

function parseRobots(text: string, origin: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: Rule[]; crawlDelayMs: number }> = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: Rule[]; crawlDelayMs: number } | null = null;
  const errors: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [fieldRaw, ...rest] = line.split(":");
    const field = fieldRaw?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!field) continue;
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [], crawlDelayMs: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!current) {
        errors.push("rule-before-user-agent");
        continue;
      }
      current.rules.push({ type: field, path: value });
    } else if (field === "crawl-delay") {
      if (current) current.crawlDelayMs = Math.max(0, Number(value) * 1000 || 0);
    } else if (field === "sitemap") {
      try {
        sitemaps.push(new URL(value, origin).toString());
      } catch {
        errors.push(`invalid-sitemap:${value}`);
      }
    }
  }

  const selected = groups.find((group) => group.agents.includes("codexseo")) ?? groups.find((group) => group.agents.includes("*"));
  const rules = selected?.rules ?? [];
  const crawlDelayMs = selected?.crawlDelayMs ?? 0;
  return {
    origin,
    sitemaps: [...new Set(sitemaps)].sort(),
    crawlDelayMs,
    errors,
    isAllowed(url: string): boolean {
      const pathname = new URL(url).pathname || "/";
      const matches = rules
        .filter((rule) => pathMatches(pathname, rule.path))
        .sort((a, b) => b.path.length - a.path.length || (a.type === "allow" ? -1 : 1));
      const winner = matches[0];
      return !winner || winner.type === "allow";
    }
  };
}

export async function getRobotsRules(rawUrl: string, allowPrivateNetworkOrPolicy: boolean | NetworkAccessPolicy = false): Promise<RobotsRules> {
  const origin = new URL(rawUrl).origin;
  const networkPolicy = typeof allowPrivateNetworkOrPolicy === "object" ? allowPrivateNetworkOrPolicy : undefined;
  const allowPrivateNetwork = typeof allowPrivateNetworkOrPolicy === "boolean" ? allowPrivateNetworkOrPolicy : allowPrivateNetworkOrPolicy.allowPrivateNetwork;
  const cacheKey = `${origin}:${allowPrivateNetwork ? "private" : "public"}:${networkPolicy?.initialOrigin ?? origin}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  try {
    const result = await fetchPage(new URL("/robots.txt", origin).toString(), { timeoutMs: 8000, maxRedirects: 3, allowPrivateNetwork, networkPolicy });
    const rules = result.status >= 400
      ? { origin, sitemaps: [], crawlDelayMs: 0, errors: [`robots-status-${result.status}`], isAllowed: () => true }
      : parseRobots(result.html, origin);
    cache.set(cacheKey, rules);
    return rules;
  } catch (error) {
    const rules = { origin, sitemaps: [], crawlDelayMs: 0, errors: [error instanceof Error ? error.message : String(error)], isAllowed: () => true };
    cache.set(cacheKey, rules);
    return rules;
  }
}

export function clearRobotsCache(): void {
  cache.clear();
}
