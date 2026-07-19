import type { AuditContext } from "../core/audit-context.js";
import { issue, type AnalyzerResult, type SeoIssue } from "../core/issue.js";

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  return (text.toLowerCase().match(new RegExp(needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
}

export async function analyzeContent(context: AuditContext): Promise<AnalyzerResult> {
  const p = context.parsed;
  const issues: SeoIssue[] = [];
  const url = context.finalUrl;
  const words = p.bodyText.split(/\s+/).filter(Boolean);
  const paragraphs = context.html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length > 140);
  const placeholderRegex = /\b(lorem ipsum|coming soon|placeholder|sample text|under construction)\b/gi;
  const placeholderBlocks = p.visibleTextBlocks.filter((block) => { placeholderRegex.lastIndex = 0; return placeholderRegex.test(block); });
  const placeholderMatches = placeholderBlocks.flatMap((block) => block.match(placeholderRegex) ?? []);

  if (!p.title || p.title.length < 15 || p.title.length > 65) {
    issues.push(issue({
      id: "content.title-length",
      category: "content",
      severity: !p.title ? "high" : "medium",
      title: "Title is missing or outside recommended length",
      description: p.title ? `The title is ${p.title.length} characters.` : "The page has no title.",
      evidence: { title: p.title, length: p.title.length },
      recommendation: "Write a specific title of roughly 15-65 characters.",
      affectedUrl: url
    }));
  }
  if (!p.metaDescription || p.metaDescription.length < 70 || p.metaDescription.length > 160) {
    issues.push(issue({
      id: "content.meta-description-length",
      category: "content",
      severity: !p.metaDescription ? "medium" : "low",
      title: "Meta description is missing or outside recommended length",
      description: p.metaDescription ? `The meta description is ${p.metaDescription.length} characters.` : "The page has no meta description.",
      evidence: { metaDescription: p.metaDescription, length: p.metaDescription.length },
      recommendation: "Write a concise description around 70-160 characters that matches the page intent.",
      affectedUrl: url
    }));
  }
  if (p.h1s.length !== 1) {
    issues.push(issue({
      id: "content.h1-clarity",
      category: "content",
      severity: p.h1s.length === 0 ? "high" : "medium",
      title: "H1 does not clearly define one primary topic",
      description: `The page has ${p.h1s.length} H1 elements.`,
      evidence: { h1s: p.h1s },
      recommendation: "Use one audience-facing H1 aligned with search intent.",
      affectedUrl: url
    }));
  }
  if (words.length < 250) {
    issues.push(issue({
      id: "content.thin-main-content",
      category: "content",
      severity: words.length < 100 ? "high" : "medium",
      title: "Main content appears thin",
      description: `Only ${words.length} words were extracted from the page body.`,
      evidence: { wordCount: words.length },
      recommendation: "Add useful, original content that answers the page's target intent.",
      affectedUrl: url
    }));
  }
  if (p.textToHtmlRatio < 0.05) {
    issues.push(issue({
      id: "content.low-text-html-ratio",
      category: "content",
      severity: "low",
      title: "Text-to-HTML ratio is low",
      description: "The page may contain heavy markup relative to extractable text.",
      evidence: { textToHtmlRatio: p.textToHtmlRatio },
      recommendation: "Ensure important content is rendered as accessible HTML text.",
      affectedUrl: url
    }));
  }
  const titleRepeats = countOccurrences(p.bodyText, p.title);
  const h1Repeats = p.h1s.reduce((sum, h1) => sum + countOccurrences(p.bodyText, h1), 0);
  if (titleRepeats > 4 || h1Repeats > 6) {
    issues.push(issue({
      id: "content.excessive-title-h1-repetition",
      category: "content",
      severity: "low",
      title: "Title or H1 appears excessively repeated",
      description: "Repeated exact phrases can read as templated or keyword-stuffed.",
      evidence: { titleRepeats, h1Repeats },
      recommendation: "Use natural variants and avoid repeating the same phrase in every section.",
      affectedUrl: url
    }));
  }
  if (longParagraphs.length > 0) {
    issues.push(issue({
      id: "content.long-paragraphs",
      category: "content",
      severity: "low",
      title: "Some paragraphs are unusually long",
      description: "Very long paragraphs reduce scannability.",
      evidence: { count: longParagraphs.length },
      recommendation: "Break long paragraphs into focused blocks with descriptive subheadings.",
      affectedUrl: url
    }));
  }
  if (placeholderMatches.length > 0) {
    issues.push(issue({
      id: "content.placeholder-copy",
      category: "content",
      severity: "high",
      title: "Placeholder or generic content detected",
      description: "The page contains copy that appears unfinished or generic.",
      evidence: { matches: [...new Set(placeholderMatches.map((match) => match.toLowerCase()))], snippets: placeholderBlocks.slice(0, 3).map((block) => block.slice(0, 220)) },
      recommendation: "Replace placeholder text with specific, verifiable page content.",
      affectedUrl: url
    }));
  }

  return {
    category: "content",
    issues,
    summary: {
      titleLength: p.title.length,
      metaDescriptionLength: p.metaDescription.length,
      wordCount: words.length,
      textToHtmlRatio: p.textToHtmlRatio,
      longParagraphs: longParagraphs.length
    },
    errors: []
  };
}


