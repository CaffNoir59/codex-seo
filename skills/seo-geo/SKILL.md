---
name: seo-geo
description: GEO and AI-search readiness skill for Codex SEO. Use for heuristic checks of direct answer blocks, semantic headings, FAQ-like sections, structured data, organization or author signals, dates, citations, and extractible standalone passages.
---

# GEO Readiness

## Inputs

- Parsed text, headings, links, dates, and JSON-LD from a shared audit context.

## Analysis Steps

1. Look for concise direct-answer blocks.
2. Check semantic heading structure.
3. Detect FAQ-like structures.
4. Check valid structured data support.
5. Look for organization or author signals.
6. Detect publication or update dates.
7. Count external citations and standalone extractible passages.

## Output Format

Emit `geo` category issues. Mark the summary as heuristic.

## Known Limits

This skill does not measure real AI visibility, citations, or model preference without external data.

## Project Commands

```bash
npm run audit -- https://example.com
```
