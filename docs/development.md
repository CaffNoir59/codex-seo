# Development guide

Requirements: Node.js 20 or newer and Git.

    npm install
    npm run typecheck
    npm run lint
    npm test
    npm run validate
    npm run build

SSH/SFTP tests use temporary in-process servers or in-memory transports and never require a public host. Keep new fixtures neutral, deterministic, and cross-platform. Do not add local reports, histories, credentials, logs, backups, keys, or deployment targets.

Before proposing a change, run check:sensitive and publish:check. Public APIs live under src/index.ts. Preserve strict TypeScript, bounded commands, safe paths, structured errors, redaction, and the production confirmation boundary.