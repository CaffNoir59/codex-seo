---
name: seo-baseline
description: Create, store, overwrite, load, and validate Codex SEO baselines from sitewide audit reports. Use when the user asks to create a production/staging/test SEO baseline, save an audit as a baseline, manage baseline storage, or enable privacy mode for SEO snapshots.
---

# SEO Baseline

## Inputs

- Site URL or existing `sitewide-report.json`.
- Baseline name such as `production`, `staging`, or `test`.
- Optional `--baseline-dir`, `--overwrite-baseline`, and `--privacy-mode`.

## Analysis Steps

1. Run a sitewide crawl when no current report exists.
2. Build a versioned normalized baseline snapshot rather than copying raw JSON.
3. Store under `.codex-seo/baselines/<safe-host>/<safe-name>.json` unless `--baseline-dir` is provided.
4. Refuse overwrites unless `--overwrite-baseline` is explicit.
5. Use `--privacy-mode` when raw title/meta/H1 text should not be stored.

## Output Format

Report the baseline path, schema version, audit mode, score, page count, and whether privacy mode was used.

## Known Limits

Baselines represent the crawl budget and configuration used when created. Comparisons should warn when current crawl settings differ.

## Project Commands

```bash
npm run audit -- https://example.com --crawl --save-baseline production
npm run audit -- https://example.com --crawl --save-baseline staging --privacy-mode
npm run audit -- https://example.com --crawl --save-baseline production --overwrite-baseline
```