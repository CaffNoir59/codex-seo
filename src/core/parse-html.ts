import * as cheerio from "cheerio";

export type PageIntent = "editorial" | "product" | "category" | "homepage" | "transactional" | "authentication" | "utility" | "configurator" | "unknown";

export type ParsedLink = {
  href: string;
  text: string;
  internal: boolean;
  accessible: boolean;
};

export type ParsedImage = {
  src: string;
  alt: string | null;
  width: string | null;
  height: string | null;
  loading: string | null;
  extension: string | null;
  external: boolean;
  genericFileName: boolean;
};

export type JsonLdBlock = {
  raw: string;
  valid: boolean;
  value?: unknown;
  error?: string;
};

export type ParsedHtml = {
  url: string;
  title: string;
  metaDescription: string;
  canonical: string | null;
  robots: string | null;
  lang: string | null;
  viewport: string | null;
  h1s: string[];
  headings: { level: number; text: string }[];
  bodyText: string;
  visibleTextBlocks: string[];
  textToHtmlRatio: number;
  links: ParsedLink[];
  images: ParsedImage[];
  jsonLd: JsonLdBlock[];
  faqLikeBlocks: number;
  dates: string[];
  forms: { count: number; passwordFields: number; searchFields: number; inputs: number };
  pageIntent: PageIntent;
};

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textOf($: cheerio.CheerioAPI, selector: string): string {
  return compactText($(selector).text());
}

function fileExtension(src: string): string | null {
  try {
    const path = new URL(src, "https://example.invalid").pathname;
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function isGenericImageName(src: string): boolean {
  const path = src.split("?")[0]?.split("#")[0] ?? "";
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  return /^(image|img|photo|pic|picture|hero|banner|untitled|default|placeholder)[-_]?\d*\.[a-z0-9]+$/.test(name);
}

function classifyPageIntent(input: { url: string; title: string; h1s: string[]; bodyText: string; forms: ParsedHtml["forms"]; jsonLd: JsonLdBlock[] }): PageIntent {
  const url = new URL(input.url);
  const path = url.pathname.toLowerCase();
  const query = url.search.toLowerCase();
  const titleH1 = `${input.title} ${input.h1s.join(" ")}`.toLowerCase();
  const body = input.bodyText.toLowerCase();
  const jsonTypes = input.jsonLd.flatMap((block) => {
    const value = block.value as { "@type"?: unknown } | undefined;
    const type = value?.["@type"];
    return Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
  }).join(" ").toLowerCase();

  if (path === "/" || path === "") return "homepage";
  if (input.forms.passwordFields > 0 || /\b(connexion|login|inscription|sign up|mot de passe|password|oauth|auth)\b/.test(`${path} ${titleH1}`)) return "authentication";
  if (/\b(panier|cart|checkout|commande|payment|paiement|compte)\b/.test(`${path} ${titleH1}`)) return "transactional";
  if (/\b(creer|configur[a-z]*|customi[sz]e|builder|modele=|sur-mesure)/.test(`${path} ${query} ${titleH1} ${body.slice(0, 1000)}`)) return "configurator";
  if (/\b(article|blogposting|newsarticle)\b/.test(jsonTypes) || /\b(blog|guide|article|actualit|conseil|publication)\b/.test(`${path} ${titleH1}`)) return "editorial";
  if (/\b(category|collection|liste|catalogue|communaute|community|toutes nos|tous les|montres)\b/.test(`${jsonTypes} ${path} ${titleH1}`)) return "category";
  if (/\b(contact|support|aide|privacy|confidentialit|terms|conditions|faq)\b/.test(`${path} ${titleH1}`)) return "utility";
  if (/\b(product|produit|offer|sku)\b/.test(jsonTypes) || /\b(prix|ajouter au panier|acheter|model[eè])\b/.test(`${titleH1} ${body.slice(0, 1200)}`)) return "product";
  return "unknown";
}

export function parseHtml(html: string, url: string): ParsedHtml {
  const $ = cheerio.load(html);
  const base = new URL(url);

  const jsonLd: JsonLdBlock[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    try {
      jsonLd.push({ raw, valid: true, value: JSON.parse(raw) as unknown });
    } catch (error) {
      jsonLd.push({ raw, valid: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  $("script,style,template,noscript,svg,canvas").remove();
  $("[hidden],[aria-hidden='true']").remove();

  const visibleTextBlocks = $("main p,main li,main h1,main h2,main h3,article p,article li,body p,body li,body h1,body h2,body h3")
    .map((_, el) => compactText($(el).text()))
    .get()
    .filter(Boolean);
  const bodyText = compactText($("body").text());

  const links: ParsedLink[] = [];
  $("a[href]").each((_, el) => {
    const hrefRaw = $(el).attr("href") ?? "";
    const text = compactText($(el).text());
    const aria = $(el).attr("aria-label")?.trim() ?? "";
    try {
      const absolute = new URL(hrefRaw, base);
      links.push({
        href: absolute.toString(),
        text,
        internal: absolute.hostname === base.hostname,
        accessible: Boolean(text || aria || $(el).find("img[alt]").attr("alt"))
      });
    } catch {
      links.push({ href: hrefRaw, text, internal: false, accessible: Boolean(text || aria) });
    }
  });

  const images: ParsedImage[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
    let external = false;
    try {
      external = new URL(src, base).hostname !== base.hostname;
    } catch {
      external = false;
    }
    images.push({
      src,
      alt: $(el).attr("alt") ?? null,
      width: $(el).attr("width") ?? null,
      height: $(el).attr("height") ?? null,
      loading: $(el).attr("loading") ?? null,
      extension: fileExtension(src),
      external,
      genericFileName: isGenericImageName(src)
    });
  });

  const forms = {
    count: $("form").length,
    passwordFields: $("input[type='password']").length,
    searchFields: $("input[type='search']").length,
    inputs: $("input,textarea,select").length
  };
  const title = textOf($, "title");
  const h1s = $("h1").map((_, el) => compactText($(el).text())).get();
  const htmlLength = Math.max(html.length, 1);
  const parsed = {
    url,
    title,
    metaDescription: $('meta[name="description" i]').attr("content")?.trim() ?? "",
    canonical: $('link[rel="canonical" i]').attr("href") ?? null,
    robots: $('meta[name="robots" i]').attr("content") ?? null,
    lang: $("html").attr("lang") ?? null,
    viewport: $('meta[name="viewport" i]').attr("content") ?? null,
    h1s,
    headings: $("h1,h2,h3,h4,h5,h6").map((_, el) => ({ level: Number(el.tagName.slice(1)), text: compactText($(el).text()) })).get(),
    bodyText,
    visibleTextBlocks,
    textToHtmlRatio: Number((bodyText.length / htmlLength).toFixed(4)),
    links,
    images,
    jsonLd,
    faqLikeBlocks: $("details, [itemtype*='FAQPage'], .faq, #faq").length,
    dates: $("time, meta[property='article:published_time'], meta[property='article:modified_time']")
      .map((_, el) => $(el).attr("datetime") ?? $(el).attr("content") ?? $(el).text().trim())
      .get()
      .filter(Boolean),
    forms,
    pageIntent: "unknown" as PageIntent
  };
  parsed.pageIntent = classifyPageIntent(parsed);
  return parsed;
}


