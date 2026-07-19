#!/usr/bin/env node
import path from "node:path";
import { CodexSeoMcpServer } from "../src/mcp/server.js";

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRoot = path.resolve(value("--project-root") ?? process.cwd());
const configPath = value("--config");
const server = new CodexSeoMcpServer(projectRoot, configPath);
await server.runStdio();
