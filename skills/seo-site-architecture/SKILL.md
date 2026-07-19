---
name: seo-site-architecture
description: Site architecture skill for Codex SEO. Use for depth distribution, sitemap-only pages, orphan candidates, deep pages, weak incoming links, oversized internal link sets, and crawl path clarity.
---

# Site Architecture

## Inputs

- Sitewide crawl result with page depths, links, sitemap URLs, skipped URLs, and crawl stats.

## Analysis Steps

1. Analyze depth distribution.
2. Detect sitemap URLs not reached through crawl paths.
3. Detect pages near depth limits.
4. Detect pages with low incoming internal links.
5. Detect pages with excessive internal outgoing links.

## Output Format

Emit `site-architecture` issues and summary counts.

## Known Limits

Orphan detection is limited by crawl budget and sitemap availability.

## Project Commands

```bash
npm run audit -- https://example.com --crawl --max-depth 4
```