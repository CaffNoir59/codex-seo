import { spawn } from "node:child_process";
import path from "node:path";
import { redactSecrets } from "../core/redaction.js";

const allowedExecutables = new Set(["npm", "npm.cmd", "npx", "npx.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd", "bun", "bun.exe", "node", "node.exe", "php", "php.exe", "composer", "composer.bat"]);
const forbiddenShellSyntax = /(?:&&|\|\||[|;<>\n\r]|\$\(|\x60)/;

export type ParsedCommand = { command: string; args: string[] };
export type CommandResult = { command: string; args: string[]; exitCode: number | null; signal: string | null; timedOut: boolean; durationMs: number; stdout: string; stderr: string };

export function parseConfiguredCommand(value: string): ParsedCommand {
  if (!value.trim()) throw new Error("Configured command is empty");
  if (forbiddenShellSyntax.test(value)) throw new Error("Shell operators are not allowed in configured commands");
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"' && index + 1 < value.length) current += value[++index];
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Configured command contains an unterminated quote");
  if (current) tokens.push(current);
  const [command, ...args] = tokens;
  if (!command) throw new Error("Configured command is empty");
  const executable = path.basename(command).toLowerCase();
  if (!allowedExecutables.has(executable)) throw new Error("Executable is not allowed: " + executable);
  if (args.some((argument) => argument.includes("\0"))) throw new Error("Command argument contains a null byte");
  return { command, args };
}

export async function runConfiguredCommand(value: string, options: { cwd: string; timeoutMs?: number; outputLimitBytes?: number; env?: NodeJS.ProcessEnv } ): Promise<CommandResult> {
  const parsed = parseConfiguredCommand(value);
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const outputLimit = options.outputLimitBytes ?? 200_000;
  return await new Promise((resolve, reject) => {
    const child = spawn(parsed.command, parsed.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: unknown): string => (current + String(chunk)).slice(-outputLimit);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command: parsed.command,
        args: parsed.args,
        exitCode: code,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr)
      });
    });
  });
}
