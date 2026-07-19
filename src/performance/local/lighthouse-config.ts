import { desktopConfig } from "lighthouse";
import type { PerformanceDevice } from "../performance-schema.js";

export function lighthouseConfigForDevice(device: PerformanceDevice) {
  if (device === "desktop") return desktopConfig;
  return undefined;
}

export function lighthouseFlagsForDevice(device: PerformanceDevice, port: number, timeoutMs: number) {
  return {
    port,
    output: "json" as const,
    logLevel: "error" as const,
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    formFactor: device,
    maxWaitForLoad: timeoutMs,
    locale: "en-US"
  };
}