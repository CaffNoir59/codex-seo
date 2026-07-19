---
name: seo-internal-linking
description: Sitewide internal linking skill for Codex SEO. Use for incoming link counts, outgoing link counts, links to non-indexable pages, broken internal targets, redirect targets, and canonical/internal-link inconsistencies.
---

# Internal Linking

## Inputs

- A sitewide crawl result with `pages`, internal links, status codes, robots metadata, and canonicals.

## Analysis Steps

1. Build incoming and outgoing link maps.
2. Detect weakly linked pages.
3. Detect internal links to non-indexable pages.
4. Detect uncrawled, skipped, or broken internal targets.
5. Detect internal links pointing at non-canonical URLs.

## Output Format

Emit `internal-linking` issues and include graph evidence.

## Known Limits

The graph only covers URLs inside the configured crawl budget.

## Project Commands

```bash
npm run audit -- https://example.com --crawl
```