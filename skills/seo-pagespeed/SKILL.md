---
name: seo-pagespeed
description: PageSpeed and CrUX adapter skill for Codex SEO. Use when the user asks to integrate PageSpeed Insights, Chrome UX Report, field data, API-key based performance checks, or remote performance fallbacks.
---

# SEO PageSpeed And CrUX

## Inputs

- Public URL.
- Optional `--pagespeed-api-key <key>` or `--pagespeed-api-key-env <name>`.
- Optional `--performance-device mobile|desktop`.
- Optional `--performance-mode pagespeed`, `crux`, or `all`.

## Analysis Steps

1. Use `src/performance/pagespeed/pagespeed-adapter.ts` for PageSpeed Insights.
2. Use `src/performance/crux/crux-adapter.ts` for Chrome UX Report URL data, then origin fallback.
3. Redact API keys from errors and never write secrets into reports, baselines, diffs, or cache keys.
4. Normalize remote responses into the shared performance schema.
5. Treat quota, timeout, 404, and missing field data as non-fatal warnings or adapter errors.
6. Use cached successful results when enabled to reduce repeat API calls.

## Output Format

Return normalized performance results with source `pagespeed` or `crux`, device, scope, field data period, p75 values, Lighthouse scores, warnings, and confidence.

## Known Limits

Remote adapters require network access and may be rate limited. PageSpeed and CrUX availability depends on Google APIs and URL traffic volume.

## Project Commands

```bash
npm run audit -- https://example.com --performance --performance-mode pagespeed --pagespeed-api-key-env PSI_API_KEY
npm run audit -- https://example.com --performance --performance-mode crux --pagespeed-api-key-env PSI_API_KEY
npm run audit -- https://example.com --performance --performance-mode all --performance-device mobile
```