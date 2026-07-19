import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../src/core/parse-html.js";
import { analyzeContent } from "../src/analyzers/content.js";
import { analyzeSchema } from "../src/analyzers/schema.js";
import type { AuditContext } from "../src/core/audit-context.js";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function context(html: string): AuditContext {
  return {
    requestedUrl: "https://example.com/test",
    finalUrl: "https://example.com/test",
    domain: "example.com",
    startedAt: new Date(0).toISOString(),
    fetch: { requestedUrl: "https://example.com/test", finalUrl: "https://example.com/test", status: 200, headers: {}, html, redirects: [], durationMs: 1 },
    html,
    rendered: false,
    parsed: parseHtml(html, "https://example.com/test")
  };
}

describe("parse html and analyzers", () => {
  it("detects missing title, multiple H1, and invalid JSON-LD", async () => {
    const html = await fixture("multiple-h1-invalid-jsonld.html");
    const parsed = parseHtml(html, "https://example.com/test");
    expect(parsed.title).toBe("");
    expect(parsed.h1s).toHaveLength(2);
    expect(parsed.jsonLd[0]?.valid).toBe(false);
    const content = await analyzeContent(context(html));
    const schema = await analyzeSchema(context(html));
    expect(content.issues.some((item) => item.id === "content.title-length")).toBe(true);
    expect(content.issues.some((item) => item.id === "content.h1-clarity")).toBe(true);
    expect(schema.issues.some((item) => item.id === "schema.invalid-json-ld")).toBe(true);
  });

  it("parses a valid local fixture", async () => {
    const parsed = parseHtml(await fixture("basic.html"), "https://example.com/basic");
    expect(parsed.title).toContain("Useful");
    expect(parsed.h1s).toEqual(["Useful Example Page"]);
    expect(parsed.images[0]?.extension).toBe("webp");
    expect(parsed.jsonLd[0]?.valid).toBe(true);
  });
});
