import { describe, expect, it } from "vitest";
import { compareIssues } from "../../src/diff/compare-issues.js";
import { comparePages } from "../../src/diff/compare-pages.js";
import type { BaselineIssue, BaselinePage } from "../../src/baseline/baseline-schema.js";
import { emptyIgnoreOptions } from "../../src/diff/ignore-rules.js";

function page(key: string, extra: Partial<BaselinePage> = {}): BaselinePage { return { key, url: key, finalUrl: key, requestedUrl: key, statusCode: 200, indexable: true, followable: true, canonical: key, title: "T", metaDescription: "M", h1: "H", titleHash: "t", metaDescriptionHash: "m", h1Hash: "h", contentHash: "c", contentSignature: ["a"], contentLength: 10, wordCount: 2, depth: 1, incomingInternalLinks: 1, outgoingInternalLinks: 1, pageScore: 100, fromSitemap: true, ...extra }; }
function issue(key: string, extra: Partial<BaselineIssue> = {}): BaselineIssue { return { key, ruleId: "technical.title-length", category: "technical", severity: "high", affectedUrl: "https://example.com/a", title: "Issue", titleHash: "t", evidenceHash: "e", recommendationHash: "r", ...extra }; }
const ignore = emptyIgnoreOptions();

describe("compare pages", () => {
  it("detects added pages", () => { expect(comparePages([], [page("https://example.com/a")], { ignore }).added).toHaveLength(1); });
  it("detects removed pages", () => { expect(comparePages([page("https://example.com/a")], [], { ignore }).removed).toHaveLength(1); });
  it("detects unchanged pages", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a")], { ignore }).unchanged).toHaveLength(1); });
  it("detects status changes", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a", { statusCode: 404 })], { ignore }).changed[0].changes.some((c) => c.field === "statusCode")).toBe(true); });
  it("detects canonical changes", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a", { canonical: "https://example.com/b" })], { ignore }).changed[0].changes.some((c) => c.field === "canonical")).toBe(true); });
  it("detects indexability changes", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a", { indexable: false })], { ignore }).changed[0].changes.some((c) => c.field === "indexable")).toBe(true); });
  it("detects depth changes", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a", { depth: 4 })], { ignore }).changed[0].changes.some((c) => c.field === "depth")).toBe(true); });
  it("detects title and H1 changes through hashes", () => { const diff = comparePages([page("https://example.com/a")], [page("https://example.com/a", { titleHash: "new", h1Hash: "newh" })], { ignore }); expect(diff.changed[0].changes.map((c) => c.field)).toEqual(expect.arrayContaining(["titleHash", "h1Hash"])); });
  it("detects content changes", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a", { contentHash: "new" })], { ignore }).changed[0].changes.some((c) => c.field === "contentHash")).toBe(true); });
  it("treats normalized equivalent URLs as same key when pre-normalized", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a")], { ignore }).added).toHaveLength(0); });
  it("detects probable redirect moves", () => { const diff = comparePages([page("https://example.com/old", { requestedUrl: "https://example.com/old" })], [page("https://example.com/new", { requestedUrl: "https://example.com/old" })], { ignore }); expect(diff.added[0].changeType).toBe("moved-via-redirect"); });
  it("is deterministic when input order differs", () => { const a = comparePages([page("https://example.com/b"), page("https://example.com/a")], [page("https://example.com/c"), page("https://example.com/a")], { ignore }); const b = comparePages([page("https://example.com/a"), page("https://example.com/b")], [page("https://example.com/a"), page("https://example.com/c")], { ignore }); expect(a).toEqual(b); });
  it("marks ignored URL page changes", () => { expect(comparePages([page("https://example.com/a")], [page("https://example.com/a", { statusCode: 404 })], { ignore: { ...ignore, ignoredUrls: ["/a"] } }).changed[0].ignoredBy).toBe("ignore-url"); });
});

describe("compare issues", () => {
  it("detects introduced issues", () => { expect(compareIssues([], [issue("a")], ignore).introduced).toHaveLength(1); });
  it("detects resolved issues", () => { expect(compareIssues([issue("a")], [], ignore).resolved).toHaveLength(1); });
  it("detects persisting issues", () => { expect(compareIssues([issue("a")], [issue("a")], ignore).persisting).toHaveLength(1); });
  it("detects severity increases", () => { expect(compareIssues([issue("a", { severity: "low" })], [issue("a", { severity: "high" })], ignore).changed[0].changeType).toBe("severityIncreased"); });
  it("detects severity decreases", () => { expect(compareIssues([issue("a", { severity: "critical" })], [issue("a", { severity: "medium" })], ignore).changed[0].changeType).toBe("severityDecreased"); });
  it("ignores description reformulation when key and hashes are stable", () => { expect(compareIssues([issue("a", { title: "Old" })], [issue("a", { title: "New" })], ignore).persisting).toHaveLength(1); });
  it("ignores unstable evidence when evidence hash is stable", () => { expect(compareIssues([issue("a", { evidenceHash: "stable" })], [issue("a", { evidenceHash: "stable" })], ignore).persisting).toHaveLength(1); });
  it("treats equivalent URL issues as same when key is stable", () => { expect(compareIssues([issue("same")], [issue("same")], ignore).introduced).toHaveLength(0); });
  it("marks ignored rules", () => { expect(compareIssues([], [issue("a")], { ...ignore, ignoredRules: ["technical.title-length"] }).introduced[0].ignoredBy).toBe("ignore-rule"); });
  it("marks ignored URLs", () => { expect(compareIssues([], [issue("a")], { ...ignore, ignoredUrls: ["/a"] }).introduced[0].ignoredBy).toBe("ignore-url"); });
  it("marks ignored categories", () => { expect(compareIssues([], [issue("a")], { ...ignore, ignoredCategories: ["technical"] }).introduced[0].ignoredBy).toBe("ignore-category"); });
});
