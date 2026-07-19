import type { ParsedHtml } from "../core/parse-html.js";
import { isSameAllowedDomain, normalizeUrl } from "./url-normalizer.js";

export type ExtractedLinks = {
  internal: string[];
  external: string[];
  emptyAnchors: string[];
  genericAnchors: string[];
};

const GENERIC_ANCHOR = /^(click here|read more|learn more|more|here|link)$/i;

export function extractLinks(parsed: ParsedHtml, rootUrl: string, includeSubdomains: boolean): ExtractedLinks {
  const internal = new Set<string>();
  const external = new Set<string>();
  const emptyAnchors: string[] = [];
  const genericAnchors: string[] = [];
  for (const link of parsed.links) {
    try {
      const normalized = normalizeUrl(link.href, parsed.url);
      if (isSameAllowedDomain(normalized, rootUrl, includeSubdomains)) internal.add(normalized);
      else external.add(normalized);
      if (!link.accessible) emptyAnchors.push(normalized);
      if (GENERIC_ANCHOR.test(link.text.trim())) genericAnchors.push(normalized);
    } catch {
      // Ignore malformed extracted links. The filter layer records invalid discovered URLs separately.
    }
  }
  return {
    internal: [...internal].sort(),
    external: [...external].sort(),
    emptyAnchors: [...new Set(emptyAnchors)].sort(),
    genericAnchors: [...new Set(genericAnchors)].sort()
  };
}