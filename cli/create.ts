#!/usr/bin/env node
import { Command } from "commander";
import { initializeProject, formatProjectInitResult } from "../src/project/init.js";
import type { Framework, PackageManager } from "../src/project/detect.js";
import type { ProjectConfig } from "../src/project/config.js";

const program = new Command();
program
  .name("create-codex-seo")
  .description("Initialize Codex SEO in an existing web project")
  .option("--yes")
  .option("--project-root <path>", "project root", ".")
  .option("--production-url <url>")
  .option("--framework <name>")
  .option("--package-manager <name>")
  .option("--git")
  .option("--no-git")
  .option("--deployment <provider>", "none, local-directory, ssh, or sftp", "none")
  .option("--force")
  .option("--dry-run")
  .option("--json")
  .action(async (options: { yes?: boolean; projectRoot: string; productionUrl?: string; framework?: Framework; packageManager?: PackageManager; git?: boolean; deployment: ProjectConfig["deployment"]["provider"]; force?: boolean; dryRun?: boolean; json?: boolean }) => {
    try {
      const result = await initializeProject(options);
      console.log(options.json ? JSON.stringify(result, null, 2) : formatProjectInitResult(result));
    } catch (error) {
      console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 1;
    }
  });
await program.parseAsync();
