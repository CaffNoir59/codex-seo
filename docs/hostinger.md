# Hostinger with the generic provider

Hostinger is not a special Codex SEO provider. Use the generic SSH or SFTP configuration.

1. In the hosting control panel, locate the SSH hostname, username, port, and document-root path.
2. Export those values locally as DEPLOY_HOST, DEPLOY_USER, and DEPLOY_PATH. Do not commit their values.
3. Choose DEPLOY_PATH as the parent that may safely contain current, releases, shared, backups, and staging. Confirm it with the hosting documentation before deployment.
4. Configure agent or ignored key authentication. Do not store an account password.
5. Copy the published server fingerprint into deployment.hostVerification.fingerprint, or point knownHostsPath to an ignored known_hosts file.
6. Run codex-seo plugin doctor or deployment_status to test configuration and connection.
7. Use releaseStrategy auto. If symlinks are unavailable, Codex SEO selects the directory fallback.
8. Deploy only after the release summary and rollback target are shown. For a manual rollback, inspect the workflow/release and confirm deployment_rollback.

The locations and labels in a hosting panel can change; follow the host's current SSH documentation. No account-specific value belongs in the public configuration.