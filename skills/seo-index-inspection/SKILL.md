---
name: seo-index-inspection
description: Use Google Search Console URL Inspection data for selected URLs in Codex SEO audits. Use when the user asks to inspect indexing, coverage, crawl allowed, robots.txt, Google canonical, user canonical, mobile usability, rich results, or high-traffic pages with canonical/noindex/status problems.
---

# SEO Index Inspection

URL Inspection has quotas. Inspect only selected URLs and mark missing inspection data as unknown, never as not indexed.

## Workflow

1. Enable inspection explicitly: `--gsc-inspect-urls <number>`.
2. Pick a strategy: `important`, `errors`, `traffic`, or `sample`.
3. Keep concurrency low and respect partial results.
4. Cross-check inspection findings with crawl status, robots, canonical and GSC traffic.
5. Report Google canonical mismatches, non-indexed inspected URLs, robots blocks and crawl failures.
6. Do not inspect thousands of URLs automatically.

## Inputs

- Selected URLs, GSC property, credentials, inspection count and strategy.

## Analysis Steps

1. Select only a small URL set using `important`, `errors`, `traffic` or `sample`.
2. Inspect with low concurrency and cache where possible.
3. Record verdict, coverage, crawl allowed, robots.txt, Google canonical, user canonical, last crawl, mobile usability and rich results.
4. Treat missing inspection as unknown, not non-indexed.
5. Cross-check findings with crawl and GSC traffic.

## Output Format

Return inspected URLs, verdicts, canonical mismatches, robots/crawl states, partial flags, confidence and recommendations.

## Known Limits

URL Inspection has quota limits and can return partial or unavailable data. Do not inspect thousands of URLs automatically.

## Project Commands

```bash
npm run audit -- https://example.com --crawl --gsc --gsc-inspect-urls 10 --gsc-inspection-strategy errors
```
