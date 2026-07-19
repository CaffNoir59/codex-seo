import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../security/project-policy.js";
import type { ProjectConfig } from "../project/config.js";

export const workflowStages = [
  "doctor", "git", "audit-before", "plan", "snapshot", "branch", "awaiting-fixes", "validation",
  "preview", "audit-preview", "comparison", "diff", "commit", "release", "awaiting-deployment-confirmation",
  "deployment", "health-checks", "audit-production", "completed"
] as const;
export type WorkflowStage = typeof workflowStages[number];
export type WorkflowStatus = "active" | "awaiting-action" | "awaiting-confirmation" | "failed" | "cancelled" | "completed";

export type WorkflowState = {
  schemaVersion: "1.1.0";
  id: string;
  createdAt: string;
  updatedAt: string;
  status: WorkflowStatus;
  stage: WorkflowStage;
  mode: "quick" | "standard" | "full";
  target: "preview" | "production";
  options: {
    autoApply: boolean;
    autoCommit: boolean;
    prepareDeployment: boolean;
    deployAfterConfirmation: boolean;
  };
  iteration: number;
  maxIterations: number;
  snapshotId?: string;
  branch?: string;
  releaseId?: string;
  reports: { before?: string; preview?: string; production?: string };
  history: Array<{ at: string; stage: WorkflowStage; status: WorkflowStatus; event: string; details?: Record<string, unknown> }>;
  error?: { code: string; message: string };
};

export type StartWorkflowOptions = Partial<WorkflowState["options"]> & {
  mode?: WorkflowState["mode"];
  target?: WorkflowState["target"];
};

function workflowId(): string {
  return "workflow-" + new Date().toISOString().replace(/[-:.TZ]/g, "") + "-" + Math.random().toString(36).slice(2, 8);
}

export class WorkflowStore {
  constructor(private readonly projectRoot: string, private readonly config: ProjectConfig) {}

  private async directory(): Promise<string> {
    const directory = await resolveProjectPath(this.projectRoot, this.config.workflow.stateDirectory, { allowMissing: true, allowProtected: true });
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private async file(id: string): Promise<string> {
    if (!/^workflow-[A-Za-z0-9-]+$/.test(id)) throw Object.assign(new Error("Workflow identifier is invalid"), { code: "workflow.id-invalid" });
    return path.join(await this.directory(), id + ".json");
  }

  async start(options: StartWorkflowOptions = {}): Promise<WorkflowState> {
    const now = new Date().toISOString();
    const state: WorkflowState = {
      schemaVersion: "1.1.0",
      id: workflowId(),
      createdAt: now,
      updatedAt: now,
      status: "active",
      stage: "doctor",
      mode: options.mode ?? "standard",
      target: options.target ?? "preview",
      options: {
        autoApply: options.autoApply ?? true,
        autoCommit: options.autoCommit ?? true,
        prepareDeployment: options.prepareDeployment ?? true,
        deployAfterConfirmation: options.deployAfterConfirmation ?? false
      },
      iteration: 0,
      maxIterations: this.config.workflow.maxFixIterations,
      reports: {},
      history: [{ at: now, stage: "doctor", status: "active", event: "workflow-started" }]
    };
    await this.save(state);
    return state;
  }

  async save(state: WorkflowState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await writeFile(await this.file(state.id), JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  async read(id: string): Promise<WorkflowState> {
    return JSON.parse(await readFile(await this.file(id), "utf8")) as WorkflowState;
  }

  async list(): Promise<WorkflowState[]> {
    const directory = await this.directory();
    const files = (await readdir(directory)).filter((name) => /^workflow-[A-Za-z0-9-]+\.json$/.test(name));
    const states = await Promise.all(files.map((name) => readFile(path.join(directory, name), "utf8").then((value) => JSON.parse(value) as WorkflowState)));
    return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async transition(id: string, stage: WorkflowStage, options: { status?: WorkflowStatus; event?: string; details?: Record<string, unknown>; patch?: Partial<WorkflowState> } = {}): Promise<WorkflowState> {
    const state = await this.read(id);
    const current = workflowStages.indexOf(state.stage);
    const next = workflowStages.indexOf(stage);
    if (next < 0) throw Object.assign(new Error("Workflow stage is invalid"), { code: "workflow.stage-invalid" });
    if (next < current && stage !== "awaiting-fixes") throw Object.assign(new Error("Workflow cannot move backwards without restore"), { code: "workflow.transition-invalid" });
    Object.assign(state, options.patch ?? {});
    state.stage = stage;
    state.status = options.status ?? (stage === "completed" ? "completed" : "active");
    state.history.push({ at: new Date().toISOString(), stage, status: state.status, event: options.event ?? "stage-transition", details: options.details });
    await this.save(state);
    return state;
  }

  async cancel(id: string): Promise<WorkflowState> {
    const state = await this.read(id);
    if (state.status === "completed") throw Object.assign(new Error("Completed workflows cannot be cancelled"), { code: "workflow.completed" });
    state.status = "cancelled";
    state.history.push({ at: new Date().toISOString(), stage: state.stage, status: "cancelled", event: "workflow-cancelled" });
    await this.save(state);
    return state;
  }

  async resume(id: string): Promise<WorkflowState> {
    const state = await this.read(id);
    if (state.status === "completed" || state.status === "cancelled") throw Object.assign(new Error("Workflow is not resumable"), { code: "workflow.not-resumable" });
    state.status = state.stage === "awaiting-deployment-confirmation" ? "awaiting-confirmation" : "active";
    state.history.push({ at: new Date().toISOString(), stage: state.stage, status: state.status, event: "workflow-resumed" });
    await this.save(state);
    return state;
  }

  async restore(id: string): Promise<WorkflowState> {
    const state = await this.read(id);
    if (!state.snapshotId) throw Object.assign(new Error("Workflow has no restorable snapshot"), { code: "workflow.snapshot-missing" });
    state.status = "awaiting-action";
    state.history.push({ at: new Date().toISOString(), stage: state.stage, status: state.status, event: "restore-requested", details: { snapshotId: state.snapshotId } });
    await this.save(state);
    return state;
  }

  async clean(options: { completedOnly?: boolean } = {}): Promise<string[]> {
    const states = await this.list();
    const removable = states.filter((state) => !options.completedOnly || ["completed", "cancelled"].includes(state.status));
    for (const state of removable) await rm(await this.file(state.id), { force: true });
    return removable.map((state) => state.id);
  }
}
