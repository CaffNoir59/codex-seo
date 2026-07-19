---
name: seo-sitemap
description: Sitemap analysis skill for Codex SEO. Use for robots.txt sitemap discovery, /sitemap.xml fallback, XML validation, URL counts, duplicate URLs, out-of-domain URLs, and non-HTTPS sitemap entries.
---

# Sitemap Analysis

## Inputs

- Final audited URL and domain.

## Analysis Steps

1. Fetch `/robots.txt` and extract Sitemap directives.
2. Try discovered sitemaps and `/sitemap.xml`.
3. Parse XML sitemap URL entries.
4. Count URLs, duplicates, outside-domain URLs, and non-HTTPS URLs.
5. Record fetch errors as module errors.

## Output Format

Emit `sitemap` category issues and a summary with candidate URLs and counts.

## Known Limits

Sitemap index expansion is not implemented in v0.1.

## Project Commands

```bash
npm run audit -- https://example.com
```
