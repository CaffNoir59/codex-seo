---
name: seo-core-web-vitals
description: Core Web Vitals skill for Codex SEO. Use when the user asks about LCP, INP, CLS, TTFB, field data, lab data, CWV pass or fail status, or Core Web Vitals regressions.
---

# SEO Core Web Vitals

## Inputs

- URL or sitewide report containing normalized `performance` entries.
- Optional `--performance-mode crux`, `--performance-mode pagespeed`, or `--performance-mode all` when field or remote data is requested.
- Optional gate thresholds such as `--max-lcp`, `--max-inp`, `--max-cls`, and `--max-ttfb`.

## Analysis Steps

1. Prefer CrUX field data when available for real-user Core Web Vitals decisions.
2. Use PageSpeed Insights when the user wants Lighthouse plus URL or origin field data.
3. Use official Lighthouse local lab data by default; use Playwright only as an internal synthetic fallback.
4. Normalize all sources into the shared performance schema before comparing values.
5. Explain source, scope, device, confidence, and whether data is lab or field data.
6. For regressions, compare baselines and enforce CWV gates in `src/diff/quality-gate.ts`.

## Output Format

Report LCP, INP, CLS, TTFB, source, engine, scoreKind, device, scope, confidence, thresholds, and pass/fail status. Include any data gaps as warnings instead of hiding them.

## Known Limits

CrUX data may be unavailable for low-traffic URLs. Local Playwright cannot measure real-user INP and may only provide lab proxies or missing values.

## Project Commands

```bash
npm run audit -- https://example.com --performance --performance-mode all
npm run diff -- previous.json current.json --max-lcp 2500 --max-inp 200 --max-cls 0.1 --max-ttfb 800
npm run diff -- previous.json current.json --max-lcp-regression 500 --max-cls-regression 0.05
```