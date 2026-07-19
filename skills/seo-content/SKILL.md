---
name: seo-content
description: Content quality skill for Codex SEO. Use for title and meta description quality, H1 clarity, thin content, text-to-HTML ratio, repeated phrases, long paragraphs, and placeholder copy.
---

# Content Quality

## Inputs

- Parsed HTML from a shared audit context.

## Analysis Steps

1. Validate title and meta description length.
2. Check H1 presence and uniqueness.
3. Estimate word count and text-to-HTML ratio.
4. Detect excessive exact phrase repetition.
5. Detect long paragraphs and placeholder content.

## Output Format

Emit `content` category issues. Evidence must show counts or extracted strings where useful.

## Known Limits

This skill estimates content quality from visible HTML text. It does not judge factual accuracy without external verification.

## Project Commands

```bash
npm run audit -- https://example.com
```
