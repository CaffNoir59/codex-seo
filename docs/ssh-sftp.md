# Generic SSH/SFTP deployment

Codex SEO 1.1 uses the ssh2 runtime and SFTP operations for files. It supports an SSH agent or an ignored local private-key file. Plain-text passwords are not accepted.

Configure with environment references:

    npx codex-seo configure deployment --provider ssh --host-env DEPLOY_HOST --user-env DEPLOY_USER --path-env DEPLOY_PATH --artifact-path dist --auth agent --release-strategy auto

Set DEPLOY_HOST, DEPLOY_USER, and DEPLOY_PATH in the process environment or an ignored local mechanism. Key mode accepts --private-key-path and optional --passphrase-env; the passphrase value remains outside configuration.

Strict host verification is enabled by default. Add either a SHA256 fingerprint or an ignored known_hosts path under deployment.hostVerification. A connection is refused when no verification evidence is present, when the fingerprint differs, or when authentication fails.

The remote root contains current, releases, shared, backups, and staging. Auto mode probes symlink support; otherwise controlled rename/copy activation is used. File upload, directory creation, listing, presence checks, checksum, rename, copy, permissions, timestamp preservation, and recursive controlled removal use SFTP. Remote command execution is restricted to php-version, node-version, disk-space, and current-release. No arbitrary shell is available through MCP.

Production deployment always follows configured confirmation policy. Automatic rollback after a failed activation, health check, marker check, production audit, or severe regression uses the verified previous release or backup and writes a redacted incident log.