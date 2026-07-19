import type { PerformanceResult } from "../performance-schema.js";

export type LocalRunMetrics = Pick<PerformanceResult, "metrics" | "resources" | "scores" | "engine" | "scoreKind" | "diagnostics" | "opportunities">;

export function resourceBucket(contentType: string, url: string): "javascriptBytes" | "cssBytes" | "imageBytes" | "fontBytes" | undefined {
  const lower = `${contentType} ${url}`.toLowerCase();
  if (lower.includes("javascript") || lower.endsWith(".js")) return "javascriptBytes";
  if (lower.includes("css") || lower.endsWith(".css")) return "cssBytes";
  if (lower.includes("image") || /\.(png|jpe?g|webp|gif|svg)(\?|$)/.test(lower)) return "imageBytes";
  if (lower.includes("font") || /\.(woff2?|ttf|otf)(\?|$)/.test(lower)) return "fontBytes";
  return undefined;
}
