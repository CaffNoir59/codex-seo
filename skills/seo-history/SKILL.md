---
name: seo-history
description: Local SEO history management for Codex SEO using versioned HistoryEntry files, deterministic indexes, imports, exports, migrations, privacy mode, validation, pruning, and CI-ready history commands.
---

# seo-history

## Inputs

Use this skill when the user asks to save audit history, import old audits, export historical baselines, migrate baselines, validate the history store, prune old entries, or explain the local history format.

## Analysis Steps

1. Identify the history directory, defaulting to `.codex-seo/history`.\n2. Prefer `npm run history -- <action>` commands instead of manual file editing.\n3. Keep credentials, raw GSC auth data, API keys, and private query text out of HistoryEntry files.\n4. Validate imported files with `history validate`, rebuilding the index only when requested.\n5. Use privacy mode before sharing or exporting history outside the local project.

## Output Format

Return the command run, the number of entries affected, relevant file paths, and whether the store/index validated.

## Known Limits

History is file-based and local. Concurrency is protected by a lock file, but external manual edits can still create orphan entries until validation/rebuild runs.

## Project Commands

`ash
npm run history -- list\nnpm run history -- import tests/fixtures/history/history-entries.json\nnpm run history -- export .codex-seo/history/export.json --privacy-mode\nnpm run history -- validate --rebuild
` 
