import { readFile } from "node:fs/promises";
import { buildBaselineFromReport } from "../baseline/baseline-builder.js";
import { seoBaselineSchema, type SeoBaseline } from "../baseline/baseline-schema.js";
import { sitewideAuditReportSchema } from "../schemas/sitewide-report-schema.js";
import { compareIssues } from "./compare-issues.js";
import { comparePages } from "./compare-pages.js";
import { checkCompatibility } from "./compatibility.js";
import { DIFF_SCHEMA_VERSION, seoDiffReportSchema, type SeoDiffReport } from "./diff-schema.js";
import { detectImprovements } from "./improvement-detector.js";
import { comparePerformance } from "./compare-performance.js";
import { compareGsc } from "./compare-gsc.js";
import { emptyIgnoreOptions, type IgnoreOptions } from "./ignore-rules.js";
import { evaluateQualityGate, type DiffGateOptions } from "./quality-gate.js";
import { detectRegressions } from "./regression-detector.js";

export type CompareOptions = {
  baselineName?: string;
  previousReport?: string;
  currentReport?: string;
  ignore?: Partial<IgnoreOptions>;
  gate: DiffGateOptions;
  generatedAt?: string;
  strictCompatibility?: boolean;
};

function isBaseline(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { schemaVersion?: string }).schemaVersion === "1.0.0" && "baseline" in (value as Record<string, unknown>) && "snapshot" in (value as Record<string, unknown>));
}

export function coerceBaseline(value: unknown, name = "report", privacyMode = false): SeoBaseline {
  if (isBaseline(value)) return seoBaselineSchema.parse(value);
  const report = sitewideAuditReportSchema.parse(value);
  return buildBaselineFromReport(report, { name, privacyMode, createdAt: report.audit.completedAt });
}

export async function loadComparable(file: string, name?: string): Promise<SeoBaseline> {
  return coerceBaseline(JSON.parse(await readFile(file, "utf8")), name ?? file);
}

function categoryChanges(previous: SeoBaseline, current: SeoBaseline): SeoDiffReport["categoryChanges"] {
  const keys = [...new Set([...Object.keys(previous.snapshot.categoryScores), ...Object.keys(current.snapshot.categoryScores)])].sort();
  return Object.fromEntries(keys.map((key) => {
    const prev = previous.snapshot.categoryScores[key] ?? 0;
    const curr = current.snapshot.categoryScores[key] ?? 0;
    return [key, { previousScore: prev, currentScore: curr, delta: curr - prev }];
  }));
}

function collectIgnored(report: Pick<SeoDiffReport, "pages" | "issues" | "regressions" | "improvements">): SeoDiffReport["ignoredChanges"] {
  return [
    ...report.pages.added,
    ...report.pages.removed,
    ...report.pages.changed,
    ...report.issues.introduced,
    ...report.issues.resolved,
    ...report.issues.changed,
    ...report.regressions,
    ...report.improvements
  ].filter((item) => item.ignored);
}

export function compareBaselines(previous: SeoBaseline, current: SeoBaseline, options: CompareOptions): SeoDiffReport {
  const ignore = { ...emptyIgnoreOptions(), ...(options.ignore ?? {}) };
  const compatibility = checkCompatibility(previous, current);
  if (options.strictCompatibility && (!compatibility.compatible || compatibility.warnings.length > 0)) {
    throw new Error(`Audits incompatible in strict mode: ${compatibility.warnings.join("; ")}`);
  }
  const pages = comparePages(previous.snapshot.pages, current.snapshot.pages, { ignore, incomplete: compatibility.incomplete });
  const issues = compareIssues(previous.snapshot.issues, current.snapshot.issues, ignore);
  const performance = comparePerformance(previous, current);
  const gsc = compareGsc(previous, current);
  const regressions = [...detectRegressions(previous, current, pages, issues, compatibility.incomplete), ...performance.regressions, ...gsc.regressions].sort((a, b) => a.id.localeCompare(b.id));
  const improvements = [...detectImprovements(previous, current, pages, issues), ...performance.improvements, ...gsc.improvements].sort((a, b) => a.id.localeCompare(b.id));
  const scoreDelta = current.snapshot.globalScore - previous.snapshot.globalScore;
  const partial: Omit<SeoDiffReport, "ignoredChanges" | "gate"> & { ignoredChanges?: SeoDiffReport["ignoredChanges"]; gate?: SeoDiffReport["gate"] } = {
    schemaVersion: DIFF_SCHEMA_VERSION,
    comparison: {
      baselineName: options.baselineName,
      previousReport: options.previousReport ?? previous.baseline.sourceReportPath ?? previous.baseline.name,
      currentReport: options.currentReport ?? current.baseline.sourceReportPath ?? current.baseline.name,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      startUrl: current.baseline.startUrl,
      compatible: compatibility.compatible,
      compatibilityWarnings: [...compatibility.warnings, ...gsc.compatibilityWarnings]
    },
    summary: {
      previousScore: previous.snapshot.globalScore,
      currentScore: current.snapshot.globalScore,
      scoreDelta,
      regressionCount: regressions.filter((item) => !item.ignored).length,
      improvementCount: improvements.filter((item) => !item.ignored).length,
      unchangedCount: pages.unchanged.length + issues.persisting.length,
      pagesAdded: pages.added.length,
      pagesRemoved: pages.removed.length,
      issuesIntroduced: issues.introduced.length,
      issuesResolved: issues.resolved.length,
      issuesPersisting: issues.persisting.length
    },
    categoryChanges: categoryChanges(previous, current),
    pages,
    issues,
    performanceChanges: performance.changes,
    gscChanges: gsc.changes,
    regressions,
    improvements,
    scoreExplanation: {
      previousScore: previous.snapshot.globalScore,
      currentScore: current.snapshot.globalScore,
      delta: scoreDelta,
      categoryDeltas: Object.fromEntries(Object.entries(categoryChanges(previous, current)).map(([key, value]) => [key, value.delta])),
      repeatedIssueCap: "Sitewide scoring caps repeated issue impact at 45 points, so issue volume alone does not linearly move the global score.",
      explanation: scoreDelta === 0 ? "The global score is unchanged because category penalties and repeated-issue caps offset resolved and introduced issues." : `The global score changed by ${scoreDelta} points based on category deltas and capped repeated issue impact.`
    },
    configuration: { gate: options.gate, ignore }
  };
  const ignoredChanges = collectIgnored(partial as SeoDiffReport);
  const gate = evaluateQualityGate({ summary: partial.summary, issues, regressions }, options.gate);
  return seoDiffReportSchema.parse({ ...partial, ignoredChanges, gate });
}

export async function compareReportFiles(previousFile: string, currentFile: string, options: CompareOptions): Promise<SeoDiffReport> {
  const previous = await loadComparable(previousFile, "previous");
  const current = await loadComparable(currentFile, "current");
  return compareBaselines(previous, current, { ...options, previousReport: previousFile, currentReport: currentFile });
}

