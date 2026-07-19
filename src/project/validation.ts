import type { ProjectConfig } from "./config.js";
import { runConfiguredCommand, type CommandResult } from "./command-runner.js";

export type ValidationStatus = "passed" | "failed" | "skipped";
export type ValidationStepResult = {
  name: "install" | "lint" | "typecheck" | "test" | "build";
  status: ValidationStatus;
  required: boolean;
  reason?: "command-not-configured" | "disabled" | "stopped-after-failure";
  exitCode?: number | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
};
export type ValidationResult = { passed: boolean; steps: number; durationMs: number; results: ValidationStepResult[] };

const order = ["install", "lint", "typecheck", "test", "build"] as const;

export async function runProjectValidation(root: string, config: ProjectConfig, selected: readonly string[] = order): Promise<ValidationResult> {
  const started = Date.now();
  const results: ValidationStepResult[] = [];
  let stopped = false;
  for (const name of order) {
    if (!selected.includes(name)) continue;
    const policy = config.validation[name];
    const command = config.commands[name];
    const required = policy?.required ?? name !== "install";
    if (stopped) {
      results.push({ name, status: "skipped", required, reason: "stopped-after-failure" });
      continue;
    }
    if (policy?.enabled === false) {
      results.push({ name, status: "skipped", required, reason: "disabled" });
      continue;
    }
    if (!command) {
      results.push({ name, status: "skipped", required, reason: "command-not-configured" });
      continue;
    }
    let execution: CommandResult;
    try {
      execution = await runConfiguredCommand(command, {
        cwd: root,
        timeoutMs: policy?.timeoutMs ?? config.security.commandTimeoutMs,
        outputLimitBytes: config.security.outputLimitBytes
      });
    } catch (error) {
      results.push({ name, status: "failed", required, stderr: error instanceof Error ? error.message : String(error) });
      if (policy?.stopOnFailure !== false) stopped = true;
      continue;
    }
    const passed = execution.exitCode === 0 && !execution.timedOut;
    results.push({
      name,
      status: passed ? "passed" : "failed",
      required,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      stdout: execution.stdout,
      stderr: execution.stderr
    });
    if (!passed && policy?.stopOnFailure !== false) stopped = true;
  }
  return {
    passed: !results.some((result) => result.required && result.status === "failed"),
    steps: results.length,
    durationMs: Date.now() - started,
    results
  };
}
