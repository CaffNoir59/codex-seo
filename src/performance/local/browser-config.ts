import type { PerformanceDevice } from "../performance-schema.js";

export function viewportForDevice(device: PerformanceDevice): { width: number; height: number; isMobile: boolean; deviceScaleFactor: number } {
  return device === "mobile"
    ? { width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 }
    : { width: 1366, height: 900, isMobile: false, deviceScaleFactor: 1 };
}
