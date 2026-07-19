---
name: codex-seo-release
description: Prepare Codex SEO release checks without publishing npm or creating Git tags. Use for V1 readiness, package inspection, changelog, license, schemas, migrations, and npm pack checks.
---

# codex-seo-release

## Inputs

A repository checkout with built artifacts.

## Analysis Steps

1. Run validation and build.\n2. Run `npm pack --dry-run`.\n3. Run `npm run release:check`.\n4. Do not publish or tag unless explicitly instructed.

## Output Format

Return release readiness, pack contents, blockers, and manual publishing steps.

## Known Limits

Does not push, tag, or publish.

## Project Commands

`ash
npm run validate\nnpm run build\nnpm pack --dry-run\nnpm run release:check
` 
