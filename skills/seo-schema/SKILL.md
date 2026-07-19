---
name: seo-schema
description: Schema markup skill for Codex SEO. Use for JSON-LD detection, invalid JSON, Schema.org types, basic required properties, duplicates, and canonical URL consistency heuristics.
---

# Schema Markup

## Inputs

- Parsed JSON-LD blocks from a page.

## Analysis Steps

1. Detect JSON-LD blocks.
2. Parse JSON and report syntax failures.
3. Extract Schema.org types.
4. Check basic properties for Organization, Article-like, and Product schema.
5. Flag manifest duplicate types and canonical mismatch heuristics.

## Output Format

Emit `schema` category issues with parse errors, detected types, and recommendations.

## Known Limits

This skill validates practical basics. It is not a complete Schema.org validator.

## Project Commands

```bash
npm run audit -- https://example.com
```
