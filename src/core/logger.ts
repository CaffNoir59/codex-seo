import { redactSecrets } from "./redaction.js";

export type LogLevel = "quiet" | "normal" | "verbose" | "debug";
export type Logger = { level: LogLevel; jsonOutput: boolean; info(message: string, value?: unknown): void; warn(message: string, value?: unknown): void; debug(message: string, value?: unknown): void; error(message: string, value?: unknown): void };

function should(level: LogLevel, target: LogLevel): boolean {
  const order = { quiet: 0, normal: 1, verbose: 2, debug: 3 };
  return order[level] >= order[target];
}

export function createLogger(options: { quiet?: boolean; verbose?: boolean; debug?: boolean; jsonOutput?: boolean; privacyMode?: boolean } = {}): Logger {
  const level: LogLevel = options.debug ? "debug" : options.verbose ? "verbose" : options.quiet ? "quiet" : "normal";
  const write = (stream: NodeJS.WriteStream, message: string, value?: unknown) => {
    const suffix = value === undefined ? "" : ` ${redactSecrets(value, { privacyMode: options.privacyMode })}`;
    stream.write(`${redactSecrets(message, { privacyMode: options.privacyMode })}${suffix}\n`);
  };
  return {
    level,
    jsonOutput: Boolean(options.jsonOutput),
    info(message, value) { if (!options.jsonOutput && should(level, "normal")) write(process.stdout, message, value); },
    warn(message, value) { if (should(level, "normal")) write(process.stderr, message, value); },
    debug(message, value) { if (should(level, "debug")) write(process.stderr, message, value); },
    error(message, value) { write(process.stderr, message, value); }
  };
}