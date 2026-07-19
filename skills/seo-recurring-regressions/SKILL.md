---
name: seo-recurring-regressions
description: Recurring SEO regression detection for Codex SEO using HistoryEntry issue fingerprints to find problems that disappear, reappear, stay active, or repeatedly affect releases.
---

# seo-recurring-regressions

## Inputs

Use this skill when the user asks which SEO issues keep coming back, which regressions were reintroduced, or which fixes are unstable across audits and releases.

## Analysis Steps

1. Load chronological history entries.\n2. Group issue fingerprints by stable rule identifier.\n3. Count occurrences, resolutions, reintroductions, first seen, last seen, and active status.\n4. Prioritize active or repeatedly reintroduced issues.\n5. Use historical gates such as `--max-recurring-regressions` when this should block CI.

## Output Format

Return recurring issue IDs, occurrence counts, regression counts, active status, confidence, and blocking gate result when used.

## Known Limits

Current fingerprint grouping depends on stable rule prefixes. If source reports only provide opaque hashes, recurring issue labels are less descriptive.

## Project Commands

`ash
npm run history -- trend --max-recurring-regressions 0\nnpm run history -- trend --last 12 --fail-on-negative-trend
` 
