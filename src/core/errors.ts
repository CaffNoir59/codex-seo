import { redactObject } from "./redaction.js";

export type CodexSeoErrorCategory = "configuration" | "validation" | "network" | "crawl" | "performance" | "gsc" | "history" | "compatibility" | "gate" | "report" | "dependency" | "security" | "runtime";

export type CodexSeoErrorOptions = {
  code: string;
  message: string;
  category: CodexSeoErrorCategory;
  retryable?: boolean;
  userAction?: string;
  cause?: unknown;
  context?: Record<string, unknown>;
};

export class CodexSeoError extends Error {
  readonly code: string;
  readonly category: CodexSeoErrorCategory;
  readonly retryable: boolean;
  readonly userAction?: string;
  readonly context?: Record<string, unknown>;
  constructor(options: CodexSeoErrorOptions) {
    super(options.message);
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;
    this.retryable = Boolean(options.retryable);
    this.userAction = options.userAction;
    this.context = options.context;
    if (options.cause !== undefined) this.cause = options.cause;
  }
  toJSON(debug = false) {
    return redactObject({ code: this.code, message: this.message, category: this.category, retryable: this.retryable, userAction: this.userAction, context: this.context, ...(debug ? { stack: this.stack } : {}) });
  }
}
export class ConfigurationError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "configuration.invalid", message, category: "configuration", userAction: "Run codex-seo validate --fix when the suggestion is unambiguous.", context }); } }
export class ValidationError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "validation.failed", message, category: "validation", context }); } }
export class NetworkError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "network.failed", message, category: "network", retryable: true, context }); } }
export class CrawlError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "crawl.failed", message, category: "crawl", retryable: true, context }); } }
export class PerformanceError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "performance.failed", message, category: "performance", retryable: true, context }); } }
export class GscError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "gsc.failed", message, category: "gsc", retryable: true, context }); } }
export class HistoryError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "history.failed", message, category: "history", context }); } }
export class CompatibilityError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "compatibility.failed", message, category: "compatibility", context }); } }
export class GateError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "gate.failed", message, category: "gate", context }); } }
export class ReportError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "report.failed", message, category: "report", context }); } }
export class DependencyError extends CodexSeoError { constructor(message: string, context?: Record<string, unknown>) { super({ code: "dependency.missing", message, category: "dependency", userAction: "Install or configure the optional dependency only when you need that feature.", context }); } }

export function normalizeError(error: unknown, debug = false) {
  if (error instanceof CodexSeoError) return error.toJSON(debug);
  const message = error instanceof Error ? error.message : String(error);
  return { code: "runtime.error", message, category: "runtime", retryable: false, ...(debug && error instanceof Error ? { stack: error.stack } : {}) };
}