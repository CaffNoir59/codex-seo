---
name: seo-crawl
description: Controlled multi-page crawl skill for Codex SEO. Use when the user asks for a sitewide SEO audit, crawl budget, sitemap coverage, robots coverage, max-depth crawling, or multi-page discovery with deterministic JSON and HTML reports.
---

# SEO Crawl

## Inputs

- Public start URL.
- Optional crawl flags: `--max-pages`, `--max-depth`, `--concurrency`, `--include-subdomains`, `--ignore-robots`, `--render`, `--no-cache`, `--pdf`.

## Analysis Steps

1. Normalize the start URL and enforce URL safety for every request and redirect.
2. Fetch robots.txt and respect CodexSEO or fallback `*` rules by default.
3. Discover sitemap URLs from robots.txt and `/sitemap.xml`.
4. Expand sitemap indexes within configured depth and deduplicate URLs.
5. Add allowed sitemap URLs and discovered internal links to a deterministic queue.
6. Enforce max pages, max depth, concurrency, domain boundaries, filters, and crawl delay.
7. Produce `CrawledPage` records and sitewide reports.

## Output Format

Write `sitewide-report.json` and `sitewide-report.html`; add `sitewide-report.pdf` when requested.

## Known Limits

The crawler is bounded and does not attempt exhaustive crawling beyond the configured budget.

## Project Commands

```bash
npm run audit -- https://example.com --crawl
npm run audit -- https://example.com --crawl --max-pages 100 --max-depth 4
```