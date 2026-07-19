---
name: seo-release-impact
description: Release impact comparison skill for Codex SEO, comparing historical audits across releases with SEO score, issue, performance, and GSC deltas while preserving compatibility checks.
---

# seo-release-impact

## Inputs

Use this skill when the user asks whether a release improved or degraded SEO, asks to compare two releases, or wants deployment impact measured from historical audits.

## Analysis Steps

1. Select the latest compatible audit for each requested release.\n2. Compare SEO score, issue fingerprints, Lighthouse score, LCP, and GSC clicks.\n3. Distinguish temporal association from causal proof.\n4. Flag incompatible origins or properties before interpreting release impact.\n5. Recommend follow-up analysis only from observed regressions.

## Output Format

Return release A/B, compatibility, score delta, regression/improvement counts, performance delta, GSC click delta, and report path when written.

## Known Limits

A release comparison is observational unless deployment metadata and environment parity are complete.

## Project Commands

`ash
npm run history -- compare-releases v1.0.0 v1.1.0\nnpm run history -- release --release-a v1.2.2 --release-b v1.3.0\nnpm run history -- trend --release v1.3.0
` 
