import type { TrendReport, TrendSeries } from "../trends/trend-schema.js";

function e(value: unknown): string { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function svg(series: TrendSeries): string {
  const points = series.points;
  if (points.length < 2) return "";
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;
  const coords = points.map((point, i) => `${(i / Math.max(1, points.length - 1)) * 100},${90 - ((point.value - min) / span) * 80}`).join(" ");
  return `<svg viewBox="0 0 100 100" role="img"><polyline fill="none" stroke="#0f766e" stroke-width="2" points="${coords}"/><g>${points.map((point, i) => `<circle cx="${(i / Math.max(1, points.length - 1)) * 100}" cy="${90 - ((point.value - min) / span) * 80}" r="2"><title>${e(point.date)}: ${point.value}</title></circle>`).join("")}</g></svg>`;
}

export function renderTrendHtml(report: TrendReport): string {
  const cards = report.series.map((series) => `<section class="panel"><h2>${e(series.metric)}</h2>${svg(series)}<p>First: ${e(series.first ?? "n/a")} Latest: ${e(series.latest ?? "n/a")} Delta: ${e(series.absoluteDelta ?? "n/a")} Trend: ${e(series.direction)} Confidence: ${e(series.confidence)}</p></section>`).join("");
  const recurring = report.recurringIssues.map((item) => `<tr><td>${e(item.ruleId)}</td><td>${e(item.severity)}</td><td>${item.occurrences}</td><td>${item.regressionCount}</td><td>${e(item.firstSeen)}</td><td>${e(item.lastSeen)}</td><td>${item.active}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex SEO Trend</title><style>body{font-family:Arial,sans-serif;margin:0;background:#f6f8fb;color:#17202a}header,main{max-width:1180px;margin:auto;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.panel{background:white;border:1px solid #d8dee8;border-radius:8px;padding:16px}svg{width:100%;height:180px;background:#fff}table{width:100%;border-collapse:collapse;background:#fff}td,th{border:1px solid #d8dee8;padding:8px;text-align:left}.warn{background:#fff7ed;border:1px solid #fdba74;padding:10px;border-radius:6px}</style></head><body><header><h1>Codex SEO Trend</h1><p>Entries: ${report.entries} Compatible: ${report.compatibleEntries} Confidence: ${e(report.confidence)}</p></header><main><section class="panel"><h2>Data quality</h2><p>Compatibility: ${e(report.compatibility.level)} (${report.compatibility.score})</p><p class="warn">${e([...report.compatibility.reasons, ...report.compatibility.warnings].join("; ") || "No major compatibility warnings.")}</p></section><section class="grid">${cards}</section><section class="panel"><h2>Recurring regressions</h2><table><thead><tr><th>Rule</th><th>Severity</th><th>Occurrences</th><th>Regressions</th><th>First</th><th>Last</th><th>Active</th></tr></thead><tbody>${recurring}</tbody></table></section><section class="panel"><h2>Limits</h2><p>Traffic and technical movements are presented as observed temporal associations, not proven causes.</p></section></main></body></html>`;
}