# Codex SEO

Codex SEO also ships a local project ecosystem: an idempotent initializer, stdio MCP server, local Git safety workflow, managed previews, controlled deployment adapters, and the generic `seo-maintainer` Codex plugin skill.

## Ecosystem Quick Start

```bash
cd my-project
npx codex-seo init --yes
```

Then ask Codex: "Audit this project and fix the most important SEO issues." See [Local ecosystem, MCP, Git, preview, deployment, and security](docs/ecosystem.md) for the complete installation and operations guide.

Native Codex SEO CLI and Agent Skills for technical SEO audits, sitewide crawling, performance, Google Search Console, baselines, diffs, historical trends, and CI quality gates.

## Features

- Page and sitewide SEO audits with JSON, HTML, and PDF reports.
- Baselines, diffs, quality gates, and historical trend analysis.
- Lighthouse, Playwright fallback, PageSpeed Insights, CrUX, GSC, and URL Inspection support.
- CI exports: JSON, Markdown, GitHub annotations, and JUnit.
- Codex Agent Skills for setup, audits, CI, migrations, and release checks.

## Installation

```bash
npm install -D codex-seo
npx codex-seo --version
```

Global install:

```bash
npm install -g codex-seo
codex-seo doctor
```

## Quick Start

```bash
npx codex-seo init --minimal
npx codex-seo audit https://example.com --crawl
npx codex-seo doctor
```

For performance/PDF support:

```bash
npx playwright install chromium
```

## Examples

```bash
npx codex-seo audit https://example.com --crawl --performance
npx codex-seo audit https://example.com --crawl --gsc --gsc-property sc-domain:example.com
npx codex-seo diff previous.json current.json --fail-on-regression
npx codex-seo history trend --last 12
npx codex-seo history export-ci --format junit
```

`npm run audit -- https://example.com --crawl` remains supported for repository development. For normal use, prefer `npx codex-seo ...`; npm 11 may print its own `Unknown env config` warnings for flags passed after `npm run`.

## Configuration

Create `codex-seo.config.json` with `codex-seo init`. Validate with:

```bash
npx codex-seo validate --config codex-seo.config.json
npx codex-seo validate --fix
```

See `docs/configuration.md` and `examples/config/`.


Local/private network audits are blocked by default as SSRF protection. To audit an explicit development target, opt in deliberately:

```bash
node dist/cli/index.js audit http://127.0.0.1:3000 --allow-private-network --crawl
```

`--allow-localhost` is an alias. The opt-in keeps protocol, credential, and redirect validation active while allowing localhost, loopback, and private network addresses for the audited run.
## Crawler

The crawler respects robots by default, normalizes URLs, limits depth/pages/concurrency, expands sitemaps, and avoids common crawl traps.

## Performance

Local Lighthouse is preferred; Playwright fallback is clearly labeled. PageSpeed and CrUX are optional remote adapters. See `docs/performance.md`.

## Google Search Console

GSC is optional and never serializes credentials. Store secrets in environment variables or GitHub Secrets. See `docs/gsc.md`.

## Baseline And Diff

Use named baselines for release comparisons and `diff` for report-to-report gates. See `docs/baselines-and-diff.md`.

## History And Trends

History uses schema `1.0.0` with checksummed `HistoryEntry` files. Trend reports include deterministic statistics, confidence, recurrent regressions, release comparisons, and environment comparisons.

## Quality Gates

Exit codes: `0` success, `1` runtime/config/file error, `2` quality gate failure, `3` strict compatibility failure.

## GitHub Actions

Use `.github/workflows/codex-seo.yml`, `examples/github-actions/`, or `.github/actions/codex-seo/action.yml`. See `docs/github-actions.md`.

## Privacy And Security

No automatic telemetry. Redaction covers bearer tokens, API keys, private keys, client secrets, URL credentials, and sensitive query parameters. See `SECURITY.md` and `docs/privacy-and-security.md`.

## Report Formats

Reports are deterministic JSON plus autonomous HTML/PDF. CI exports support JSON, Markdown, GitHub workflow commands, and JUnit XML.

## Troubleshooting

Run `npx codex-seo doctor --json`. Missing Chromium is fixed with `npx playwright install chromium`.

## Limitations

Release impact remains observational without deployment metadata. Optional remote adapters depend on provider availability and quotas.

## Architecture

See `docs/architecture.md`.

## Contribution

See `CONTRIBUTING.md`.

## License

MIT.

## Codex project workflow (1.1.1)

Install and initialize once:

    npm install --save-dev codex-seo
    npx codex-seo init --yes

The project-scoped MCP then provides configured quick/standard/full audits, controlled Git edits, validation, preview, Lighthouse/GSC integration, persistent workflow state, release staging, SSH/SFTP deployment, health checks, production regression evaluation, and rollback. Production activation requires explicit confirmation by default.

Configure a generic remote target without storing secrets:

    npx codex-seo configure deployment --provider ssh --host-env DEPLOY_HOST --user-env DEPLOY_USER --path-env DEPLOY_PATH --artifact-path dist --auth agent

Strict host verification requires a SHA256 fingerprint or ignored known_hosts file. See docs/ssh-sftp.md and docs/hostinger.md. Diagnose with npx codex-seo plugin doctor and update managed project plugin files non-destructively with npx codex-seo plugin update.

In Codex, ask: "Analyze this project, correct important SEO problems, validate the changes, and prepare deployment."