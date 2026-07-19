export function median(values: number[]): number | undefined {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return undefined;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function varianceWarning(values: number[], label: string): string | undefined {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 3) return undefined;
  const med = median(clean) ?? 0;
  if (med === 0) return undefined;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  return (max - min) / med > 0.35 ? `High variance for ${label}: min ${min}, max ${max}, median ${med}` : undefined;
}

export function scoreFromLighthouse(value: unknown): number | undefined {
  return typeof value === "number" ? Math.max(0, Math.min(100, Math.round(value * 100))) : undefined;
}

export function standardDeviation(values: number[]): number | undefined {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return undefined;
  const avg = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / clean.length);
}

export function percentile(values: number[], p: number): number | undefined {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return undefined;
  const index = (clean.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return clean[lower];
  return clean[lower] + (clean[upper] - clean[lower]) * (index - lower);
}

export function performanceStatistics(values: number[]): { median?: number; min?: number; max?: number; standardDeviation?: number; coefficientOfVariation?: number; iqr?: number } | undefined {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return undefined;
  const med = median(clean);
  const std = standardDeviation(clean);
  const q1 = percentile(clean, 0.25);
  const q3 = percentile(clean, 0.75);
  return {
    median: med,
    min: Math.min(...clean),
    max: Math.max(...clean),
    standardDeviation: std,
    coefficientOfVariation: med && std !== undefined ? std / med : undefined,
    iqr: q1 !== undefined && q3 !== undefined ? q3 - q1 : undefined
  };
}