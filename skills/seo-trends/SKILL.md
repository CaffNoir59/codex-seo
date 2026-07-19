---
name: seo-trends
description: Longitudinal SEO trend analysis for Codex SEO using local HistoryEntry data, deterministic statistics, confidence scoring, historical gates, HTML/PDF dashboards, and CI exports.
---

# seo-trends

## Inputs

Use this skill when the user asks for SEO evolution over time, trend lines, historical gates, Core Web Vitals evolution, GSC trend changes, volatility, outliers, or CI longitudinal checks.

## Analysis Steps

1. Load compatible HistoryEntry data from the selected history directory.\n2. Filter by date, environment, branch, release, and completeness as requested.\n3. Build trend series for requested metrics with deterministic statistics.\n4. Interpret inverse metrics correctly: LCP, CLS, INP, TBT, TTFB, issue counts, position, and error counts are lower-is-better.\n5. Apply confidence and quality gate options before recommending a pass/fail decision.

## Output Format

Return trend direction, deltas, confidence, gate status, report paths, and the exact filters used.

## Known Limits

Trend confidence depends on point count, compatibility, and partial data. Two-point comparisons are not statistically reliable trend evidence.

## Project Commands

`ash
npm run history -- trend --last 12\nnpm run history -- trend --trend-metric seo.score --trend-metric performance.lcpMs\nnpm run history -- trend --require-history-points 6 --fail-on-negative-trend\nnpm run history -- export-ci --format github
` 
