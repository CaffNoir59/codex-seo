export class GscError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "GscError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function toGscError(error: unknown, fallbackCode = "gsc.error"): { code: string; message: string; retryable: boolean } {
  if (error instanceof GscError) return { code: error.code, message: error.message, retryable: error.retryable };
  const message = error instanceof Error ? error.message : String(error);
  return { code: fallbackCode, message, retryable: /timeout|rate|quota|429|5\d\d/i.test(message) };
}

export function redactSensitive(value: string, privacyMode = false): string {
  if (!privacyMode) return value.replace(/([A-Za-z]:)?[^\s]*credentials[^\s]*/gi, "[credential-path]");
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/([A-Za-z]:)?[^\s]*credentials[^\s]*/gi, "[credential-path]")
    .replace(/(refresh_token|access_token|private_key|client_secret)[^,}\s]*/gi, "$1:[redacted]");
}