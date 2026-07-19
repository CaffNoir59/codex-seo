import path from "node:path";
import { runAudit } from "../orchestrator/audit.js";
import { crawlSite } from "../crawler/crawler.js";
import { buildSitewideReport, writeSitewideReport } from "../reporting/sitewide-report.js";
import { resolvePerformanceConfig, runPerformanceForUrl } from "../performance/performance-runner.js";
import { selectPerformancePages } from "../performance/performance-selector.js";
import { runGsc } from "../gsc/gsc-runner.js";
import type { ProjectConfig } from "./config.js";
import { LocalLogStore } from "../observability/logs.js";

export type AuditComponentStatus = "configured" | "unavailable" | "skipped" | "failed" | "passed";
export type ConfiguredAuditOptions = {
  profile?: "quick" | "standard" | "full";
  target?: "configured" | "preview" | "production";
  url?: string;
  lighthouse?: boolean;
  gsc?: boolean;
};
export type ConfiguredAuditResult = {
  success: boolean;
  url: string;
  profile: "quick" | "standard" | "full";
  target: "configured" | "preview" | "production";
  reportPath?: string;
  files: string[];
  score?: number;
  report: unknown;
  components: Record<"technical" | "crawl" | "lighthouse" | "gsc", { status: AuditComponentStatus; reason?: string; count?: number }>;
};

function targetUrl(config: ProjectConfig, options: ConfiguredAuditOptions): string {
  const value = options.url
    ?? (options.target === "preview" ? config.project.previewUrl : undefined)
    ?? (options.target === "production" ? config.project.productionUrl : undefined)
    ?? config.project.previewUrl
    ?? config.project.productionUrl
    ?? config.target.url;
  if (!value || value.includes("$" + "{")) throw Object.assign(new Error("A resolved audit URL is required"), { code: "audit.url-missing" });
  return value;
}

export async function runConfiguredAudit(projectRoot: string, config: ProjectConfig, options: ConfiguredAuditOptions = {}): Promise<ConfiguredAuditResult> {
  const profile = options.profile ?? "standard";
  const target = options.target ?? "configured";
  const url = targetUrl(config, options);
  const local = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i.test(url);
  const wantsCrawl = profile !== "quick" && config.audit.crawl;
  const wantsLighthouse = options.lighthouse ?? (profile === "full" ? true : config.lighthouse.enabled || config.audit.performance);
  const wantsGsc = options.gsc ?? (profile === "full" && config.gsc.enabled);
  const components: ConfiguredAuditResult["components"] = {
    technical: { status: "configured" },
    crawl: wantsCrawl ? { status: "configured" } : { status: "skipped", reason: config.audit.crawl ? "quick-profile" : "not-configured" },
    lighthouse: wantsLighthouse ? { status: "configured" } : { status: "skipped", reason: "not-configured" },
    gsc: wantsGsc ? { status: "configured" } : { status: "skipped", reason: "not-configured" }
  };
  const logs = new LocalLogStore(projectRoot);
  try {
    if (!wantsCrawl) {
      const performance = wantsLighthouse
        ? await runPerformanceForUrl(url, {
            enabled: true,
            mode: "local",
            device: config.lighthouse.device,
            runs: config.lighthouse.runs,
            allowPrivateNetwork: local,
            cacheDir: path.join(projectRoot, ".codex-seo", "cache", "performance")
          })
        : [];
      components.lighthouse = wantsLighthouse
        ? performance.length ? { status: "passed", count: performance.length } : { status: "unavailable", reason: "no-result" }
        : components.lighthouse;
      const audit = await runAudit(url, { allowPrivateNetwork: local, outputRoot: path.resolve(projectRoot, config.output.dir), pdf: config.output.pdf, performance });
      components.technical = { status: "passed" };
      const result: ConfiguredAuditResult = { success: true, url, profile, target, reportPath: audit.files.find((file) => file.endsWith(".json")), files: audit.files, score: audit.report.scores.overall, report: audit.report, components };
      await logs.write({ category: "audit", event: "configured-audit", success: true, details: { profile, target, score: result.score, components } });
      return result;
    }
    const crawl = await crawlSite(url, {
      maxPages: profile === "full" ? config.crawl.maxPages : Math.min(config.crawl.maxPages, 25),
      maxDepth: profile === "full" ? config.crawl.maxDepth : Math.min(config.crawl.maxDepth, 3),
      render: config.crawl.render,
      allowPrivateNetwork: local,
      environment: config.audit.environment
    });
    components.crawl = { status: "passed", count: crawl.pages.length };
    const perfConfig = resolvePerformanceConfig({
      enabled: wantsLighthouse,
      mode: "local",
      device: config.lighthouse.device,
      runs: config.lighthouse.runs,
      samplePages: profile === "full" ? config.performance.samplePages : Math.min(config.performance.samplePages, 3)
    });
    const performance = [];
    if (wantsLighthouse) {
      for (const page of selectPerformancePages(crawl.pages, perfConfig)) {
        performance.push(...await runPerformanceForUrl(page.finalUrl, { ...perfConfig, allowPrivateNetwork: local, cacheDir: path.join(projectRoot, ".codex-seo", "cache", "performance") }));
      }
      components.lighthouse = performance.length ? { status: "passed", count: performance.length } : { status: "unavailable", reason: "no-selected-page" };
    }
    const preliminaryOutput = path.resolve(projectRoot, config.output.dir, new URL(url).hostname.replace(/^www\./, ""));
    const gsc = wantsGsc ? await runGsc({
      auditUrl: url,
      crawl,
      reportDir: preliminaryOutput,
      enabled: config.gsc.enabled,
      property: config.gsc.property,
      credentialsPath: config.gsc.credentials,
      authMode: config.gsc.authMode,
      days: config.gsc.days,
      privacyMode: config.gsc.privacyMode
    }) : undefined;
    if (wantsGsc) components.gsc = gsc?.enabled && !gsc.error ? { status: "passed", count: gsc.opportunities.length } : gsc?.error ? { status: "failed", reason: gsc.error.code } : { status: "unavailable", reason: "not-enabled" };
    const report = buildSitewideReport(crawl, performance, gsc);
    const output = path.resolve(projectRoot, config.output.dir, new URL(report.audit.startUrl).hostname.replace(/^www\./, ""));
    const files = await writeSitewideReport(report, output, config.output.pdf);
    components.technical = { status: "passed" };
    const success = components.gsc.status !== "failed";
    const result: ConfiguredAuditResult = { success, url, profile, target, reportPath: files.find((file) => file.endsWith(".json")), files, score: report.summary.score, report, components };
    await logs.write({ category: "audit", event: "configured-audit", success, details: { profile, target, score: result.score, components } });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logs.write({ category: "audit", event: "configured-audit", success: false, details: { profile, target, error: message } });
    throw error;
  }
}
