import type { FetchPageResult } from "./fetch-page.js";
import type { NetworkAccessPolicy } from "./network-policy.js";
import type { PageIntent, ParsedHtml } from "./parse-html.js";

export type AuditContext = {
  requestedUrl: string;
  finalUrl: string;
  domain: string;
  startedAt: string;
  fetch: FetchPageResult;
  html: string;
  rendered: boolean;
  parsed: ParsedHtml;
  networkPolicy?: NetworkAccessPolicy;
  pageIntent?: PageIntent;
};

