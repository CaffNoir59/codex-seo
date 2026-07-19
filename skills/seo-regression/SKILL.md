---
name: seo-regression
description: Evaluate SEO diff regressions and CI quality gates, including score drops, new high or critical issues, noindex changes, HTTP errors, canonical changes, broken links, ignored rules, and deployment pass/fail decisions. Use when the user asks whether a release can deploy, wants only critical regressions, or needs fail-on-regression thresholds.
---

# SEO Regression

## Inputs

- A diff report or two comparable reports.
- Gate flags or `codex-seo.config.json`.
- Ignore rules for known false positives.

## Analysis Steps

1. Apply CLI options first, then config file, then defaults.
2. Mark ignored rules, URLs, and categories without hiding them.
3. Fail with exit code `2` when a quality gate threshold is exceeded.
4. Fail with exit code `3` for strict compatibility failures.
5. Treat incomplete crawls with lower confidence.

## Output Format

Prioritize active regressions, gate reasons, confidence, affected URLs, and recommended fixes. Mention ignored changes separately.

## Known Limits

Quality gates are only as reliable as the crawl coverage. Use strict compatibility for CI when budgets and settings must match.

## Project Commands

```bash
npm run diff -- previous.json current.json --fail-on-regression
npm run diff -- previous.json current.json --max-score-drop 3 --max-new-critical 0
npm run diff -- previous.json current.json --ignore-url /preview/ --ignore-category content
```