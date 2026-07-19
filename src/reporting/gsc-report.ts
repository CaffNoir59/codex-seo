import type { GscAuditResult, GscSearchAnalyticsRow } from "../gsc/gsc-schema.js";

function escapeHtml(value: unknown): string { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function pct(value?: number): string { return value === undefined ? "n/a" : `${(value * 100).toFixed(2)}%`; }
function num(value?: number): string { return value === undefined ? "n/a" : Math.round(value).toLocaleString("en-US"); }
function pos(value?: number): string { return value === undefined ? "n/a" : value.toFixed(1); }

function rows(items: GscSearchAnalyticsRow[], kind: "page" | "query"): string {
  return items.slice(0, 10).map((row) => `<tr><td>${escapeHtml(row.keys[kind] ?? "")}</td><td>${num(row.clicks)}</td><td>${num(row.impressions)}</td><td>${pct(row.ctr)}</td><td>${pos(row.position)}</td></tr>`).join("");
}

function bars(items: GscSearchAnalyticsRow[], label: "page" | "query"): string {
  const max = Math.max(1, ...items.map((item) => item.impressions));
  return `<div class="gsc-bars">${items.slice(0, 8).map((item) => `<div><span>${escapeHtml(item.keys[label] ?? "")}</span><b style="width:${Math.max(4, item.impressions / max * 100).toFixed(1)}%"></b><em>${num(item.impressions)}</em></div>`).join("")}</div>`;
}

export function gscStyles(): string {
  return `.gsc-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.gsc-card{background:#fff;border:1px solid #d8dee8;border-radius:8px;padding:14px}.gsc-card strong{display:block;color:#334155}.gsc-muted{color:#64748b}.gsc-bars div{display:grid;grid-template-columns:minmax(160px,1fr) 3fr 80px;gap:8px;align-items:center;margin:6px 0}.gsc-bars b{height:10px;background:#0f766e;display:block;border-radius:3px}.gsc-table{margin-top:10px}.gsc-warning{background:#fff7ed;border:1px solid #fdba74;padding:10px;border-radius:6px}.gsc-opps td{vertical-align:top}`;
}

export function renderGscSection(gsc?: GscAuditResult): string {
  if (!gsc?.enabled) return "";
  const analytics = gsc.searchAnalytics;
  const comparison = gsc.periodComparison;
  const oppRows = gsc.opportunities.slice(0, 20).map((item) => `<tr><td>${escapeHtml(item.page ?? "")}</td><td>${escapeHtml(item.query ?? "")}</td><td>${num(item.metrics.impressions)}</td><td>${num(item.metrics.clicks)}</td><td>${pct(item.metrics.ctr)}</td><td>${pos(item.metrics.position)}</td><td>${escapeHtml(item.ruleId)}</td><td>${item.priority.priorityScore}</td><td>${escapeHtml(item.recommendation)}</td></tr>`).join("");
  const inspectionRows = gsc.inspections.map((item) => `<tr><td>${escapeHtml(item.url)}</td><td>${escapeHtml(item.verdict)}</td><td>${escapeHtml(item.coverageState ?? "")}</td><td>${escapeHtml(item.googleCanonical ?? "")}</td><td>${escapeHtml(item.robotsTxtState ?? "")}</td></tr>`).join("");
  return `<section id="gsc"><h2>Google Search Console</h2>${gsc.warnings.length ? `<p class="gsc-warning">${escapeHtml(gsc.warnings.join("; "))}</p>` : ""}<div class="gsc-summary"><div class="gsc-card"><strong>Property</strong><p>${escapeHtml(gsc.property ?? "n/a")}</p></div><div class="gsc-card"><strong>Period</strong><p>${escapeHtml(analytics ? `${analytics.startDate} to ${analytics.endDate}` : "n/a")}</p></div><div class="gsc-card"><strong>Clicks</strong><p>${num(analytics?.totals.clicks)} ${comparison ? `(${pct(comparison.totals.clicks.relativeDelta)})` : ""}</p></div><div class="gsc-card"><strong>Impressions</strong><p>${num(analytics?.totals.impressions)} ${comparison ? `(${pct(comparison.totals.impressions.relativeDelta)})` : ""}</p></div><div class="gsc-card"><strong>CTR</strong><p>${pct(analytics?.totals.ctr)}</p></div><div class="gsc-card"><strong>Average position</strong><p>${pos(analytics?.totals.weightedPosition)}</p></div><div class="gsc-card"><strong>Data state</strong><p>${analytics?.partial || gsc.partial ? "PARTIAL" : "COMPLETE"}</p></div><div class="gsc-card"><strong>Source</strong><p>${escapeHtml(gsc.source)}</p></div></div><h3>Visibility Charts</h3>${analytics ? bars(analytics.rows, analytics.dimensions.includes("page") ? "page" : "query") : ""}<h3>Top pages</h3><table class="gsc-table"><thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead><tbody>${analytics ? rows(analytics.rows, "page") : ""}</tbody></table><h3>Top queries</h3><table class="gsc-table"><thead><tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead><tbody>${analytics ? rows(analytics.rows, "query") : ""}</tbody></table><h3>Opportunities</h3><table class="gsc-opps"><thead><tr><th>Page</th><th>Query</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Position</th><th>Rule</th><th>Priority</th><th>Recommendation</th></tr></thead><tbody>${oppRows}</tbody></table><h3>Indexation</h3><table><thead><tr><th>URL</th><th>Verdict</th><th>Coverage</th><th>Google canonical</th><th>Robots</th></tr></thead><tbody>${inspectionRows}</tbody></table><p class="gsc-muted">Traffic and technical changes are shown as observed associations, not as proven causes.</p></section>`;
}