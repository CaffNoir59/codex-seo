---
name: seo-page
description: Single-page SEO analysis skill for Codex SEO. Use for on-page SEO, page title, meta description, headings, canonical, schema, image, and extractability checks on one URL.
---

# Single Page SEO

## Inputs

- One public page URL.
- Optional forced browser rendering.

## Analysis Steps

1. Fetch and optionally render the page.
2. Parse title, meta description, canonical, robots, headings, links, images, JSON-LD, text ratio, and dates.
3. Run page-relevant analyzers: technical, content, schema, images, and geo.
4. Use sitemap only when the user asks for site-discovery evidence.

## Output Format

Return stable `SeoIssue` objects and a local report if the CLI is used.

## Known Limits

This skill does not infer sitewide architecture from one page.

## Project Commands

```bash
npm run audit -- https://example.com/page
```
