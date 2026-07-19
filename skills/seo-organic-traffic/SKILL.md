---
name: seo-organic-traffic
description: Prioritize SEO recommendations by real organic visibility using Google Search Console clicks, impressions, CTR, average position, query/page/device/country/date dimensions, crawl findings, and performance metrics. Use when the user asks for impact-based prioritization, high-impression low-CTR pages, non-brand traffic, traffic pages with technical errors, or real Google Search opportunity ranking.
---

# SEO Organic Traffic

Rank work by impact x severity x confidence, not by technical issue count alone.

## Workflow

1. Run a crawl plus GSC when traffic context matters: `npm run audit -- <url> --crawl --gsc --gsc-compare-period`.
2. Add performance when the request mentions CWV, Lighthouse, slow pages, or CrUX.
3. Use `--gsc-brand-query <pattern> --gsc-non-brand` to focus on non-brand opportunity.
4. Prioritize pages with impressions/clicks, positions 4-15, low CTR, and no critical technical blockers.
5. Keep critical technical errors visible even when traffic is low.
6. Use the report's priority score and explain that traffic/technical correlations are observed associations, not proven causes.

## Inputs

- GSC Search Analytics rows, crawl pages, issues, performance metrics, brand/non-brand filters and optional comparison period.

## Analysis Steps

1. Group traffic by page, query, device, country or date as requested.
2. Prefer non-brand filters when the user asks for acquisition opportunity.
3. Rank issues with impact x severity x confidence.
4. Keep critical technical errors visible even without traffic.
5. State source and confidence for every recommendation.

## Output Format

Return prioritized pages/queries with clicks, impressions, CTR, position, technical issue, performance metric, priority score and recommendation.

## Known Limits

Do not treat GSC absence as no traffic. Do not claim causality from simultaneous traffic and technical changes.

## Project Commands

```bash
npm run audit -- https://example.com --crawl --performance --gsc --gsc-compare-period
```
