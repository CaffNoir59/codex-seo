---
name: seo-maintainer
description: Audit, fix, validate, release, deploy, compare, and roll back SEO changes safely with the Codex SEO MCP. Use for simple requests to analyze a project, correct important SEO problems, prepare or deploy a release, compare preview with production, or restore the previous release.
---

# SEO Maintainer

Use Codex SEO MCP tools instead of asking the user to run Git, preview, audit, Lighthouse, or deployment commands manually.

## Start or resume the workflow

1. Call project_status, project_detect, and project_doctor.
2. Inspect active workflows with workflow_manage action list. Resume a relevant interrupted workflow; do not duplicate it.
3. For a new audit-and-fix request, call workflow_fix_seo action start. Choose quick, standard, or full from the request; use standard by default.
4. Let the orchestrator perform reversible work allowed by automation: doctor, Git initialization, audit, snapshot, branch, validation, preview, comparison, commit, and release preparation.
5. When the workflow reaches awaiting-fixes, classify the reported issues by severity, confidence, and ownership. Use safe search/read tools and bounded project_apply_patch edits. Never invent code changes or SEO evidence.
6. Call workflow_fix_seo action advance after fixes. Respect the configured iteration limit and stop if a required check fails.

A skipped or unavailable audit adapter is not passed. Report configured, unavailable, skipped, failed, and passed exactly as returned. Run GSC only when configured. Run Lighthouse when the profile or configuration enables it.

## Confirmation boundary

Continue reversible local operations automatically when policy allows. Ask one explicit conversational question only when the workflow reaches awaiting-deployment-confirmation, showing:

- validation results and skipped checks;
- before/preview score and regressions;
- Git diff and commit;
- provider, target, release identifier, strategy, snapshot, and rollback target;
- health checks and post-deployment audit plan.

Call workflow_fix_seo action deploy with confirmed true only after explicit confirmation. Never treat an earlier generic request as deployment confirmation when policy requires a separate boundary.

Manual restore, rollback, release deletion, destructive cleanup, data migration, and Git push require their configured confirmation. There is no arbitrary remote shell tool.

## Deployment behavior

For SSH/SFTP, require a real successful connection and strict host verification evidence. Never weaken host verification to make deployment pass. Credentials must come from the SSH agent, an ignored local key, an environment passphrase, or the system credential mechanism. Never read, display, or copy a secret.

The release flow is prepare, verified remote snapshot, staging upload, file verification, shared paths, release activation, detailed health checks, production audit, regression evaluation, retention cleanup. Symlink activation is preferred; rename/copy fallback is valid when the host lacks symlink support.

After activation, automatic rollback is permitted by policy when activation, health checks, marker verification, production audit, or severe regression fails. Preserve and report the original failure. Report whether rollback succeeded and include the redacted incident summary. Never claim a snapshot, upload, activation, health result, audit, or rollback that was not verified.

## Direct requests

- ?Analyze this project?: run a configured audit with the suitable profile.
- ?Fix the SEO problems?: start or resume workflow_fix_seo.
- ?Prepare a release?: advance a validated workflow through release staging.
- ?Deploy the validated release?: inspect the workflow, present the confirmation boundary, then deploy only after confirmation.
- ?Return to the previous version?: inspect releases and request confirmation for manual rollback.
- ?Compare production with preview?: run both configured audits and use report comparison.

## Guardrails

- Do not remove or weaken an SEO rule merely to raise a score.
- Do not add generic content, keyword stuffing, fake structured data, or score-gaming changes.
- Do not alter design or behavior unless verified evidence requires it.
- Do not bypass failed validation, incomplete audits, host verification, regression policy, or confirmation policy.
- Do not access protected files, paths outside the project, inline passwords, tokens, private keys, or remote arbitrary commands.
- Do not hide partial crawls, unavailable adapters, skipped checks, regressions, deployment failures, or rollback failures.
- Use project_logs for redacted local diagnostics and workflow_manage to inspect, resume, cancel, restore, or clean state.
- Finish with a clear report: evidence before/after, files changed, validations, audits, release, health, production regression result, rollback state, and remaining limitations.
