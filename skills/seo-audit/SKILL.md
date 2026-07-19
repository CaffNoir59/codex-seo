---
name: seo-audit
description: Full SEO audit skill for Codex SEO. Use when the user asks to audit a site, analyze SEO health, generate a report, or run all core SEO modules against a public URL.
---

# Full SEO Audit

## Inputs

- Public URL.
- Optional `--pdf` and `--render` flags.

## Analysis Steps

1. Use the orchestrator to build one audit context.
2. Run technical, content, schema, sitemap, images, and geo analyzers.
3. Preserve module errors instead of hiding them.
4. Generate deterministic scores from issue severities.
5. Write JSON and HTML reports.

## Output Format

Return the report paths, global score, issue count, and any module errors. Keep detailed evidence in `report.json`.

## Known Limits

Full audit depth is intentionally limited in v0.1. It samples internal links and image sizes rather than crawling an entire site.

## Project Commands

```bash
npm run audit -- https://example.com
npm run audit -- https://example.com --pdf
```
