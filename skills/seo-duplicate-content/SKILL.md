---
name: seo-duplicate-content
description: Sitewide duplicate-content skill for Codex SEO. Use for duplicate titles, duplicate meta descriptions, duplicate H1s, shared canonicals, and deterministic local fingerprint heuristics for near-duplicate templates.
---

# Duplicate Content

## Inputs

- Sitewide crawl result with page titles, meta descriptions, H1s, canonicals, and content fingerprints.

## Analysis Steps

1. Group pages by title, meta description, H1, canonical, and text fingerprint.
2. Report duplicate candidates with URL groups.
3. Mark fingerprint results as heuristic.
4. Avoid claiming perfect duplicate-content detection.

## Output Format

Emit `duplicate-content` issues with grouped examples.

## Known Limits

Similarity detection is local and deterministic; it is not a full semantic duplicate detector.

## Project Commands

```bash
npm run audit -- https://example.com --crawl
```