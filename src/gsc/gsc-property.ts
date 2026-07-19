import type { GscClient } from "./gsc-client.js";

export type GscPropertyCompatibility = "compatible" | "partially-compatible" | "incompatible" | "inaccessible";

export function normalizeProperty(property: string): string {
  if (property.startsWith("sc-domain:")) return property.toLowerCase();
  const url = new URL(property);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.toString();
}

export function propertyMatchesUrl(property: string, rawUrl: string): GscPropertyCompatibility {
  const url = new URL(rawUrl);
  if (property.startsWith("sc-domain:")) {
    const domain = property.slice("sc-domain:".length).toLowerCase();
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`) ? "compatible" : "incompatible";
  }
  const prop = new URL(property);
  if (prop.hostname.toLowerCase() !== url.hostname.toLowerCase()) return "incompatible";
  if (prop.protocol !== url.protocol) return "partially-compatible";
  return url.href.startsWith(prop.href) || prop.pathname === "/" ? "compatible" : "partially-compatible";
}

export async function inspectPropertyAccess(client: GscClient, property: string, auditUrl?: string): Promise<{ status: GscPropertyCompatibility | "inaccessible"; properties: string[]; warnings: string[] }> {
  const properties = await client.listProperties();
  const normalized = normalizeProperty(property);
  const accessible = properties.some((item) => normalizeProperty(item) === normalized);
  if (!accessible) return { status: "inaccessible", properties, warnings: [`GSC property is not accessible: ${property}`] };
  return { status: auditUrl ? propertyMatchesUrl(property, auditUrl) : "compatible", properties, warnings: [] };
}