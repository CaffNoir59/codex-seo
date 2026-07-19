# Changelog

All notable changes to Codex SEO are documented here.

## [1.1.0] - 2026-07-19

### Added
- Real generic SSH/SFTP transport using SSH agent or ignored local keys with strict fingerprint/known_hosts verification.
- Verified remote releases, symlink and rename/copy activation, snapshots, manifests, retention, detailed health checks, regression policy, and automatic rollback incidents.
- Configured quick/standard/full MCP audits with Lighthouse and GSC adapter states.
- Persistent workflow_fix_seo orchestration with resume, cancellation, inspection, cleanup, and restore requests.
- Idempotent configure commands, plugin doctor/update, rotated structured logs, public SSH/Hostinger/development/release guides, and publication checks.

### Changed
- Configuration schema migrates automatically from 1.0.0 to 1.1.0.
- Plugin, skill, npm package, MCP metadata, and documentation are synchronized at 1.1.0.

### Security
- Remote paths reject traversal and shell metacharacters; no arbitrary remote shell is exposed.
- Production activation remains confirmation-gated and credentials remain external to public configuration.
## [1.0.0] - 2026-07-18

### Added
- Stable CLI with audit, diff, history, gsc, init, validate, doctor, migrate, and version commands.
- Versioned configuration, schema registry, migrations, history trends, CI exports, and GitHub Actions examples.
- JUnit, GitHub annotation, Markdown, and JSON CI exports.
- Packaging metadata for npm distribution.

### Security
- URL safety, redaction helpers, path safety checks, and privacy-mode guidance.