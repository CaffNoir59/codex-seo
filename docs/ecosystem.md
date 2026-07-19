# Codex SEO local ecosystem

Codex SEO 1.1.0 includes a local-first CLI, project initializer, stdio MCP server, Git safety workflow, managed preview, deployment adapter boundary, and Codex plugin. The original audit, crawl, performance, GSC, diff, history, and reporting commands remain available.

## Quick start

```bash
cd my-project
npx codex-seo init --yes
```

Open the trusted project in Codex and ask:

> Audit this project and fix the most important SEO issues.

The initializer detects the project with evidence, writes public and local-example configuration, initializes local Git unless disabled, creates local state directories, copies the maintainer skill, generates project-scoped MCP configuration, and returns every created, updated, skipped, or backed-up path.

## Installation

From npm:

```bash
npm install --save-dev codex-seo
npx codex-seo init --yes
```

From a generic Git clone:

```bash
git clone https://github.com/example/codex-seo.git
cd codex-seo
npm install
npm run build
node dist/cli/index.js init --yes --project-root /path/to/application
```

The public plugin bundle is in `plugin/codex-seo`. The package exposes `codex-seo`, `codex-seo-mcp`, and `create-codex-seo` executables.

## Architecture

- Audit engine: `src/orchestrator`, `src/crawler`, `src/analyzers`.
- Configuration: `src/project/config.ts`.
- Detection and init: `src/project/detect.ts`, `src/project/init.ts`.
- Git and controlled files: `src/project/git.ts`, `src/project/files.ts`.
- Validation and preview: `src/project/validation.ts`, `src/project/preview.ts`.
- Deployment: `src/project/deployment.ts`.
- Security: `src/security`.
- MCP: `src/mcp/server.ts`.
- Plugin and skill: `plugin/codex-seo`.

One npm package keeps installation simple; responsibilities remain separated by TypeScript modules and executable entry points.

## Init

```bash
npx codex-seo init --yes
npx codex-seo init --dry-run --json
npx codex-seo init --project-root /path/to/project --framework next --package-manager npm
npx codex-seo init --production-url https://example.com --deployment none
npx codex-seo init --no-git
```

Options include `--project-root`, `--production-url`, `--framework`, `--package-manager`, `--git`, `--no-git`, `--deployment`, `--force`, `--dry-run`, `--yes`, and `--json`.

Detection covers npm, pnpm, Yarn, Bun, Next.js, Nuxt, Astro, Vite, React, Vue, Svelte/SvelteKit, Angular, Remix, Laravel, generic Node, static sites, and unknown projects. Conclusions carry confidence and source evidence. Missing scripts are never invented.

Dry-run writes nothing. Repeated init skips existing managed files. `--force` creates timestamped backups.

## Public and private configuration

Commit `codex-seo.config.json`:

```json
{
  "schemaVersion": "1.1.0",
  "project": {
    "name": "Example Project",
    "root": ".",
    "productionUrl": "${PRODUCTION_URL}"
  },
  "commands": {
    "install": "npm ci",
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "test": "npm test",
    "build": "npm run build",
    "preview": "npm run start"
  },
  "git": {
    "enabled": true,
    "autoInitialize": true,
    "createWorkBranches": true,
    "defaultBranch": "main"
  },
  "audit": {
    "crawl": true,
    "performance": true,
    "environment": "production"
  },
  "deployment": {
    "provider": "none",
    "requireConfirmation": true
  }
}
```

Copy `codex-seo.local.example.json` to ignored `codex-seo.local.json` for machine-specific overrides:

```json
{
  "project": {
    "productionUrl": "${PRODUCTION_URL}"
  },
  "deployment": {
    "host": "${DEPLOY_HOST}",
    "username": "${DEPLOY_USER}",
    "remotePath": "${DEPLOY_PATH}",
    "authentication": { "type": "agent" },
    "hostVerification": { "strict": true, "knownHostsPath": ".codex-seo/secrets/known_hosts" },
    "releaseStrategy": "auto"
  }
}
```

The loader merges local over public, resolves environment references, rejects unsupported schema versions, refuses inline secrets, and prevents configured local paths from leaving the project root. Legacy audit fields remain supported.

## MCP

Portable stdio launch:

```bash
npx -y --package codex-seo codex-seo-mcp
```

Recommended project `.codex/config.toml`:

```toml
[mcp_servers.codex_seo]
command = "npx"
args = ["-y", "--package", "codex-seo", "codex-seo-mcp"]
cwd = "."
default_tools_approval_mode = "writes"
startup_timeout_sec = 20
tool_timeout_sec = 300
```

Codex loads project configuration for trusted projects. Init does not alter user-global Codex configuration or unrelated MCP servers. The server searches an explicit config, current directory, and parent directories up to a safe limit. Detection remains available without config; writes do not.

Audit profiles are quick, standard, and full, with explicit configured/unavailable/skipped/failed/passed adapter states. Workflows persist under .codex-seo/state/workflows and can be inspected, resumed, cancelled, restored, or cleaned.

Tool groups:

- Diagnostic: `project_status`, `project_detect`, `project_doctor`, `project_read_config`.
- SEO: page/site audit, reports, issues, comparisons, and history.
- Git: status, init, snapshot, work branch, diff, commit, restore, and snapshot list.
- Project: safe search/read, controlled patch, validation, build, and preview lifecycle.
- Workflow: analyze, prepare, validate, compare, and persistent workflow_fix_seo/workflow_manage orchestration.
- Deployment: connection/status, prepare, verified remote snapshot, staging, activation, detailed health checks, production regression evaluation, and rollback.
- Observability: rotated redacted JSONL logs listed through project_logs.

Responses use stable `success`, `operation`, `summary`, `results`, and `warnings` fields.

## Local Git

GitHub and remotes are optional. Before edits, the skill checks status, requests confirmation, creates a snapshot commit and manifest, optionally creates a neutral `codex-seo/audit-fix-<timestamp>` branch, applies bounded exact replacements, and returns the diff. Restore requires an existing snapshot identifier and explicit confirmation. No MCP push tool exists.

## Validation

Configured steps run in order: install, lint, typecheck, test, build. Each step supports enable/disable, required/optional, stop-on-failure, and timeout. A missing command returns:

```json
{
  "status": "skipped",
  "reason": "command-not-configured"
}
```

It is never reported as passed.

## Preview

The managed preview uses the configured command without a shell, chooses an available port, sets `PORT` and `HOST`, waits for HTTP readiness, keeps bounded redacted logs, and tracks the child process. Stop terminates the process tree on Windows and the process group on macOS/Linux. Server shutdown stops every managed preview.

Loopback audit enables private-network access only for that explicit preview while retaining URL, redirect, protocol, and credential checks.

## Deployment and rollback

Providers:

- `none`: safe default.
- `local-directory`: functional staging under `releases/<timestamp>`, `current` activation, `previous` rollback, snapshots, and health checks.
- ssh and sftp: real generic SSH/SFTP transport with agent or ignored-key authentication, strict host verification, staging verification, symlink or directory activation, structured health checks, production audit, retention, and verified rollback. See docs/ssh-sftp.md and docs/hostinger.md.

Activation, overwrite, restore, rollback, release deletion, commit when policy requires it, Git push, data migration, and custom deployment commands require explicit confirmation. The skill asks conversationally after showing validation, audit delta, target, and rollback plan.

| Operation | Automatic | Confirmation |
| --- | ---: | ---: |
| Detect, read status/config, audit, search safe files | Yes | No |
| Run configured validation, manage preview | Yes | No |
| Initialize Git, snapshot, branch, patch, commit | No | Yes |
| Upload staging, activate, overwrite | No | Yes |
| Restore, rollback, delete, migrate, push | No | Yes |

## Skill

`seo-maintainer` begins read-only, classifies issues by severity/confidence/ownership, protects Git before writes, applies minimal fixes, validates the preview, compares before/after evidence, shows the diff, and requests confirmation before production. It forbids score gaming, generic content replacement, keyword stuffing, secret access, hidden regressions, invented results, and deployment with failed required checks.

## Security and publication

There is no arbitrary command, eval, or free-shell MCP tool. Configured commands are parsed into executable and arguments, limited to an executable allowlist, and reject pipes, redirections, command substitution, shell operators, null bytes, and `shell=true`.

File operations resolve real paths, reject traversal and escaping symlinks, enforce size limits, redact secret values, and refuse `.env`, private keys, credential files, and secret/token/password filenames.

```bash
npm run check:sensitive
```

The scanner checks publishable source, plugin, skill, docs, examples, and scripts for personal paths, real emails, unexpected IPs, common tokens, JWTs, private keys, inline passwords, and configurable forbidden names. Set `CODEX_SEO_FORBIDDEN_NAMES` to comma-separated denied project or brand names. It runs in `validate` and `prepack`.

## Development and publication

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run validate
npm run build
npm audit
npm run check:sensitive
npm run release:check
npm pack --dry-run
```

The initializer never publishes, pushes, or contacts a remote deployment target.

## Troubleshooting

- Run `npx codex-seo doctor --json`.
- Trust the project when Codex ignores `.codex/config.toml`.
- Restart Codex after MCP configuration changes.
- Install Playwright Chromium for browser performance and PDF support.
- Read project config diagnostics for missing environment variables.
- Stop stale managed previews with `project_stop_preview`.
- List snapshots before restoration.
