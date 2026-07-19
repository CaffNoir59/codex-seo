---
name: codex-seo-doctor
description: Diagnose Codex SEO readiness across Node, platform, configuration, history, Chrome, Lighthouse, Playwright, PDF, GSC credentials, cache, schemas, and CI. Use when users ask if install is ready.
---

# codex-seo-doctor

## Inputs

Optional config path and privacy mode.

## Analysis Steps

1. Run `codex-seo doctor`.\n2. Use `--json` for automation.\n3. Redact credentials in all explanations.\n4. Recommend only needed installs.

## Output Format

Summarize PASS/WARN/FAIL/SKIP and final READY/DEGRADED/FAILED.

## Known Limits

Cannot verify remote GSC permissions without configured credentials and network access.

## Project Commands

`ash
codex-seo doctor\ncodex-seo doctor --json\nnpx playwright install chromium
` 
