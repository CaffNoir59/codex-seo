import type { HistoryEntry } from "../history/history-schema.js";

export function compactHistoryList(entries: HistoryEntry[]): string {
  return entries.map((entry) => `${entry.historyId}\t${entry.createdAt}\t${entry.identity.environment ?? "-"}\t${entry.identity.release ?? "-"}\t${entry.summary.seoScore ?? "n/a"}\t${entry.completeness.complete ? "complete" : "partial"}`).join("\n");
}