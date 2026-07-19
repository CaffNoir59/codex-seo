---
name: seo-technical
description: Technical SEO skill for Codex SEO. Use for crawlability, indexability, canonical, meta robots, HTTPS, heading structure, viewport, redirects, status codes, and accessible link checks.
---

# Technical SEO

## Inputs

- Public URL and shared audit context.

## Analysis Steps

1. Inspect HTTP status and redirects.
2. Check canonical, robots, lang, viewport, HTTPS, H1 count, and heading depth.
3. Sample internal links with safe HEAD requests.
4. Flag links without accessible names.

## Output Format

Emit `technical` category issues with evidence and recommendations.

## Known Limits

Internal link checks are sampled in v0.1 to avoid excessive crawling.

## Project Commands

```bash
npm run audit -- https://example.com
npm test -- technical
```
