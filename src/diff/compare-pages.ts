import type { BaselinePage } from "../baseline/baseline-schema.js";
import type { PageDiff } from "./diff-schema.js";
import { ignoreReasonForPage, type IgnoreOptions } from "./ignore-rules.js";

const COMPARED_FIELDS: Array<keyof BaselinePage> = ["statusCode", "indexable", "canonical", "titleHash", "metaDescriptionHash", "h1Hash", "depth", "incomingInternalLinks", "outgoingInternalLinks", "pageScore", "contentHash", "contentLength", "wordCount"];

function byKey(pages: BaselinePage[]): Map<string, BaselinePage> {
  return new Map(pages.map((page) => [page.key, page]));
}

function confidence(incomplete: boolean): "high" | "medium" | "low" {
  return incomplete ? "low" : "high";
}

function makeDiff(page: BaselinePage, type: string, confidenceValue: "high" | "medium" | "low", ignoreOptions: IgnoreOptions, changes = [] as PageDiff["changes"]): PageDiff {
  const ignoredBy = ignoreReasonForPage(page, ignoreOptions);
  return { key: page.key, url: page.url, previousUrl: type === "added" ? undefined : page.url, currentUrl: type === "removed" ? undefined : page.url, changeType: type, changes, confidence: confidenceValue, ignored: Boolean(ignoredBy), ignoredBy };
}

export function comparePages(previous: BaselinePage[], current: BaselinePage[], options: { ignore: IgnoreOptions; incomplete?: boolean }): { added: PageDiff[]; removed: PageDiff[]; changed: PageDiff[]; unchanged: PageDiff[] } {
  const prev = byKey(previous);
  const curr = byKey(current);
  const added: PageDiff[] = [];
  const removed: PageDiff[] = [];
  const changed: PageDiff[] = [];
  const unchanged: PageDiff[] = [];
  const conf = confidence(Boolean(options.incomplete));

  for (const page of current) if (!prev.has(page.key)) {
    const probableRedirect = previous.find((old) => old.requestedUrl === page.requestedUrl || old.finalUrl === page.requestedUrl);
    added.push(makeDiff(page, probableRedirect ? "moved-via-redirect" : "added", conf, options.ignore, probableRedirect ? [{ field: "url", previous: probableRedirect.url, current: page.url }] : []));
  }
  for (const page of previous) if (!curr.has(page.key)) removed.push(makeDiff(page, "removed", conf, options.ignore));

  for (const [key, before] of prev) {
    const after = curr.get(key);
    if (!after) continue;
    const changes = COMPARED_FIELDS.flatMap((field) => before[field] !== after[field] ? [{ field: String(field), previous: before[field], current: after[field] }] : []);
    if (changes.length === 0) unchanged.push(makeDiff(after, "unchanged", "high", options.ignore));
    else changed.push(makeDiff(after, "changed", conf, options.ignore, changes));
  }
  const sorter = (a: PageDiff, b: PageDiff) => a.key.localeCompare(b.key);
  return { added: added.sort(sorter), removed: removed.sort(sorter), changed: changed.sort(sorter), unchanged: unchanged.sort(sorter) };
}
