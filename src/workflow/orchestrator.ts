import { readFile } from "node:fs/promises";
import { detectProject } from "../project/detect.js";
import { createSnapshot, createWorkBranch, getGitStatus, gitDiff, initializeGit, commitChanges } from "../project/git.js";
import { runConfiguredAudit } from "../project/audit-runner.js";
import { runProjectValidation } from "../project/validation.js";
import { startPreview, stopPreview } from "../project/preview.js";
import { deploymentActivate, deploymentHealthCheck, deploymentPrepare, deploymentRollback, deploymentUploadStaging } from "../project/deployment.js";
import { compareConfiguredReports } from "../project/audit-comparison.js";
import { defaultGateOptions } from "../diff/quality-gate.js";
import { evaluateRegression } from "../deployment/regression.js";
import { LocalLogStore } from "../observability/logs.js";
import type { ProjectConfig } from "../project/config.js";
import { WorkflowStore, type StartWorkflowOptions, type WorkflowState } from "./store.js";

export class SeoWorkflowOrchestrator {
  private readonly store: WorkflowStore;
  private readonly logs: LocalLogStore;

  constructor(private readonly projectRoot: string, private readonly config: ProjectConfig) {
    this.store = new WorkflowStore(projectRoot, config);
    this.logs = new LocalLogStore(projectRoot);
  }

  async start(options: StartWorkflowOptions = {}): Promise<WorkflowState> {
    let state = await this.store.start(options);
    try {
      const detection = await detectProject(this.projectRoot);
      state = await this.store.transition(state.id, "git", { details: { framework: detection.framework, confidence: detection.confidence } });
      let git = await getGitStatus(this.projectRoot);
      if (!git.repository && this.config.git.enabled && this.config.git.autoInitialize) git = await initializeGit(this.projectRoot, this.config.git.defaultBranch);
      if (this.config.git.requireCleanTree && !git.clean) throw Object.assign(new Error("Project policy requires a clean Git tree"), { code: "workflow.git-dirty" });
      state = await this.store.transition(state.id, "audit-before");
      const audit = await runConfiguredAudit(this.projectRoot, this.config, { profile: state.mode, target: "production" });
      state.reports.before = audit.reportPath;
      await this.store.save(state);
      state = await this.store.transition(state.id, "plan", { details: { score: audit.score, components: audit.components } });
      if (!this.config.automation.createSnapshotWithoutConfirmation) {
        return await this.store.transition(state.id, "snapshot", { status: "awaiting-confirmation", event: "snapshot-confirmation-required" });
      }
      const snapshot = await createSnapshot(this.projectRoot, { description: "Before automated SEO workflow", auditBefore: audit.reportPath, confirmed: true });
      state.snapshotId = snapshot.id;
      await this.store.save(state);
      state = await this.store.transition(state.id, "branch");
      if (this.config.git.createWorkBranches && this.config.automation.createBranchWithoutConfirmation) {
        const branch = await createWorkBranch(this.projectRoot);
        state.branch = branch.branch;
        await this.store.save(state);
      }
      state = await this.store.transition(state.id, "awaiting-fixes", { status: "awaiting-action", event: "codex-fixes-required", details: { instruction: "Apply bounded fixes with controlled project tools, then advance the workflow." } });
      await this.logs.write({ category: "workflow", event: "workflow-ready-for-fixes", success: true, workflowId: state.id, details: { snapshotId: state.snapshotId, branch: state.branch } });
      return state;
    } catch (error) {
      state.status = "failed";
      state.error = { code: typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "workflow.start-failed", message: error instanceof Error ? error.message : String(error) };
      state.history.push({ at: new Date().toISOString(), stage: state.stage, status: "failed", event: "workflow-failed", details: { code: state.error.code } });
      await this.store.save(state);
      await this.logs.write({ category: "workflow", event: "workflow-start-failed", success: false, workflowId: state.id, details: state.error });
      throw error;
    }
  }

  async advanceAfterFixes(id: string): Promise<WorkflowState> {
    let state = await this.store.read(id);
    if (state.stage !== "awaiting-fixes") throw Object.assign(new Error("Workflow is not waiting for code fixes"), { code: "workflow.stage-invalid" });
    state = await this.store.transition(id, "validation");
    const validation = await runProjectValidation(this.projectRoot, this.config);
    if (!validation.passed) {
      state.status = "failed";
      state.error = { code: "workflow.validation-failed", message: "One or more required validation steps failed" };
      await this.store.save(state);
      return state;
    }
    state = await this.store.transition(id, "preview");
    let preview: Awaited<ReturnType<typeof startPreview>> | undefined;
    try {
      preview = await startPreview(this.projectRoot, this.config);
      state = await this.store.transition(id, "audit-preview");
      const audit = await runConfiguredAudit(this.projectRoot, this.config, { profile: state.mode, target: "preview", url: preview.url });
      state.reports.preview = audit.reportPath;
      await this.store.save(state);
    } finally {
      if (preview) await stopPreview(preview.id).catch(() => undefined);
    }
    state = await this.store.transition(id, "comparison");
    if (state.reports.before && state.reports.preview) {
      const comparison = await compareConfiguredReports(state.reports.before, state.reports.preview, defaultGateOptions);
      state.history.push({ at: new Date().toISOString(), stage: state.stage, status: state.status, event: "audit-compared", details: { passed: comparison.passed, scoreDelta: comparison.scoreDelta } });
      await this.store.save(state);
    }
    state = await this.store.transition(id, "diff");
    const diff = await gitDiff(this.projectRoot);
    const git = await getGitStatus(this.projectRoot);
    if (state.options.autoCommit && this.config.automation.commitWithoutConfirmation && git.changes.length > 0) {
      state = await this.store.transition(id, "commit");
      await commitChanges(this.projectRoot, "fix(seo): apply validated SEO improvements", true);
    }
    if (state.options.prepareDeployment && this.config.automation.prepareDeploymentWithoutConfirmation) {
      state = await this.store.transition(id, "release", { details: { diffBytes: Buffer.byteLength(diff) } });
      const prepared = await deploymentPrepare(this.projectRoot, this.config);
      if (!prepared.success) throw Object.assign(new Error("Deployment preparation failed"), { code: "workflow.release-prepare-failed" });
      if (this.config.deployment.provider !== "none") {
        const staged = await deploymentUploadStaging(this.projectRoot, this.config);
        state.releaseId = typeof staged.summary.releaseId === "string" ? staged.summary.releaseId : undefined;
        await this.store.save(state);
      }
    }
    if (this.config.deployment.provider === "none") {
      return await this.store.transition(id, "completed", { status: "completed", event: "workflow-completed-without-deployment" });
    }
    state = await this.store.transition(id, "awaiting-deployment-confirmation", {
      status: "awaiting-confirmation",
      event: "deployment-confirmation-required",
      details: { releaseId: state.releaseId }
    });
    return state;
  }

  async deploy(id: string, confirmed: boolean): Promise<WorkflowState> {
    let state = await this.store.read(id);
    if (state.stage !== "awaiting-deployment-confirmation" || !state.releaseId) throw Object.assign(new Error("Workflow has no staged release awaiting deployment"), { code: "workflow.release-missing" });
    if (this.config.automation.deployRequiresConfirmation && !confirmed) throw Object.assign(new Error("Explicit deployment confirmation is required"), { code: "confirmation.required" });
    const releaseId = state.releaseId;
    state = await this.store.transition(id, "deployment", { status: "active" });
    const activated = await deploymentActivate(this.projectRoot, this.config, releaseId, true);
    if (!activated.success) return await this.rollbackAfterFailure(state, "Release activation failed");
    state = await this.store.transition(id, "health-checks");
    const health = await deploymentHealthCheck(this.config, this.projectRoot);
    if (!health.success) return await this.rollbackAfterFailure(state, "Post-deployment health checks failed");
    state = await this.store.transition(id, "audit-production");
    let production;
    try {
      production = await runConfiguredAudit(this.projectRoot, this.config, { profile: state.mode, target: "production" });
      state.reports.production = production.reportPath;
      await this.store.save(state);
    } catch {
      return await this.rollbackAfterFailure(state, "Production audit could not start after deployment");
    }
    if (state.reports.before && state.reports.production) {
      const before = JSON.parse(await readFile(state.reports.before, "utf8"));
      const after = JSON.parse(await readFile(state.reports.production, "utf8"));
      const regression = evaluateRegression(before, after, this.config);
      state.history.push({ at: new Date().toISOString(), stage: state.stage, status: state.status, event: "production-regression-evaluated", details: { ...regression } });
      await this.store.save(state);
      if (regression.rollbackRequired) return await this.rollbackAfterFailure(state, "Severe SEO regression detected after deployment");
    }
    state = await this.store.transition(id, "completed", { status: "completed", event: "workflow-completed", details: { releaseId: state.releaseId, productionScore: production.score } });
    await this.logs.write({ category: "workflow", event: "workflow-completed", success: true, workflowId: id, releaseId: state.releaseId });
    return state;
  }

  private async rollbackAfterFailure(state: WorkflowState, cause: string): Promise<WorkflowState> {
    let rollbackError: string | undefined;
    try {
      await deploymentRollback(this.projectRoot, this.config, true, state.releaseId);
    } catch (error) {
      rollbackError = error instanceof Error ? error.message : String(error);
    }
    state.status = "failed";
    state.error = { code: rollbackError ? "workflow.rollback-failed" : "workflow.deployment-rolled-back", message: rollbackError ? cause + "; rollback failed: " + rollbackError : cause };
    state.history.push({ at: new Date().toISOString(), stage: state.stage, status: "failed", event: "automatic-rollback", details: { cause, rollbackSucceeded: !rollbackError, rollbackError } });
    await this.store.save(state);
    await this.logs.write({ category: "rollback", event: "workflow-automatic-rollback", success: !rollbackError, workflowId: state.id, releaseId: state.releaseId, details: { cause, rollbackError } });
    return state;
  }

  workflowStore(): WorkflowStore {
    return this.store;
  }
}
