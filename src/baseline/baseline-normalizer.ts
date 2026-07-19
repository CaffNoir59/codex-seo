import crypto from "node:crypto";
import { normalizeUrl } from "../crawler/url-normalizer.js";
import type { SeoIssue } from "../core/issue.js";

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(normalizeText(value)).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

export function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["startedAt", "completedAt", "durationMs", "timings", "headers", "date", "server", "set-cookie"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortStable(item)]));
  }
  return value;
}

export function pageKey(finalUrl?: string, requestedUrl?: string): string {
  return normalizeUrl(finalUrl || requestedUrl || "");
}

export function stableIssueKey(issue: Pick<SeoIssue, "id" | "category" | "affectedUrl" | "evidence">): string {
  const url = issue.affectedUrl ? normalizeUrl(issue.affectedUrl) : "global";
  const evidence = issue.evidence ? stableHash(stableJson(issue.evidence)) : "no-evidence";
  return `${issue.id}|${issue.category}|${url}|${evidence}`;
}

export function safeText(value: string | undefined, privacyMode: boolean): string | undefined {
  if (privacyMode) return undefined;
  return value;
}
