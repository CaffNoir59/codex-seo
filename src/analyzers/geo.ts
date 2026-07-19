import type { AuditContext } from "../core/audit-context.js";
import { issue, type AnalyzerResult, type SeoIssue } from "../core/issue.js";
import type { PageIntent } from "../core/parse-html.js";

function countSentences(text: string): number {
  return (text.match(/[.!?](\s|$)/g) ?? []).length;
}

const nonEditorialIntents = new Set<PageIntent>(["transactional", "authentication", "utility", "configurator"]);

function editorialSeverity(intent: PageIntent, normal: "medium" | "low" | "info"): "medium" | "low" | "info" | null {
  if (nonEditorialIntents.has(intent)) return null;
  if (intent === "product" || intent === "category" || intent === "homepage") return normal === "medium" ? "info" : "info";
  return normal;
}

function notApplicableIssue(id: string, title: string, context: AuditContext): SeoIssue {
  return issue({
    id: `${id}.not-applicable`,
    category: "geo",
    severity: "info",
    title: `${title} not applied`,
    description: `This GEO editorial heuristic is not applied to ${context.pageIntent} pages.`,
    evidence: { pageIntent: context.pageIntent },
    recommendation: "No editorial GEO action is required for this page type.",
    affectedUrl: context.finalUrl
  });
}

export async function analyzeGeo(context: AuditContext): Promise<AnalyzerResult> {
  const p = context.parsed;
  const issues: SeoIssue[] = [];
  const url = context.finalUrl;
  const pageIntent = context.pageIntent ?? p.pageIntent;
  const hasDirectAnswer = p.bodyText.split(/\n|(?<=\.)\s+/).some((block) => {
    const words = block.trim().split(/\s+/).filter(Boolean).length;
    return words >= 30 && words <= 90 && /\b(is|are|means|helps|provides|includes|works|permet|aide|comprend|fonctionne)\b/i.test(block);
  });
  const hasSemanticHeadings = p.headings.length >= 3 && p.headings.some((heading) => heading.level === 2);
  const hasUsefulStructuredData = p.jsonLd.some((block) => block.valid);
  const hasOrgOrAuthor = /author|organization|about us|contact|founder|team|equipe|fondateur/i.test(p.bodyText);
  const externalCitations = p.links.filter((link) => !link.internal && link.accessible && /^https?:/.test(link.href));
  const extractibleBlocks = p.visibleTextBlocks.filter((block) => {
    const words = block.trim().split(/\s+/).filter(Boolean).length;
    return words >= 40 && words <= 120 && countSentences(block) >= 2;
  }).length;

  const directSeverity = editorialSeverity(pageIntent, "medium");
  if (!hasDirectAnswer) {
    if (directSeverity) issues.push(issue({ id: "geo.no-direct-answer-block", category: "geo", severity: directSeverity, title: "No clear direct-answer block detected", description: "This heuristic did not find a concise self-contained answer paragraph.", evidence: { pageIntent }, recommendation: "Add clear answer-first sections that summarize important topics in 40-90 words.", affectedUrl: url }));
    else issues.push(notApplicableIssue("geo.no-direct-answer-block", "Direct-answer block", context));
  }
  if (!hasSemanticHeadings) issues.push(issue({ id: "geo.weak-semantic-heading-structure", category: "geo", severity: nonEditorialIntents.has(pageIntent) ? "info" : "low", title: "Semantic heading structure is weak", description: "The page has limited heading structure for extracting topical sections.", evidence: { headingCount: p.headings.length, pageIntent }, recommendation: "Use descriptive H2/H3 headings where the page is meant to explain a topic.", affectedUrl: url }));
  if (p.faqLikeBlocks === 0 && !nonEditorialIntents.has(pageIntent)) issues.push(issue({ id: "geo.no-faq-structure", category: "geo", severity: "info", title: "No FAQ-like structure detected", description: "FAQ sections are not mandatory, but can make question-answer content easier to extract.", evidence: { pageIntent }, recommendation: "Add FAQ sections only where real user questions exist.", affectedUrl: url }));
  if (!hasUsefulStructuredData) issues.push(issue({ id: "geo.no-structured-data-support", category: "geo", severity: nonEditorialIntents.has(pageIntent) ? "info" : "medium", title: "No useful structured data support detected", description: "Valid structured data can help clarify entities and page purpose.", evidence: { pageIntent }, recommendation: "Add relevant JSON-LD for Organization, Article, Product, LocalBusiness, or WebPage as applicable.", affectedUrl: url }));
  if (!hasOrgOrAuthor && !nonEditorialIntents.has(pageIntent)) issues.push(issue({ id: "geo.missing-organization-author-signals", category: "geo", severity: "low", title: "Organization or author signals are weak", description: "The extracted text does not clearly mention author or organization context.", evidence: { pageIntent }, recommendation: "Expose author, organization, contact, and credibility information in crawlable text.", affectedUrl: url }));
  if (p.dates.length === 0) {
    const severity = editorialSeverity(pageIntent, "info");
    if (severity) issues.push(issue({ id: "geo.no-publication-or-update-date", category: "geo", severity, title: "No publication or update date detected", description: "Freshness cannot be inferred from the extracted HTML.", evidence: { pageIntent }, recommendation: "Show publication or modification dates on time-sensitive content.", affectedUrl: url }));
    else issues.push(notApplicableIssue("geo.no-publication-or-update-date", "Publication/update date", context));
  }
  if (externalCitations.length === 0) {
    const severity = editorialSeverity(pageIntent, "info");
    if (severity) issues.push(issue({ id: "geo.no-external-citations", category: "geo", severity, title: "No external citations detected", description: "The page has no accessible external source links.", evidence: { pageIntent }, recommendation: "Cite authoritative external sources where factual claims need support.", affectedUrl: url }));
    else issues.push(notApplicableIssue("geo.no-external-citations", "External citations", context));
  }
  if (extractibleBlocks < 2) {
    const severity = editorialSeverity(pageIntent, "low");
    if (severity) issues.push(issue({ id: "geo.few-extractible-blocks", category: "geo", severity, title: "Few autonomous content blocks detected", description: "The page may not expose many standalone passages suitable for answer extraction.", evidence: { extractibleBlocks, pageIntent }, recommendation: "Write sections that remain understandable when quoted independently.", affectedUrl: url }));
    else issues.push(notApplicableIssue("geo.few-extractible-blocks", "Autonomous extractible blocks", context));
  }

  return {
    category: "geo",
    issues,
    summary: { heuristic: true, pageIntent, hasDirectAnswer, headingCount: p.headings.length, faqLikeBlocks: p.faqLikeBlocks, externalCitations: externalCitations.length, extractibleBlocks },
    errors: []
  };
}

