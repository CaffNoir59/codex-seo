import type { AuditContext } from "../core/audit-context.js";
import { issue, type AnalyzerResult, type SeoIssue } from "../core/issue.js";

function valuesOfType(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === "string");
  if (typeof type === "string") return [type];
  if (Array.isArray(object["@graph"])) return object["@graph"].flatMap(valuesOfType);
  return [];
}

function hasProperty(value: unknown, property: string): boolean {
  return Boolean(value && typeof value === "object" && property in (value as Record<string, unknown>));
}

export async function analyzeSchema(context: AuditContext): Promise<AnalyzerResult> {
  const p = context.parsed;
  const issues: SeoIssue[] = [];
  const url = context.finalUrl;
  const validBlocks = p.jsonLd.filter((block) => block.valid);
  const invalidBlocks = p.jsonLd.filter((block) => !block.valid);
  const types = validBlocks.flatMap((block) => valuesOfType(block.value)).sort();
  const duplicateTypes = types.filter((type, index) => types.indexOf(type) !== index);

  if (p.jsonLd.length === 0) {
    issues.push(issue({
      id: "schema.no-json-ld",
      category: "schema",
      severity: "medium",
      title: "No JSON-LD structured data detected",
      description: "The page does not include JSON-LD schema markup.",
      recommendation: "Add relevant Schema.org JSON-LD for the page type.",
      affectedUrl: url
    }));
  }
  if (invalidBlocks.length > 0) {
    issues.push(issue({
      id: "schema.invalid-json-ld",
      category: "schema",
      severity: "high",
      title: "Invalid JSON-LD detected",
      description: "At least one JSON-LD block could not be parsed.",
      evidence: { errors: invalidBlocks.map((block) => block.error) },
      recommendation: "Fix JSON syntax before relying on structured data.",
      affectedUrl: url
    }));
  }

  for (const block of validBlocks) {
    const typeList = valuesOfType(block.value);
    if (typeList.includes("Organization") && !hasProperty(block.value, "name")) {
      issues.push(issue({
        id: "schema.organization-missing-name",
        category: "schema",
        severity: "medium",
        title: "Organization schema is missing name",
        description: "Organization markup should identify the organization name.",
        recommendation: "Add a name property to Organization schema.",
        affectedUrl: url
      }));
    }
    if (typeList.some((type) => ["Article", "BlogPosting", "NewsArticle"].includes(type)) && !hasProperty(block.value, "headline")) {
      issues.push(issue({
        id: "schema.article-missing-headline",
        category: "schema",
        severity: "medium",
        title: "Article schema is missing headline",
        description: "Article-like schema should include a headline.",
        recommendation: "Add headline and author/date properties where applicable.",
        affectedUrl: url
      }));
    }
    if (typeList.includes("Product") && !hasProperty(block.value, "offers")) {
      issues.push(issue({
        id: "schema.product-missing-offers",
        category: "schema",
        severity: "high",
        title: "Product schema is missing offers",
        description: "Product markup lacks Offer data.",
        recommendation: "Add offers with price, priceCurrency, availability, and URL.",
        affectedUrl: url
      }));
    }
  }
  if (duplicateTypes.length > 0) {
    issues.push(issue({
      id: "schema.duplicate-types",
      category: "schema",
      severity: "low",
      title: "Duplicate schema types detected",
      description: "Multiple JSON-LD blocks declare the same Schema.org type.",
      evidence: { duplicateTypes: [...new Set(duplicateTypes)] },
      recommendation: "Consolidate duplicate markup unless each block describes a distinct entity.",
      affectedUrl: url
    }));
  }
  if (p.canonical && validBlocks.some((block) => JSON.stringify(block.value).includes('"url"')) && !JSON.stringify(validBlocks.map((b) => b.value)).includes(p.canonical)) {
    issues.push(issue({
      id: "schema.url-canonical-mismatch-heuristic",
      category: "schema",
      severity: "info",
      title: "Schema URL may not match canonical",
      description: "This heuristic saw schema URL properties but did not find the canonical URL string in JSON-LD.",
      evidence: { canonical: p.canonical },
      recommendation: "Check that schema url/mainEntityOfPage values align with the canonical URL.",
      affectedUrl: url
    }));
  }

  return {
    category: "schema",
    issues,
    summary: { jsonLdBlocks: p.jsonLd.length, validJsonLdBlocks: validBlocks.length, types },
    errors: []
  };
}
