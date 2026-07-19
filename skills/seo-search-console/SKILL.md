---
name: seo-search-console
description: Analyze optional Google Search Console data in Codex SEO audits. Use when the user asks to connect GSC, inspect Google Search performance, compare clicks/impressions/CTR/position, cross GSC with crawl or Lighthouse/CrUX data, use --gsc CLI options, list GSC properties, or produce privacy-safe GSC reports.
---

# SEO Search Console

Use the project CLI instead of hand-querying Google when possible.

## Workflow

1. Keep GSC optional. Run ordinary crawl/performance audits unchanged when `--gsc` is absent.
2. Prefer service account auth with `--gsc-credentials` or `GOOGLE_APPLICATION_CREDENTIALS`.
3. Use OAuth only when `GSC_OAUTH_ACCESS_TOKEN` or a documented local token path exists; do not invent an interactive flow.
4. Validate the selected property with `npm run gsc -- inspect-property <property>`.
5. Run audits with explicit source labels:
   - `npm run audit -- <url> --gsc --gsc-property sc-domain:example.com`
   - `npm run audit -- <url> --crawl --performance --gsc --gsc-property sc-domain:example.com`
6. Use `--gsc-privacy-mode`, `--gsc-redact-queries`, or `--gsc-redact-url-paths` for sensitive reports.

Never log tokens, credential JSON, refresh tokens, private keys or service account emails in privacy mode. Treat average position as an aggregate signal, not an exact ranking.

## Inputs

- Site URL, GSC property, optional credentials path, date range, dimensions, filters and privacy flags.

## Analysis Steps

1. Validate property access and URL compatibility.
2. Fetch Search Analytics through the mockable adapter.
3. Mark partial/cache/API source state explicitly.
4. Cross with crawl and performance data when available.
5. Apply privacy redaction before reporting sensitive queries or paths.

## Output Format

Return property, period, clicks, impressions, CTR, average position, dimensions, source, warnings, opportunities and affected URLs.

## Known Limits

OAuth interactive setup is documented but not implemented. Average position is an aggregate signal, not an exact ranking. Missing data is not zero traffic.

## Project Commands

```bash
npm run gsc -- properties
npm run gsc -- inspect-property sc-domain:example.com
npm run audit -- https://example.com --crawl --gsc --gsc-property sc-domain:example.com
```
