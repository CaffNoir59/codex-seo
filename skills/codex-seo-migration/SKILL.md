---
name: codex-seo-migration
description: Validate and migrate Codex SEO schema documents, old baselines, reports, history entries, and config files. Use when users ask to migrate an old baseline or validate schema compatibility.
---

# codex-seo-migration

## Inputs

A schema document or config path.

## Analysis Steps

1. Detect schema type.\n2. Validate current or future version.\n3. Run dry-run migration first.\n4. Write to a new output path unless explicit overwrite is requested.

## Output Format

Return source type, target version, warnings, changed flag, and output path.

## Known Limits

Only explicit migration paths are supported; unknown documents are not guessed destructively.

## Project Commands

`ash
codex-seo validate --schema-file baseline.json\ncodex-seo migrate baseline.json --dry-run\ncodex-seo migrate baseline.json --output migrated-history.json
` 
