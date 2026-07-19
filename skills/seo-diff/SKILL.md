---
name: seo-diff
description: Compare two Codex SEO baselines or sitewide reports, generate versioned JSON/HTML/PDF diff reports, and classify pages, issues, regressions, improvements, ignored changes, compatibility warnings, and quality gate results. Use when the user asks to compare audits, compare reports, generate an HTML/PDF diff, or review SEO changes between versions.
---

# SEO Diff

## Inputs

- Previous baseline or `sitewide-report.json`.
- Current baseline or `sitewide-report.json`.
- Optional output, HTML/PDF, ignore, gate, and strict compatibility flags.

## Analysis Steps

1. Coerce both inputs into versioned baseline snapshots.
2. Normalize unstable fields before comparison.
3. Compare pages by stable normalized URL identity.
4. Compare issues by rule/category/URL/evidence keys.
5. Generate JSON always; add HTML/PDF when requested.
6. Keep ignored changes visible in the report.

## Output Format

Summarize previous score, current score, delta, pages added/removed/changed, issues introduced/resolved, quality gate status, report paths, and compatibility warnings.

## Known Limits

Incomplete crawls reduce confidence. Different crawl budgets, render modes, robots behavior, or domains can make comparisons partial or incompatible.

## Project Commands

```bash
npm run diff -- previous.json current.json
npm run diff -- previous.json current.json --html --pdf --output reports/diff
npm run audit -- https://example.com --crawl --compare-baseline production
```