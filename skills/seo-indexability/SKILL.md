---
name: seo-indexability
description: Sitewide indexability skill for Codex SEO. Use for HTTP status issues, meta robots, canonical checks, sitemap coverage, noindex in sitemap, external canonicals, and canonical target errors.
---

# Indexability

## Inputs

- Sitewide crawl result and sitemap discovery data.

## Analysis Steps

1. Review HTTP status codes.
2. Review meta robots index/follow state.
3. Compare indexable crawled pages against sitemap URLs.
4. Detect non-indexable pages present in sitemaps.
5. Detect external and erroring canonical targets where visible.

## Output Format

Emit `indexability` issues with affected URL examples.

## Known Limits

X-Robots-Tag and canonical chains are limited to pages fetched within the crawl budget.

## Project Commands

```bash
npm run audit -- https://example.com --crawl
```