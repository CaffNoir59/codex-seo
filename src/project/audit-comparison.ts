import { readFile } from "node:fs/promises";
import { compareReportFiles } from "../diff/compare-reports.js";
import { defaultGateOptions, type DiffGateOptions } from "../diff/quality-gate.js";

type ScoreReport = { summary?: { score?: number }; scores?: { overall?: number } };

function reportScore(value: ScoreReport): number | undefined {
  return value.summary?.score ?? value.scores?.overall;
}

export async function compareConfiguredReports(previous: string, current: string, gate: DiffGateOptions = defaultGateOptions): Promise<{
  compatible: boolean;
  passed: boolean;
  scoreDelta?: number;
  comparison: unknown;
}> {
  try {
    const comparison = await compareReportFiles(previous, current, { gate });
    return { compatible: true, passed: comparison.gate.passed, scoreDelta: comparison.summary.scoreDelta, comparison };
  } catch (error) {
    const before = JSON.parse(await readFile(previous, "utf8")) as ScoreReport;
    const after = JSON.parse(await readFile(current, "utf8")) as ScoreReport;
    const beforeScore = reportScore(before);
    const afterScore = reportScore(after);
    if (beforeScore === undefined || afterScore === undefined) throw error;
    const scoreDelta = afterScore - beforeScore;
    const maxDrop = gate.maxScoreDrop ?? Number.POSITIVE_INFINITY;
    return {
      compatible: false,
      passed: scoreDelta >= -maxDrop,
      scoreDelta,
      comparison: { kind: "page-score-fallback", beforeScore, afterScore, warning: "Detailed sitewide compatibility was unavailable; only the page score delta was evaluated." }
    };
  }
}
