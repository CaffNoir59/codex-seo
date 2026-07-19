import { describe, expect, it } from "vitest";
import { reportSchema } from "../src/schemas/report-schema.js";
import { sortIssues } from "../src/core/issue.js";
import * as cheerio from "cheerio";

describe("report and sitemap fixtures", () => {
  it("validates a report JSON shape", () => {
    const report = reportSchema.parse({
      metadata: {
        tool: "codex-seo",
        version: "0.1.0",
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/",
        domain: "example.com",
        date: new Date(0).toISOString(),
        durationMs: 10,
        rendered: false
      },
      scores: {
        overall: 100,
        categories: { technical: 100, content: 100, schema: 100, sitemap: 100, images: 100, geo: 100 },
        penalties: { technical: 0, content: 0, schema: 0, sitemap: 0, images: 0, geo: 0 }
      },
      issues: [],
      summaries: {},
      errors: [],
      execution: {
        analyzersExecuted: ["content", "geo", "images", "schema", "sitemap", "technical"],
        analyzersSkipped: [],
        redirects: [],
        status: 200,
        headers: {}
      }
    });
    expect(report.metadata.tool).toBe("codex-seo");
  });

  it("parses valid and invalid sitemap fixtures", async () => {
    const valid = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./fixtures/sitemap-valid.xml", import.meta.url), "utf8"));
    const invalid = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./fixtures/sitemap-invalid.xml", import.meta.url), "utf8"));
    const $ = cheerio.load(valid, { xmlMode: true });
    expect($("url > loc")).toHaveLength(2);
    const bad = cheerio.load(invalid, { xmlMode: true });
    expect(bad("url > loc")).toHaveLength(0);
  });

  it("keeps parallel-style aggregation deterministic", () => {
    const merged = sortIssues([
      { id: "z", category: "geo", severity: "low", title: "Z", description: "Z", recommendation: "Z" },
      { id: "a", category: "technical", severity: "high", title: "A", description: "A", recommendation: "A" },
      { id: "m", category: "content", severity: "high", title: "M", description: "M", recommendation: "M" }
    ]);
    expect(merged.map((item) => item.id)).toEqual(["m", "a", "z"]);
  });
});
