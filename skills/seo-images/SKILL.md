---
name: seo-images
description: Image SEO skill for Codex SEO. Use for alt text, width and height dimensions, lazy loading, modern formats, external image hosts, generic file names, and sampled resource size checks.
---

# Image SEO

## Inputs

- Parsed image elements from a shared audit context.

## Analysis Steps

1. Check alt attributes.
2. Check width and height attributes.
3. Review lazy loading usage.
4. Detect legacy image extensions.
5. Detect external image hosts and generic file names.
6. Sample a small number of image HEAD requests for size evidence.

## Output Format

Emit `images` category issues with example image URLs and counts.

## Known Limits

The analyzer samples sizes without full downloads. It does not inspect actual pixels or compression quality.

## Project Commands

```bash
npm run audit -- https://example.com
```
