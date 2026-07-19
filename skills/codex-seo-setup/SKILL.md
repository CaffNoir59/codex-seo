---
name: codex-seo-setup
description: Set up Codex SEO in an existing project with init, configuration validation, safe gitignore updates, local folders, and installation guidance. Use when users ask to initialize Codex SEO, create config, or prepare local setup.
---

# codex-seo-setup

## Inputs

A project directory and optional target environment.

## Analysis Steps

1. Run `codex-seo init --minimal` or `--full` according to need.\n2. Never overwrite files without `--force`.\n3. Run `codex-seo validate`.\n4. Run `codex-seo doctor`.

## Output Format

List created/updated/skipped files and next commands.

## Known Limits

Does not publish packages or create Git tags.

## Project Commands

`ash
codex-seo init --minimal\ncodex-seo init --full --ci github\ncodex-seo validate\ncodex-seo doctor
` 
