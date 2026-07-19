import { fetch } from "undici";
import type { AuditContext } from "../core/audit-context.js";
import { issue, type AnalyzerResult, type SeoIssue } from "../core/issue.js";
import { assertPolicyUrl, type NetworkAccessPolicy } from "../core/network-policy.js";

const modernExtensions = new Set(["webp", "avif", "svg"]);

async function contentLength(url: string, networkPolicy?: NetworkAccessPolicy): Promise<number | null> {
  await assertPolicyUrl(url, networkPolicy);
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(4000) });
    const length = response.headers.get("content-length");
    return length ? Number(length) : null;
  } catch {
    return null;
  }
}

export async function analyzeImages(context: AuditContext): Promise<AnalyzerResult> {
  const p = context.parsed;
  const issues: SeoIssue[] = [];
  const base = new URL(context.finalUrl);
  const images = p.images;
  const missingAlt = images.filter((img) => img.alt === null || img.alt.trim() === "");
  const missingDimensions = images.filter((img) => !img.width || !img.height);
  const notLazy = images.filter((img) => img.loading !== "lazy");
  const legacy = images.filter((img) => img.extension && !modernExtensions.has(img.extension));
  const external = images.filter((img) => img.external);
  const genericNames = images.filter((img) => img.genericFileName);

  if (missingAlt.length > 0) {
    issues.push(issue({
      id: "images.missing-alt",
      category: "images",
      severity: "medium",
      title: "Images missing alt text",
      description: "Some images have no alt attribute or an empty alt value.",
      evidence: { count: missingAlt.length, examples: missingAlt.slice(0, 5).map((img) => img.src) },
      recommendation: "Add descriptive alt text for meaningful images and alt=\"\" for decorative images.",
      affectedUrl: context.finalUrl
    }));
  }
  if (missingDimensions.length > 0) {
    issues.push(issue({
      id: "images.missing-dimensions",
      category: "images",
      severity: "medium",
      title: "Images missing explicit dimensions",
      description: "Missing width or height can contribute to layout shifts.",
      evidence: { count: missingDimensions.length },
      recommendation: "Set width and height or reserve stable aspect-ratio boxes.",
      affectedUrl: context.finalUrl
    }));
  }
  if (notLazy.length > 3) {
    issues.push(issue({
      id: "images.lazy-loading",
      category: "images",
      severity: "low",
      title: "Many images are not lazy loaded",
      description: "Non-critical below-the-fold images should usually use lazy loading.",
      evidence: { count: notLazy.length },
      recommendation: "Use loading=\"lazy\" on non-LCP images and keep the primary hero image eager.",
      affectedUrl: context.finalUrl
    }));
  }
  if (legacy.length > 0) {
    issues.push(issue({
      id: "images.legacy-formats",
      category: "images",
      severity: "low",
      title: "Legacy image formats detected",
      description: "Some images use formats that may be larger than WebP or AVIF.",
      evidence: { extensions: [...new Set(legacy.map((img) => img.extension))] },
      recommendation: "Serve optimized WebP or AVIF variants where browser support allows.",
      affectedUrl: context.finalUrl
    }));
  }
  if (external.length > 0) {
    issues.push(issue({
      id: "images.external-images",
      category: "images",
      severity: "info",
      title: "External images detected",
      description: "External image hosts can affect caching, privacy, and reliability.",
      evidence: { count: external.length },
      recommendation: "Host critical images on the primary domain or a controlled CDN.",
      affectedUrl: context.finalUrl
    }));
  }
  if (genericNames.length > 0) {
    issues.push(issue({
      id: "images.generic-file-names",
      category: "images",
      severity: "low",
      title: "Generic image file names detected",
      description: "Generic image names provide little context to users or search systems.",
      evidence: { examples: genericNames.slice(0, 5).map((img) => img.src) },
      recommendation: "Use concise descriptive file names for meaningful images.",
      affectedUrl: context.finalUrl
    }));
  }

  const sampledSizes = await Promise.all(images.slice(0, 5).map(async (img) => {
    const absolute = new URL(img.src, base).toString();
    return { src: img.src, bytes: await contentLength(absolute, context.networkPolicy) };
  }));
  const oversized = sampledSizes.filter((entry) => entry.bytes !== null && entry.bytes > 250_000);
  if (oversized.length > 0) {
    issues.push(issue({
      id: "images.large-sampled-resources",
      category: "images",
      severity: "medium",
      title: "Sampled images are large",
      description: "A limited HEAD sample found images above 250 KB.",
      evidence: { oversized },
      recommendation: "Compress large images and serve responsive sizes.",
      affectedUrl: context.finalUrl
    }));
  }

  return {
    category: "images",
    issues,
    summary: {
      imageCount: images.length,
      missingAlt: missingAlt.length,
      missingDimensions: missingDimensions.length,
      external: external.length,
      sampledSizes
    },
    errors: []
  };
}


