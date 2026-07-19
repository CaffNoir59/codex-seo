# Maintainer release guide

1. Update package, lockfile, plugin manifest, changelog, schemas, and docs to one version.
2. Run npm install, typecheck, lint, test, validate, build, npm audit, check:sensitive, release:check, publish:check, and npm pack --dry-run.
3. Inspect the dry-run tarball for only runtime build, executables, plugin, skills, docs, examples, templates, metadata, and licenses.
4. Install the tarball into a temporary project; run init, MCP initialize/tools-list, doctor, and plugin doctor.
5. Verify no real host, account, domain, email, personal path, credential, report, or history is present.
6. Create a release only after CI and human review.

The repository scripts prepare and validate artifacts. They do not publish to npm or push to GitHub.