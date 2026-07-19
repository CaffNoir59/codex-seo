---
name: seo-content-decay
description: Detect and explain organic content decay from Google Search Console period comparisons. Use when the user asks for pages or queries losing clicks, impressions, CTR, or average position over the last 28 days or a comparable period, including winning/losing pages, new/lost queries, and significance-aware decline analysis.
---

# SEO Content Decay

Use comparable periods and minimum volume thresholds before calling a decline meaningful.

## Workflow

1. Run `npm run audit -- <url> --crawl --gsc --gsc-compare-period --gsc-days 28`.
2. Confirm the current and previous periods do not overlap and have the same length.
3. Ignore tiny movements below volume/significance thresholds.
4. Separate clicks, impressions, CTR and position changes.
5. Identify losing pages, losing queries, new queries and lost queries.
6. Phrase findings as observed associations unless a separate investigation proves causality.

## Inputs

- Current and previous GSC periods, dimensions, thresholds and optional crawl/performance context.

## Analysis Steps

1. Ensure periods have the same length and do not overlap.
2. Compare clicks, impressions, CTR and average position separately.
3. Filter low-volume noise.
4. Identify winning/losing pages, winning/losing queries, new queries and lost queries.
5. Phrase findings as observed associations unless causality is proven elsewhere.

## Output Format

Return deltas, relative changes, confidence, affected pages/queries and recommended investigation steps.

## Known Limits

Seasonality, SERP changes and tracking delays can create noise. Partial GSC data lowers confidence.

## Project Commands

```bash
npm run audit -- https://example.com --crawl --gsc --gsc-compare-period --gsc-days 28
```
