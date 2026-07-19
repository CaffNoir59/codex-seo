---
name: seo-environment-comparison
description: Environment comparison skill for Codex SEO, comparing latest historical audits between production, staging, preview, or other environments without mixing incompatible GSC properties.
---

# seo-environment-comparison

## Inputs

Use this skill when the user asks to compare production and staging SEO, verify a staging fix, check deployment correction, or inspect environment drift.

## Analysis Steps

1. Select the latest audit per requested environment.\n2. Compare score, issue fingerprints, performance summary, and correction/risk counts.\n3. Treat GSC data as not directly comparable unless properties are equivalent.\n4. Flag incompatible origins or environment-specific properties.\n5. Recommend deployment action based on observed production-only and staging-only problems.

## Output Format

Return environment A/B, compatibility, scores, score delta, problems unique to each environment, correction count, future regression risk, and GSC comparability.

## Known Limits

Environment comparison can be skewed by auth walls, robots differences, staging noindex policies, and non-equivalent GSC properties.

## Project Commands

`ash
npm run history -- compare-environments staging production\nnpm run history -- trend --environment production\nnpm run history -- trend --environment staging
` 
