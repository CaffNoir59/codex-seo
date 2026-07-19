import { reportSchema } from "../src/schemas/report-schema.js";

reportSchema.parse({
  metadata: {
    tool: "codex-seo",
    version: "0.1.0",
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    domain: "example.com",
    date: new Date(0).toISOString(),
    durationMs: 1,
    rendered: false
  },
  scores: {
    overall: 100,
    categories: {
      technical: 100,
      content: 100,
      schema: 100,
      sitemap: 100,
      images: 100,
      geo: 100
    },
    penalties: {
      technical: 0,
      content: 0,
      schema: 0,
      sitemap: 0,
      images: 0,
      geo: 0
    }
  },
  issues: [],
  summaries: {},
  errors: [],
  execution: {
    analyzersExecuted: ["technical", "content", "schema", "sitemap", "images", "geo"],
    analyzersSkipped: [],
    redirects: [],
    status: 200,
    headers: {}
  }
});

console.log("report schema ok");
