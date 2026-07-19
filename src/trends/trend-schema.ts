import { z } from "zod";
import { historyConfidenceLevels } from "../history/history-schema.js";
import { trendMetrics } from "./trend-metrics.js";

export const TREND_SCHEMA_VERSION = "1.0.0";
export const trendDirections = ["strong-improvement", "improvement", "stable", "degradation", "strong-degradation", "volatile", "insufficient-data"] as const;

export const trendPointSchema = z.object({ historyId: z.string(), date: z.string(), value: z.number(), environment: z.string().optional(), release: z.string().optional(), branch: z.string().optional(), complete: z.boolean() });
export const trendSeriesSchema = z.object({ metric: z.enum(trendMetrics), points: z.array(trendPointSchema), first: z.number().optional(), latest: z.number().optional(), min: z.number().optional(), max: z.number().optional(), mean: z.number().optional(), median: z.number().optional(), absoluteDelta: z.number().optional(), relativeDelta: z.number().optional(), slope: z.number(), coefficientOfVariation: z.number(), outliers: z.array(z.number()), direction: z.enum(trendDirections), confidence: z.enum(historyConfidenceLevels), warnings: z.array(z.string()) });
export const trendReportSchema = z.object({ schemaVersion: z.literal(TREND_SCHEMA_VERSION), generatedAt: z.string(), period: z.object({ since: z.string().optional(), until: z.string().optional() }), entries: z.number(), compatibleEntries: z.number(), compatibility: z.object({ compatible: z.boolean(), score: z.number(), level: z.string(), reasons: z.array(z.string()), warnings: z.array(z.string()) }), confidence: z.enum(historyConfidenceLevels), series: z.array(trendSeriesSchema), recurringIssues: z.array(z.object({ ruleId: z.string(), affectedUrls: z.array(z.string()), firstSeen: z.string(), lastSeen: z.string(), occurrences: z.number(), resolvedOccurrences: z.number(), regressionCount: z.number(), active: z.boolean(), severity: z.string(), confidence: z.string() })), releaseSummary: z.record(z.unknown()).optional(), environmentSummary: z.record(z.unknown()).optional(), gate: z.object({ passed: z.boolean(), reasons: z.array(z.string()) }).optional() });

export type TrendDirection = (typeof trendDirections)[number];
export type TrendPoint = z.infer<typeof trendPointSchema>;
export type TrendSeries = z.infer<typeof trendSeriesSchema>;
export type TrendReport = z.infer<typeof trendReportSchema>;