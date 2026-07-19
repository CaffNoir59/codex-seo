---
name: codex-seo-ci
description: Create and troubleshoot Codex SEO CI workflows, GitHub Actions, CI exports, JUnit, GitHub annotations, artifacts, and historical gates. Use for weekly audits, CI failures, summaries, and gate diagnostics.
---

# codex-seo-ci

## Inputs

A target URL, desired schedule, and whether GSC/performance/history are enabled.

## Analysis Steps

1. Use `.github/workflows/codex-seo.yml` or examples.\n2. Keep secrets in GitHub Secrets.\n3. Generate JUnit with `history export-ci --format junit`.\n4. Generate annotations with `--format github`.

## Output Format

Return workflow path, required secrets, expected artifacts, and exit-code behavior.

## Known Limits

Does not publish a Marketplace action.

## Project Commands

`ash
codex-seo history export-ci --format github\ncodex-seo history export-ci --format junit\nnpm run release:check
` 
