# Codex SEO Agent Instructions

Use this repository as a native Codex SEO framework. Prefer project commands over ad hoc scripts.

Core commands:

```bash
npm run validate
npm test
npm run build
npm run audit -- https://example.com
```

Rules:

- Do not bypass `src/core/url-safety.ts` for network requests.
- Reuse `AuditContext` instead of fetching the same page repeatedly.
- Emit deterministic `SeoIssue` objects only.
- Keep external API adapters optional and explicit.
- Treat GEO checks as heuristics unless backed by primary external data.
