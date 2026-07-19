---
name: seo-performance
description: Performance audit skill for Codex SEO. Use when the user asks to measure page speed, official Lighthouse, Playwright fallback estimates, resource weight, JavaScript cost, Core Web Vitals lab metrics, or performance regressions with Codex-compatible tools.
---

# SEO Performance

## Inputs

- Public HTTP or HTTPS URL.
- Optional `--performance-device mobile|desktop`.
- Optional `--performance-runs <number>` for median local lab runs.
- Optional crawl flags for sitewide sampling.

## Analysis Steps

1. Run Codex SEO with `--performance --performance-mode local --local-performance-engine auto` first.
2. Use official Lighthouse through `src/performance/local/lighthouse-runner.ts` by default. Use `src/performance/local/playwright-fallback.ts` only when explicitly requested or when auto fallback is needed.
3. Collect official Lighthouse scores, FCP, LCP, CLS, TBT, Speed Index, TTFB, transfer bytes, request count, JavaScript, CSS, image, font bytes, diagnostics, opportunities, and run statistics.
4. For sitewide audits, select pages with `src/performance/performance-selector.ts` using important, all, or sample strategy.
5. Keep adapter failures non-fatal and report them as performance issues.
6. Save performance data into report JSON and baselines so diffs can compare metrics later.

## Output Format

Return report paths, performance score, key metrics, resource budgets, warnings, and any quality gate failures. Keep raw normalized data under `performance` in the JSON report.

## Known Limits

Official Lighthouse results can be called Lighthouse. Playwright fallback results are internal estimates and must not be presented as Lighthouse scores. Lab data is not CrUX field data.

## Project Commands

```bash
npm run audit -- https://example.com --performance --performance-mode local --local-performance-engine lighthouse
npm run audit -- https://example.com --performance --performance-mode local --local-performance-engine lighthouse --performance-runs 3
npm run audit -- https://example.com --crawl --performance --performance-sample-pages 5
```