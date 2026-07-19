---
name: codex-seo
description: Native Codex SEO audit orchestrator for complete website or page analysis using shared audit context, specialized Agent Skills, Node.js ESM scripts, deterministic JSON, and local HTML/PDF reports. Use for SEO audits, technical SEO, content quality, schema, sitemap, image SEO, GEO or AI-search readiness, Core Web Vitals, PageSpeed, CrUX, and performance regressions.
---

# Codex SEO Orchestrator

Use this skill when the request needs a complete SEO audit or when multiple SEO modules should be coordinated.

## Inputs

- A public HTTP or HTTPS URL.
- Optional flags: `--render` to force Playwright rendering, `--pdf` to generate a PDF from HTML, `--performance` to add local or remote performance analysis.
- Optional scope notes from the user, such as technical-only or content-only.

## Analysis Steps

1. Validate the target URL with `src/core/url-safety.ts`.
2. Fetch the page once with `undici`.
3. Render with Playwright only when forced or when the fetched HTML is empty, thin, or JavaScript-shell-like.
4. Parse the final HTML once with Cheerio and create one shared audit context.
5. Select the mode: mono-page audit by default, sitewide crawl when the user asks for a full site audit or passes `--crawl`, targeted audit when the user specifies modules, or report-only when existing JSON is provided.
6. For mono-page audits, run technical, content, schema, sitemap, images, and geo.
7. For sitewide audits, run the crawler, page analyzers, and sitewide analyzers: site architecture, internal linking, indexability, duplicate content, and optional performance sampling.
8. Run independent analyzers in parallel when they can share the same context.
9. Avoid duplicate crawls. Reuse fetch, render, parse, headers, redirects, sitemap, and robots evidence.
10. Aggregate results, sort issues by severity/category/id, calculate deterministic scores including optional performance score, and write reports.
11. Explicitly record analyzer errors and skipped modules in the final report.

Read these references for specialist behavior when needed:

- `references/agents/technical-agent.md`
- `references/agents/content-agent.md`
- `references/agents/schema-agent.md`
- `references/agents/sitemap-agent.md`
- `references/agents/images-agent.md`
- `references/agents/geo-agent.md`
- `references/agents/report-agent.md`

## Output Format

Produce:

- `reports/<domain>/report.json`
- `reports/<domain>/report.html`
- `reports/<domain>/report.pdf` only when `--pdf` is requested

Every issue must match the stable `SeoIssue` schema.

## Known Limits

Codex SEO measures local lab performance by default and optional PageSpeed/CrUX data when configured. It does not measure rankings, traffic, Search Console status, or AI citation share without external adapters.

## Project Commands

```bash
npm run audit -- https://example.com
npm run audit -- https://example.com --pdf
npm run audit -- https://example.com --crawl --max-pages 100 --max-depth 4
npm run audit -- https://example.com --crawl --render always --pdf
npm run audit -- https://example.com --performance --performance-mode local
npm run audit -- https://example.com --crawl --performance --performance-sample-pages 5
npm run validate
npm test
npm run build
```

## Baseline, Diff, and Regression Workflows

Use `seo-baseline` when the user asks to create or update a named SEO baseline.
Use `seo-diff` when the user asks to compare audits, reports, or baselines.
Use seo-regression when the user asks whether a release can deploy without SEO regressions or asks for critical/high regressions only.
Use seo-performance, seo-core-web-vitals, or seo-pagespeed for performance, CWV, PageSpeed, or CrUX-specific work.

Prefer these commands:

```bash
npm run audit -- https://example.com --crawl --save-baseline production
npm run audit -- https://example.com --crawl --compare-baseline production
npm run diff -- previous.json current.json --html --pdf --fail-on-regression
```

Apply ignore options for known false positives:

```bash
npm run diff -- previous.json current.json --ignore-url /preview/ --ignore-category content
```
## Google Search Console Workflows

Trigger the GSC skills when users ask to:

- Analyse les performances Google Search Console de ce site.
- Trouve les pages avec beaucoup d'impressions et un CTR faible.
- Croise les donnees GSC avec le crawl technique.
- Montre les pages en perte de trafic depuis 28 jours.
- Inspecte dans Google les pages a fort trafic ayant des problemes de canonical.
- Priorise les corrections SEO selon leur impact reel.
- Compare la periode actuelle aux 28 jours precedents.
- Ignore les requetes de marque.
- Masque les requetes sensibles dans le rapport.

Prefer `npm run audit -- <url> --crawl --performance --gsc --gsc-property <property>` for complete analysis, and keep credentials out of reports/logs.

## Historical Workflows

Trigger the historical skills when users ask to:

- Sauvegarde cet audit dans l'historique local.
- Montre l'evolution SEO sur les 12 derniers audits.
- Compare la derniere release a la precedente.
- Trouve les regressions SEO recurrentes.
- Compare production et staging.
- Exporte un resume CI longitudinal.
- Migre les anciens baselines vers le nouveau format historique.
- Prune l'historique en dry-run avant suppression.

Use seo-history for storage/import/export/migration/prune, seo-trends for time series and historical gates, seo-release-impact for release comparisons, seo-recurring-regressions for reintroduced issues, and seo-environment-comparison for production/staging drift.

Prefer these commands:

```bash
npm run audit -- https://example.com --crawl --save-history --environment production --release v1.4.0 --commit abc1234
npm run history -- trend --last 12 --fail-on-negative-trend
npm run history -- compare-releases v1.3.0 v1.4.0
npm run history -- compare-environments staging production
npm run history -- export-ci --format github
```
## V1 Setup, CI, Doctor, And Release Workflows

Trigger setup/CI/release skills when users ask:

- Initialise Codex SEO dans ce projet.
- Cree un workflow GitHub Actions pour auditer ce site chaque semaine.
- Verifie que l'installation Codex SEO est prete.
- Prepare la release 1.0.0 sans la publier.
- Valide et migre cette ancienne baseline.
- Genere un rapport JUnit pour la CI.
- Analyse pourquoi le quality gate a echoue.
- Execute un audit en sortie JSON silencieuse.

Use codex-seo-setup for init/config, codex-seo-ci for workflows and CI exports, codex-seo-doctor for readiness checks, codex-seo-release for non-destructive release checks, and codex-seo-migration for schema migration.