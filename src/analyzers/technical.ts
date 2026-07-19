import { fetch } from "undici";
import type { AuditContext } from "../core/audit-context.js";
import { issue, type AnalyzerResult, type SeoIssue } from "../core/issue.js";
import { assertPolicyUrl, type NetworkAccessPolicy } from "../core/network-policy.js";

async function headStatus(url: string, timeoutMs = 5000, networkPolicy?: NetworkAccessPolicy): Promise<number | null> {
  await assertPolicyUrl(url, networkPolicy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: controller.signal });
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeTechnical(context: AuditContext): Promise<AnalyzerResult> {
  const p = context.parsed;
  const issues: SeoIssue[] = [];
  const url = context.finalUrl;
  const parsedUrl = new URL(url);

  if (context.fetch.status >= 400) {
    issues.push(issue({
      id: "technical.http-error",
      category: "technical",
      severity: context.fetch.status >= 500 ? "critical" : "high",
      title: "HTTP status indicates an error",
      description: `The audited URL returned HTTP ${context.fetch.status}.`,
      evidence: { status: context.fetch.status },
      recommendation: "Return a successful 2xx status for canonical indexable pages.",
      affectedUrl: url
    }));
  }
  if (context.fetch.redirects.length > 2) {
    issues.push(issue({
      id: "technical.redirect-chain",
      category: "technical",
      severity: "medium",
      title: "Redirect chain is longer than expected",
      description: "Long redirect chains slow crawling and can dilute signal consolidation.",
      evidence: { redirects: context.fetch.redirects },
      recommendation: "Point internal and canonical URLs directly at the final destination.",
      affectedUrl: url
    }));
  }
  if (!p.canonical) {
    issues.push(issue({
      id: "technical.missing-canonical",
      category: "technical",
      severity: "medium",
      title: "Canonical URL is missing",
      description: "The page does not declare a canonical URL.",
      recommendation: "Add a self-referencing canonical link unless a deliberate canonical target exists.",
      affectedUrl: url
    }));
  }
  if (p.robots && /noindex/i.test(p.robots)) {
    issues.push(issue({
      id: "technical.noindex",
      category: "technical",
      severity: "critical",
      title: "Meta robots blocks indexing",
      description: "The page includes a noindex directive.",
      evidence: { robots: p.robots },
      recommendation: "Remove noindex from pages intended to rank.",
      affectedUrl: url
    }));
  }
  if (!p.lang) {
    issues.push(issue({
      id: "technical.missing-lang",
      category: "technical",
      severity: "low",
      title: "HTML language is missing",
      description: "The html element has no lang attribute.",
      recommendation: "Set a valid language code on the html element.",
      affectedUrl: url
    }));
  }
  if (!p.viewport) {
    issues.push(issue({
      id: "technical.missing-viewport",
      category: "technical",
      severity: "high",
      title: "Viewport meta tag is missing",
      description: "Mobile rendering may be poor without a viewport declaration.",
      recommendation: "Add a responsive viewport meta tag.",
      affectedUrl: url
    }));
  }
  if (parsedUrl.protocol !== "https:") {
    issues.push(issue({
      id: "technical.not-https",
      category: "technical",
      severity: "high",
      title: "Page is not served over HTTPS",
      description: "The final URL does not use HTTPS.",
      evidence: { finalUrl: url },
      recommendation: "Serve all public pages over HTTPS and redirect HTTP to HTTPS.",
      affectedUrl: url
    }));
  }
  if (p.h1s.length !== 1) {
    issues.push(issue({
      id: "technical.h1-count",
      category: "technical",
      severity: p.h1s.length === 0 ? "high" : "medium",
      title: "Unexpected H1 count",
      description: `The page has ${p.h1s.length} H1 elements.`,
      evidence: { h1s: p.h1s },
      recommendation: "Use one clear H1 that describes the primary page topic.",
      affectedUrl: url
    }));
  }
  const hasHeadingDepth = p.headings.some((heading) => heading.level >= 2);
  if (p.headings.length > 0 && !hasHeadingDepth) {
    issues.push(issue({
      id: "technical.shallow-headings",
      category: "technical",
      severity: "low",
      title: "Heading structure is shallow",
      description: "The page has headings but no supporting H2 or deeper structure.",
      recommendation: "Use H2/H3 sections to make the document easier to scan and extract.",
      affectedUrl: url
    }));
  }
  const inaccessibleLinks = p.links.filter((link) => !link.accessible);
  if (inaccessibleLinks.length > 0) {
    issues.push(issue({
      id: "technical.links-without-accessible-text",
      category: "technical",
      severity: "medium",
      title: "Links without accessible text",
      description: "Some links have no text, aria-label, or image alt text.",
      evidence: { count: inaccessibleLinks.length, examples: inaccessibleLinks.slice(0, 5).map((link) => link.href) },
      recommendation: "Add descriptive link text or aria-label values.",
      affectedUrl: url
    }));
  }

  const sampledInternalLinks = context.networkPolicy?.allowPrivateNetwork ? [] : p.links
    .filter((link) => link.internal && /^https?:/.test(link.href))
    .slice(0, 5);
  const broken: Array<{ href: string; status: number | null }> = [];
  await Promise.all(sampledInternalLinks.map(async (link) => {
    const status = await headStatus(link.href, 5000, context.networkPolicy);
    if (status === null || status >= 400) broken.push({ href: link.href, status });
  }));
  broken.sort((a, b) => a.href.localeCompare(b.href));
  if (broken.length > 0) {
    issues.push(issue({
      id: "technical.sampled-broken-internal-links",
      category: "technical",
      severity: "medium",
      title: "Sampled internal links may be broken",
      description: "A limited HEAD-check sample found internal links that did not return a successful response.",
      evidence: { sampled: sampledInternalLinks.length, broken },
      recommendation: "Crawl internal links fully and fix or redirect broken destinations.",
      affectedUrl: url
    }));
  }

  return {
    category: "technical",
    issues,
    summary: {
      status: context.fetch.status,
      redirects: context.fetch.redirects.length,
      canonical: p.canonical,
      robots: p.robots,
      h1Count: p.h1s.length,
      sampledInternalLinks: sampledInternalLinks.length
    },
    errors: []
  };
}



