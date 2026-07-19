import type { PerformanceConfig, PerformanceResult } from "../performance-schema.js";
import { runPlaywrightPerformance } from "./playwright-fallback.js";

export type LocalPerformanceOptions = Pick<PerformanceConfig, "device" | "runs" | "timeoutMs"> & Partial<Pick<PerformanceConfig, "localEngine" | "chromePath" | "requireOfficialLighthouse">> & { allowPrivateNetwork?: boolean };

export async function runLocalPerformance(url: string, options: LocalPerformanceOptions): Promise<PerformanceResult> {
  const engine = options.localEngine ?? "auto";
  if (engine === "playwright") return await runPlaywrightPerformance(url, options);
  const { runOfficialLighthousePerformance } = await import("./lighthouse-runner.js");
  const lighthouseResult = await runOfficialLighthousePerformance(url, options);
  if (engine === "lighthouse" || options.requireOfficialLighthouse) return lighthouseResult;
  if (!lighthouseResult.error) return lighthouseResult;
  const fallback = await runPlaywrightPerformance(url, options);
  return {
    ...fallback,
    warnings: [
      ...fallback.warnings,
      `Official Lighthouse failed in auto mode: ${lighthouseResult.error.message}`
    ]
  };
}