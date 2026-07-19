import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { runAudit } from "../orchestrator/audit.js";
import { compareReportFiles } from "../diff/compare-reports.js";
import { crawlSite } from "../crawler/crawler.js";
import { buildSitewideReport, writeSitewideReport } from "../reporting/sitewide-report.js";
import { defaultGateOptions } from "../diff/quality-gate.js";
import { historyEntrySchema } from "../history/history-schema.js";
import { compareHistoryCompatibility } from "../history/history-compatibility.js";
import { redactObject } from "../core/redaction.js";
import { getVersion } from "../version.js";
import { loadProjectConfig, publicConfigView, type LoadedProjectConfig } from "../project/config.js";
import { detectProject } from "../project/detect.js";
import { readProjectFile, resolveProjectPath } from "../security/project-policy.js";
import { searchProject, applyControlledEdits, type ControlledEdit } from "../project/files.js";
import { getGitStatus, initializeGit, createSnapshot, createWorkBranch, gitDiff, commitChanges, restoreSnapshot, listSnapshots } from "../project/git.js";
import { runProjectValidation } from "../project/validation.js";
import { startPreview, stopPreview, stopAllPreviews, listPreviews } from "../project/preview.js";
import { deploymentStatus, deploymentPrepare, deploymentCreateSnapshot, deploymentUploadStaging, deploymentActivate, deploymentHealthCheck, deploymentRollback } from "../project/deployment.js";
import { runConfiguredAudit } from "../project/audit-runner.js";
import { LocalLogStore, type LogCategory } from "../observability/logs.js";
import { SeoWorkflowOrchestrator } from "../workflow/orchestrator.js";
import { compareConfiguredReports } from "../project/audit-comparison.js";
import { configureProject } from "../project/configure.js";
import { updateProjectPlugin } from "../plugin/manage.js";

type JsonObject = Record<string, unknown>;
type ToolDefinition = { name: string; description: string; inputSchema: JsonObject; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; _meta: { confirmationRequired: boolean; reversible: boolean; timeoutMs: number } };
type McpResult = { success: boolean; operation: string; summary: JsonObject; results?: unknown; warnings: string[]; code?: string; confirmationRequired?: boolean; reversible?: boolean };

const objectSchema = (properties: JsonObject = {}, required: string[] = []): JsonObject => ({ type: "object", properties, required, additionalProperties: false });
const stringProperty = { type: "string" };
const booleanProperty = { type: "boolean", default: false };

function definition(name: string, description: string, properties: JsonObject = {}, required: string[] = [], readOnly = true, destructive = false): ToolDefinition {
  return { name, description, inputSchema: objectSchema(properties, required), annotations: { readOnlyHint: readOnly, destructiveHint: destructive }, _meta: { confirmationRequired: Object.prototype.hasOwnProperty.call(properties, "confirmed"), reversible: !destructive, timeoutMs: 300_000 } };
}

export const toolDefinitions: ToolDefinition[] = [
  definition("project_status", "Read configuration, Git, preview, and deployment status."),
  definition("project_detect", "Detect project framework, package manager, scripts, and supporting files.", { projectRoot: stringProperty }),
  definition("project_doctor", "Run a structured project readiness diagnosis."),
  definition("project_read_config", "Read the resolved configuration with secrets redacted."),
  definition("project_configure", "Idempotently configure deployment, automation, audit, or project MCP with a backup.", { section: { type: "string", enum: ["deployment", "automation", "audit", "mcp"] }, provider: { type: "string", enum: ["none", "local-directory", "ssh", "sftp"] }, hostEnv: stringProperty, userEnv: stringProperty, pathEnv: stringProperty, port: { type: "integer", minimum: 1, maximum: 65535 }, auth: { type: "string", enum: ["agent", "key"] }, privateKeyPath: stringProperty, passphraseEnv: stringProperty, artifactPath: stringProperty, localPath: stringProperty, releaseStrategy: { type: "string", enum: ["auto", "symlink", "rename", "copy"] }, healthCheckUrl: stringProperty, crawl: booleanProperty, performance: booleanProperty, dryRun: booleanProperty, confirmed: booleanProperty }, ["section", "confirmed"], false),
  definition("project_logs", "List redacted rotated local structured logs.", { category: stringProperty, limit: { type: "integer", minimum: 1, maximum: 1000 } }),
  definition("seo_audit_site", "Run a configured quick, standard, full, preview, or production site audit.", { url: stringProperty, profile: { type: "string", enum: ["quick", "standard", "full"] }, target: { type: "string", enum: ["configured", "preview", "production"] }, lighthouse: booleanProperty, gsc: booleanProperty }),
  definition("seo_audit_page", "Audit one configured page, optionally with Lighthouse.", { url: stringProperty, profile: { type: "string", enum: ["quick", "standard", "full"] }, target: { type: "string", enum: ["configured", "preview", "production"] }, lighthouse: booleanProperty, gsc: booleanProperty }),
  definition("seo_read_latest_report", "Read the newest JSON report."),
  definition("seo_list_reports", "List project JSON reports."),
  definition("seo_get_issues", "Read issues from the newest report."),
  definition("seo_compare_reports", "Compare two report files.", { previous: stringProperty, current: stringProperty }, ["previous", "current"]),
  definition("seo_get_history", "List local history entries."),
  definition("seo_compare_history", "Compare two history report files.", { previous: stringProperty, current: stringProperty }, ["previous", "current"]),
  definition("git_status", "Read local Git status."),
  definition("git_initialize", "Initialize local Git.", { confirmed: booleanProperty }, ["confirmed"], false),
  definition("git_create_snapshot", "Create a local safety snapshot commit.", { description: stringProperty, auditBefore: stringProperty, confirmed: booleanProperty }, ["confirmed"], false),
  definition("git_create_work_branch", "Create a codex-seo work branch.", { name: stringProperty, confirmed: booleanProperty }, ["confirmed"], false),
  definition("git_diff", "Read the current Git diff.", { staged: booleanProperty }),
  definition("git_commit", "Commit local changes.", { message: stringProperty, confirmed: booleanProperty }, ["message", "confirmed"], false),
  definition("git_restore_snapshot", "Restore tracked files from a snapshot.", { snapshotId: stringProperty, confirmed: booleanProperty }, ["snapshotId", "confirmed"], false, true),
  definition("git_list_snapshots", "List local safety snapshots."),
  definition("project_search", "Search text inside safe project files.", { query: stringProperty, filePattern: stringProperty }, ["query"]),
  definition("project_read_file", "Read a safe non-secret project file.", { path: stringProperty }, ["path"]),
  definition("project_apply_patch", "Apply exact controlled replacements after a Git snapshot.", { edits: { type: "array", items: objectSchema({ path: stringProperty, find: stringProperty, replace: stringProperty, expectedOccurrences: { type: "integer", minimum: 1 } }, ["path", "find", "replace"]) }, snapshotId: stringProperty, confirmed: booleanProperty }, ["edits", "snapshotId", "confirmed"], false),
  definition("project_run_validation", "Run configured validation steps.", { steps: { type: "array", items: stringProperty } }, [], false),
  definition("project_build", "Run the configured build validation step.", {}, [], false),
  definition("project_start_preview", "Start and wait for the configured preview.", {}, [], false),
  definition("project_stop_preview", "Stop a managed preview process.", { previewId: stringProperty }, ["previewId"], false),
  definition("workflow_analyze", "Collect audit issues, Git state, and project evidence."),
  definition("workflow_prepare_fix", "Create a safety snapshot and work branch.", { confirmed: booleanProperty }, ["confirmed"], false),
  definition("workflow_validate_fix", "Run validation and return Git diff.", {}, [], false),
  definition("workflow_compare_before_after", "Compare before and after reports.", { before: stringProperty, after: stringProperty }, ["before", "after"]),
  definition("workflow_fix_seo", "Start, advance, or deploy the persistent high-level SEO fix workflow.", { action: { type: "string", enum: ["start", "advance", "deploy"] }, workflowId: stringProperty, mode: { type: "string", enum: ["quick", "standard", "full"] }, target: { type: "string", enum: ["preview", "production"] }, autoApply: booleanProperty, autoCommit: booleanProperty, prepareDeployment: booleanProperty, deployAfterConfirmation: booleanProperty, confirmed: booleanProperty }, ["action"], false),
  definition("workflow_manage", "List, inspect, resume, cancel, request restore, or clean persistent workflows.", { action: { type: "string", enum: ["list", "inspect", "resume", "cancel", "restore", "clean"] }, workflowId: stringProperty, confirmed: booleanProperty }, ["action"]),
  definition("deployment_status", "Read deployment adapter status."),
  definition("deployment_prepare", "Validate the configured artifact and deployment target."),
  definition("deployment_create_snapshot", "Create a deployment snapshot.", { confirmed: booleanProperty }, ["confirmed"], false),
  definition("deployment_upload_staging", "Upload an artifact into staging.", { confirmed: booleanProperty }, ["confirmed"], false),
  definition("deployment_activate_release", "Activate a prepared release.", { releaseId: stringProperty, confirmed: booleanProperty }, ["releaseId", "confirmed"], false, true),
  definition("deployment_health_check", "Run the configured HTTP health check."),
  definition("deployment_rollback", "Roll back to the previous release.", { releaseId: stringProperty, confirmed: booleanProperty }, ["confirmed"], false, true)
];

function response(operation: string, summary: JsonObject, results?: unknown, warnings: string[] = []): McpResult {
  return { success: true, operation, summary, ...(results === undefined ? {} : { results }), warnings };
}

function failure(operation: string, error: unknown): McpResult {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? String((error as { code: string }).code)
    : /confirmation/i.test(error instanceof Error ? error.message : String(error)) ? "confirmation.required" : "operation.failed";
  return {
    success: false,
    operation,
    code,
    confirmationRequired: code === "confirmation.required",
    reversible: !["deployment_activate_release", "deployment_rollback", "git_restore_snapshot"].includes(operation),
    summary: { error: error instanceof Error ? error.message : String(error), code },
    warnings: []
  };
}

async function configured(cwd: string, explicit?: string): Promise<LoadedProjectConfig & { config: NonNullable<LoadedProjectConfig["config"]> }> {
  const loaded = await loadProjectConfig({ cwd, configPath: explicit });
  if (!loaded.config) throw new Error(loaded.diagnostics.map((item) => item.path + ": " + item.received).join("; ") || "Valid project configuration is required");
  return loaded as LoadedProjectConfig & { config: NonNullable<LoadedProjectConfig["config"]> };
}

async function listJsonFiles(root: string, relativeDirectory: string, limit = 200): Promise<string[]> {
  const directory = await resolveProjectPath(root, relativeDirectory, { allowMissing: true, allowProtected: true });
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    if (output.length >= limit) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) output.push(full);
    }
  }
  await visit(directory);
  const records = await Promise.all(output.map(async (file) => ({ file, modified: (await stat(file)).mtimeMs })));
  return records.sort((a, b) => b.modified - a.modified).map((item) => path.relative(root, item.file).replace(/\\/g, "/"));
}

async function latestReport(loaded: Awaited<ReturnType<typeof configured>>): Promise<{ path: string; value: unknown }> {
  const reports = await listJsonFiles(loaded.root, loaded.config.output.dir);
  const report = reports.find((file) => !file.includes("/diff/") && !file.includes("diff-report"));
  if (!report) throw new Error("No JSON report is available");
  return { path: report, value: JSON.parse(await readProjectFile(loaded.root, report, 10_000_000)) };
}

function argsObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function explicitConfirmation(args: JsonObject, operation: string): void {
  if (args.confirmed !== true) throw new Error("Explicit confirmation is required for " + operation);
}
async function recordMcpAudit(cwd: string, configPath: string | undefined, operation: string, success: boolean): Promise<void> {
  const loaded = await loadProjectConfig({ cwd, configPath }).catch(() => undefined);
  if (!loaded?.config) return;
  await new LocalLogStore(loaded.root).write({ category: "mcp", event: operation, success });
}

export class CodexSeoMcpServer {
  constructor(private readonly cwd = process.cwd(), private readonly configPath?: string) {}

  async callTool(name: string, rawArguments: unknown): Promise<McpResult> {
    const args = argsObject(rawArguments);
    try {
      if (name === "project_detect") {
        const root = typeof args.projectRoot === "string" ? path.resolve(this.cwd, args.projectRoot) : this.cwd;
        const detection = await detectProject(root);
        return response(name, { framework: detection.framework, packageManager: detection.packageManager, confidence: detection.confidence }, detection);
      }
      const loaded = await configured(this.cwd, this.configPath);
      const config = loaded.config;
      const root = loaded.root;
      if (name === "project_read_config") return response(name, { valid: true, path: loaded.path ?? "" }, publicConfigView(config));
      if (name === "project_configure") {
        explicitConfirmation(args, name);
        const section = String(args.section ?? "") as "deployment" | "automation" | "audit" | "mcp";
        const configuredResult = section === "mcp"
          ? await updateProjectPlugin(root, args.dryRun === true)
          : await configureProject(section, {
              cwd: root,
              dryRun: args.dryRun === true,
              provider: args.provider as "none" | "local-directory" | "ssh" | "sftp" | undefined,
              hostEnv: typeof args.hostEnv === "string" ? args.hostEnv : undefined,
              userEnv: typeof args.userEnv === "string" ? args.userEnv : undefined,
              pathEnv: typeof args.pathEnv === "string" ? args.pathEnv : undefined,
              port: typeof args.port === "number" ? args.port : undefined,
              auth: args.auth as "agent" | "key" | undefined,
              privateKeyPath: typeof args.privateKeyPath === "string" ? args.privateKeyPath : undefined,
              passphraseEnv: typeof args.passphraseEnv === "string" ? args.passphraseEnv : undefined,
              artifactPath: typeof args.artifactPath === "string" ? args.artifactPath : undefined,
              localPath: typeof args.localPath === "string" ? args.localPath : undefined,
              releaseStrategy: args.releaseStrategy as "auto" | "symlink" | "rename" | "copy" | undefined,
              healthCheckUrl: typeof args.healthCheckUrl === "string" ? args.healthCheckUrl : undefined,
              crawl: typeof args.crawl === "boolean" ? args.crawl : undefined,
              performance: typeof args.performance === "boolean" ? args.performance : undefined
            });
        return response(name, { configured: true, dryRun: args.dryRun === true }, configuredResult);
      }
      if (name === "project_logs") {
        const logs = await new LocalLogStore(root).list({ category: typeof args.category === "string" ? args.category as LogCategory : undefined, limit: typeof args.limit === "number" ? args.limit : undefined });
        return response(name, { files: logs.length }, logs);
      }
      if (name === "git_status") return response(name, await getGitStatus(root) as unknown as JsonObject);
      if (name === "git_list_snapshots") {
        const snapshots = await listSnapshots(root);
        return response(name, { count: snapshots.length }, snapshots);
      }
      if (name === "project_status") {
        const [git, deployment] = await Promise.all([getGitStatus(root), deploymentStatus(root, config)]);
        return response(name, { configured: true, root, previews: listPreviews().length }, { git, deployment, diagnostics: loaded.diagnostics });
      }
      if (name === "project_doctor") {
        const [detection, git] = await Promise.all([detectProject(root), getGitStatus(root)]);
        return response(name, { ready: loaded.diagnostics.length === 0, diagnostics: loaded.diagnostics.length }, { detection, git, configPath: loaded.path });
      }
      if (name === "project_search") {
        const matches = await searchProject(root, String(args.query ?? ""), { filePattern: typeof args.filePattern === "string" ? args.filePattern : undefined });
        return response(name, { matches: matches.length }, matches);
      }
      if (name === "project_read_file") {
        const file = String(args.path ?? "");
        const content = await readProjectFile(root, file, config.security.allowedReadBytes);
        return response(name, { path: file, bytes: Buffer.byteLength(content) }, { content });
      }
      if (name === "project_apply_patch") {
        const edits = Array.isArray(args.edits) ? args.edits as ControlledEdit[] : [];
        const result = await applyControlledEdits(root, edits, { confirmed: args.confirmed === true, snapshotId: String(args.snapshotId ?? "") });
        return response(name, result as unknown as JsonObject, result);
      }
      if (name === "git_initialize") {
        explicitConfirmation(args, name);
        return response(name, await initializeGit(root, config.git.defaultBranch) as unknown as JsonObject);
      }
      if (name === "git_create_snapshot") {
        const snapshot = await createSnapshot(root, { description: typeof args.description === "string" ? args.description : undefined, auditBefore: typeof args.auditBefore === "string" ? args.auditBefore : undefined, confirmed: args.confirmed === true });
        return response(name, { id: snapshot.id, commit: snapshot.baseCommit }, snapshot);
      }
      if (name === "git_create_work_branch") {
        explicitConfirmation(args, name);
        const branch = await createWorkBranch(root, typeof args.name === "string" ? args.name : undefined);
        return response(name, branch as unknown as JsonObject);
      }
      if (name === "git_diff") {
        const diff = await gitDiff(root, args.staged === true);
        return response(name, { bytes: Buffer.byteLength(diff) }, { diff });
      }
      if (name === "git_commit") {
        const committed = await commitChanges(root, String(args.message ?? ""), args.confirmed === true);
        return response(name, committed as unknown as JsonObject);
      }
      if (name === "git_restore_snapshot") {
        const restored = await restoreSnapshot(root, String(args.snapshotId ?? ""), args.confirmed === true);
        return response(name, { restored: restored.id, commit: restored.rollbackTarget }, restored);
      }
      if (name === "project_run_validation" || name === "project_build") {
        const steps = name === "project_build" ? ["build"] : Array.isArray(args.steps) ? args.steps.map(String) : undefined;
        const validation = await runProjectValidation(root, config, steps);
        return { success: validation.passed, operation: name, code: validation.passed ? undefined : "validation.failed", summary: { passed: validation.passed, steps: validation.steps, durationMs: validation.durationMs }, results: validation.results, warnings: [] };
      }
      if (name === "project_start_preview") {
        const preview = await startPreview(root, config);
        return response(name, { started: true, id: preview.id, url: preview.url, pid: preview.pid }, preview);
      }
      if (name === "project_stop_preview") {
        const stopped = await stopPreview(String(args.previewId ?? ""));
        return response(name, stopped as unknown as JsonObject);
      }
      if (name === "seo_list_reports") {
        const reports = await listJsonFiles(root, config.output.dir);
        return response(name, { count: reports.length }, reports);
      }
      if (name === "seo_read_latest_report" || name === "seo_get_issues") {
        const report = await latestReport(loaded);
        if (name === "seo_read_latest_report") return response(name, { path: report.path }, redactObject(report.value, { privacyMode: true }));
        const value = report.value as { issues?: unknown[]; sitewideIssues?: unknown[]; pages?: Array<{ issues?: unknown[] }> };
        const issues = [...(value.issues ?? []), ...(value.sitewideIssues ?? []), ...(value.pages ?? []).flatMap((page) => page.issues ?? [])];
        return response(name, { path: report.path, count: issues.length }, redactObject(issues, { privacyMode: true }));
      }
      if (name === "seo_compare_history") {
        const previousPath = await resolveProjectPath(root, String(args.previous ?? ""));
        const currentPath = await resolveProjectPath(root, String(args.current ?? ""));
        const previous = historyEntrySchema.parse(JSON.parse(await readFile(previousPath, "utf8")));
        const current = historyEntrySchema.parse(JSON.parse(await readFile(currentPath, "utf8")));
        const compatibility = compareHistoryCompatibility([previous, current]);
        const metrics = ["seoScore", "totalIssues", "criticalIssues", "highIssues", "pagesCrawled"] as const;
        const deltas = Object.fromEntries(metrics.map((metric) => [metric, (current.summary[metric] ?? 0) - (previous.summary[metric] ?? 0)]));
        return response(name, { compatible: compatibility.compatible, level: compatibility.level }, { previous: previous.historyId, current: current.historyId, deltas, compatibility });
      }
      if (name === "seo_compare_reports" || name === "workflow_compare_before_after") {
        const previousName = String(args.previous ?? args.before ?? "");
        const currentName = String(args.current ?? args.after ?? "");
        const previous = await resolveProjectPath(root, previousName);
        const current = await resolveProjectPath(root, currentName);
        const diff = await compareConfiguredReports(previous, current, defaultGateOptions);
        return response(name, { passed: diff.passed, compatible: diff.compatible, scoreDelta: diff.scoreDelta }, redactObject(diff.comparison, { privacyMode: true }));
      }
      if (name === "seo_get_history") {
        const history = await listJsonFiles(root, config.history.dir);
        return response(name, { count: history.length }, history);
      }
      if (name === "seo_audit_site" || name === "seo_audit_page") {
        const audit = await runConfiguredAudit(root, config, {
          url: typeof args.url === "string" ? args.url : undefined,
          profile: name === "seo_audit_page" ? "quick" : args.profile as "quick" | "standard" | "full" | undefined,
          target: args.target as "configured" | "preview" | "production" | undefined,
          lighthouse: typeof args.lighthouse === "boolean" ? args.lighthouse : undefined,
          gsc: typeof args.gsc === "boolean" ? args.gsc : undefined
        });
        return { success: audit.success, operation: name, summary: { url: audit.url, score: audit.score, reportPath: audit.reportPath, components: audit.components }, results: redactObject(audit, { privacyMode: true }), warnings: [] };
      }
      if (name === "workflow_analyze") {
        const [detection, git, report] = await Promise.all([detectProject(root), getGitStatus(root), latestReport(loaded).catch(() => undefined)]);
        return response(name, { reportAvailable: Boolean(report), clean: git.clean }, { detection, git, report: report ? { path: report.path } : undefined });
      }
      if (name === "workflow_prepare_fix") {
        explicitConfirmation(args, name);
        const snapshot = await createSnapshot(root, { description: "Before Codex SEO controlled fix", confirmed: true });
        const branch = config.git.createWorkBranches ? await createWorkBranch(root) : undefined;
        return response(name, { snapshotId: snapshot.id, branch: branch?.branch ?? snapshot.branch }, { snapshot, branch });
      }
      if (name === "workflow_validate_fix") {
        const validation = await runProjectValidation(root, config);
        const diff = await gitDiff(root);
        return { success: validation.passed, operation: name, summary: { passed: validation.passed, diffBytes: Buffer.byteLength(diff) }, results: { validation, diff }, warnings: [] };
      }
      if (name === "workflow_fix_seo") {
        const orchestrator = new SeoWorkflowOrchestrator(root, config);
        const action = String(args.action ?? "");
        const workflowId = String(args.workflowId ?? "");
        const state = action === "start"
          ? await orchestrator.start({
              mode: args.mode as "quick" | "standard" | "full" | undefined,
              target: args.target as "preview" | "production" | undefined,
              autoApply: typeof args.autoApply === "boolean" ? args.autoApply : undefined,
              autoCommit: typeof args.autoCommit === "boolean" ? args.autoCommit : undefined,
              prepareDeployment: typeof args.prepareDeployment === "boolean" ? args.prepareDeployment : undefined,
              deployAfterConfirmation: typeof args.deployAfterConfirmation === "boolean" ? args.deployAfterConfirmation : undefined
            })
          : action === "advance"
            ? await orchestrator.advanceAfterFixes(workflowId)
            : action === "deploy"
              ? await orchestrator.deploy(workflowId, args.confirmed === true)
              : (() => { throw Object.assign(new Error("Workflow action is invalid"), { code: "workflow.action-invalid" }); })();
        return { success: state.status !== "failed", operation: name, code: state.status === "failed" ? state.error?.code ?? "workflow.failed" : undefined, summary: { workflowId: state.id, stage: state.stage, status: state.status, releaseId: state.releaseId }, results: state, warnings: [] };
      }
      if (name === "workflow_manage") {
        const store = new SeoWorkflowOrchestrator(root, config).workflowStore();
        const action = String(args.action ?? "");
        const id = String(args.workflowId ?? "");
        if (action === "list") {
          const workflows = await store.list();
          return response(name, { count: workflows.length }, workflows);
        }
        if (action === "clean") {
          explicitConfirmation(args, name);
          const removed = await store.clean({ completedOnly: true });
          return response(name, { removed: removed.length }, removed);
        }
        if (!id) throw Object.assign(new Error("workflowId is required"), { code: "workflow.id-required" });
        if (action === "inspect") return response(name, { workflowId: id }, await store.read(id));
        if (action === "resume") return response(name, { workflowId: id }, await store.resume(id));
        if (action === "cancel") return response(name, { workflowId: id }, await store.cancel(id));
        if (action === "restore") {
          explicitConfirmation(args, name);
          return response(name, { workflowId: id }, await store.restore(id));
        }
        throw Object.assign(new Error("Workflow management action is invalid"), { code: "workflow.action-invalid" });
      }
      if (name === "deployment_status") return await deploymentStatus(root, config);
      if (name === "deployment_prepare") return await deploymentPrepare(root, config);
      if (name === "deployment_create_snapshot") {
        explicitConfirmation(args, name);
        return await deploymentCreateSnapshot(root, config);
      }
      if (name === "deployment_upload_staging") {
        explicitConfirmation(args, name);
        return await deploymentUploadStaging(root, config);
      }
      if (name === "deployment_activate_release") return await deploymentActivate(root, config, String(args.releaseId ?? ""), args.confirmed === true);
      if (name === "deployment_health_check") return await deploymentHealthCheck(config, root);
      if (name === "deployment_rollback") return await deploymentRollback(root, config, args.confirmed === true, typeof args.releaseId === "string" ? args.releaseId : undefined);
      throw new Error("Unknown MCP tool: " + name);
    } catch (error) {
      return failure(name, error);
    }
  }

  async handle(message: JsonObject): Promise<JsonObject | undefined> {
    const id = message.id;
    const method = message.method;
    if (method === "notifications/initialized" || method === "notifications/cancelled") return undefined;
    if (method === "initialize") {
      return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "codex-seo", version: getVersion() } } };
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: toolDefinitions } };
    if (method === "tools/call") {
      const params = argsObject(message.params);
      const operation = String(params.name ?? "");
      const value = await this.callTool(operation, params.arguments);
      const sanitized = redactObject(value, { privacyMode: true });
      await recordMcpAudit(this.cwd, this.configPath, operation, value.success);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(sanitized) }], structuredContent: sanitized, isError: !sanitized.success } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }

  async runStdio(): Promise<void> {
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    const shutdown = async (): Promise<void> => { await stopAllPreviews(); };
    process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
    process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message: JsonObject;
      try {
        message = JSON.parse(line) as JsonObject;
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
        continue;
      }
      const output = await this.handle(message);
      if (output) process.stdout.write(JSON.stringify(output) + "\n");
    }
    await shutdown();
  }
}
