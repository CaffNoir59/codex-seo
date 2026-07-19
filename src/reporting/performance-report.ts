import type { PerformanceResult } from "../performance/performance-schema.js";
import { defaultPerformanceThresholds } from "../performance/performance-scoring.js";

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function fmt(value: number | undefined, unit = "ms"): string {
  if (value === undefined) return "n/a";
  if (unit === "bytes") return `${Math.round(value / 1024)} KB`;
  if (unit === "") return String(Math.round(value * 100) / 100);
  return `${Math.round(value)} ${unit}`;
}

function status(value: number | undefined, good: number, poor: number): string {
  if (value === undefined) return "missing";
  if (value <= good) return "good";
  if (value > poor) return "poor";
  return "needs improvement";
}

function metricCard(label: string, value: number | undefined, unit: string, good: number, poor: number, source: string): string {
  return `<div class="perf-card perf-${escapeHtml(status(value, good, poor)).replace(/\s+/g, '-')}"><strong>${escapeHtml(label)}</strong><div class="perf-value">${escapeHtml(fmt(value, unit))}</div><p>good <= ${escapeHtml(fmt(good, unit))}; poor > ${escapeHtml(fmt(poor, unit))}</p><small>${escapeHtml(status(value, good, poor))} / ${escapeHtml(source)}</small></div>`;
}

function barSvg(values: number[], label: string): string {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return "";
  const max = Math.max(...clean, 1);
  const bars = clean.map((value, index) => `<rect x="${index * 18}" y="${60 - (value / max) * 58}" width="12" height="${(value / max) * 58}" fill="#0f766e"><title>${escapeHtml(value)}</title></rect>`).join("");
  return `<svg class="perf-chart" viewBox="0 0 ${Math.max(80, clean.length * 18)} 70" role="img" aria-label="${escapeHtml(label)}"><line x1="0" y1="60" x2="100%" y2="60" stroke="#d8dee8"/>${bars}</svg>`;
}

function performanceSummary(result: PerformanceResult): string {
  return `<section class="performance-block"><h3>${escapeHtml(result.finalUrl ?? result.url)}</h3><div class="perf-grid">
    <div class="perf-card"><strong>Engine</strong><div class="perf-value">${escapeHtml(result.engine ?? result.source)}</div><p>${escapeHtml(result.scoreKind ?? "unknown")}</p></div>
    <div class="perf-card"><strong>Device</strong><div class="perf-value">${escapeHtml(result.device)}</div><p>${escapeHtml(result.executionEnvironment ?? "unknown")}</p></div>
    <div class="perf-card"><strong>Runs</strong><div class="perf-value">${result.runCount ?? 1}</div><p>confidence ${escapeHtml(result.confidence)}</p></div>
    <div class="perf-card"><strong>Lighthouse score</strong><div class="perf-value">${result.lighthousePerformanceScore ?? "n/a"}</div><p>official only when scoreKind is official-lighthouse</p></div>
    <div class="perf-card"><strong>Internal score</strong><div class="perf-value">${result.internalPerformanceScore ?? "n/a"}</div><p>Codex SEO estimate</p></div>
    <div class="perf-card"><strong>Field CWV</strong><div class="perf-value">${escapeHtml(result.coreWebVitalsAssessment ?? "n/a")}</div><p>CrUX only</p></div>
  </div>
  <h4>Core metrics</h4><div class="perf-grid">
    ${metricCard("LCP", result.metrics.lcpMs, "ms", defaultPerformanceThresholds.lcpGoodMs, defaultPerformanceThresholds.lcpPoorMs, result.scoreKind ?? result.source)}
    ${metricCard("CLS", result.metrics.cls, "", defaultPerformanceThresholds.clsGood, defaultPerformanceThresholds.clsPoor, result.scoreKind ?? result.source)}
    ${metricCard("INP", result.metrics.inpMs, "ms", defaultPerformanceThresholds.inpGoodMs, defaultPerformanceThresholds.inpPoorMs, "field only when available")}
    ${metricCard("TBT", result.metrics.tbtMs, "ms", defaultPerformanceThresholds.tbtGoodMs, defaultPerformanceThresholds.tbtPoorMs, "lab only; not INP")}
    ${metricCard("FCP", result.metrics.fcpMs, "ms", 1800, 3000, result.scoreKind ?? result.source)}
    ${metricCard("Speed Index", result.metrics.speedIndexMs, "ms", 3400, 5800, result.scoreKind ?? result.source)}
    ${metricCard("TTFB", result.metrics.ttfbMs, "ms", defaultPerformanceThresholds.ttfbGoodMs, defaultPerformanceThresholds.ttfbPoorMs, result.scoreKind ?? result.source)}
  </div>
  <h4>Resources</h4><div class="perf-grid">
    <div class="perf-card"><strong>Total</strong><div class="perf-value">${escapeHtml(fmt(result.resources?.transferBytes, "bytes"))}</div></div>
    <div class="perf-card"><strong>JavaScript</strong><div class="perf-value">${escapeHtml(fmt(result.resources?.javascriptBytes, "bytes"))}</div></div>
    <div class="perf-card"><strong>CSS</strong><div class="perf-value">${escapeHtml(fmt(result.resources?.cssBytes, "bytes"))}</div></div>
    <div class="perf-card"><strong>Images</strong><div class="perf-value">${escapeHtml(fmt(result.resources?.imageBytes, "bytes"))}</div></div>
    <div class="perf-card"><strong>Fonts</strong><div class="perf-value">${escapeHtml(fmt(result.resources?.fontBytes, "bytes"))}</div></div>
    <div class="perf-card"><strong>Requests</strong><div class="perf-value">${result.resources?.requestCount ?? "n/a"}</div></div>
  </div>
  <h4>Diagnostics</h4><pre>${escapeHtml(JSON.stringify(result.diagnostics ?? {}, null, 2))}</pre>
  <h4>Opportunities</h4><table><thead><tr><th>Opportunity</th><th>Time saving</th><th>Byte saving</th><th>Recommendation</th></tr></thead><tbody>${(result.opportunities ?? []).map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(fmt(item.estimatedSavingsMs, "ms"))}</td><td>${escapeHtml(fmt(item.estimatedSavingsBytes, "bytes"))}</td><td>${escapeHtml(item.recommendation ?? item.description ?? "")}</td></tr>`).join("") || "<tr><td colspan=\"4\">No Lighthouse opportunities reported.</td></tr>"}</tbody></table>
  ${barSvg((result.runs ?? []).map((run) => run.scores?.performance ?? 0), "Performance score distribution")}</section>`;
}

export function performanceStyles(): string {
  return `.performance-block{background:#fff;border:1px solid #d8dee8;border-radius:8px;padding:16px;margin:16px 0}.perf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.perf-card{background:#fff;border:1px solid #d8dee8;border-radius:8px;padding:12px}.perf-value{font-size:26px;font-weight:800;color:#0f766e}.perf-good{border-left:5px solid #16a34a}.perf-needs-improvement{border-left:5px solid #d97706}.perf-poor{border-left:5px solid #dc2626}.perf-missing{border-left:5px solid #64748b}.perf-chart{width:100%;height:90px;background:#f8fafc;border:1px solid #d8dee8;border-radius:6px}`;
}

export function renderPerformanceSection(results: PerformanceResult[] | undefined): string {
  if (!results?.length) return "";
  const scores = results.map((result) => result.lighthousePerformanceScore ?? result.internalPerformanceScore ?? result.fieldPerformanceScore ?? result.scores?.performance ?? 0);
  return `<h2>Performance</h2><p>Official Lighthouse, internal Playwright estimates, PageSpeed, and CrUX field data are shown separately. TBT is a lab metric and is not presented as INP.</p>${barSvg(scores, "Performance score distribution")}${results.map(performanceSummary).join("")}`;
}