import http from "node:http";

export type DiffFixtureServer = { server: http.Server; v1Url: string; v2Url: string; close(): Promise<void> };
function page(title: string, h1: string, body: string, links = "", head = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} description"><meta name="viewport" content="width=device-width"><link rel="canonical" href="/${title.toLowerCase().replace(/[^a-z0-9]+/g,"-")}">${head}</head><body><nav><a href="./">Home</a></nav><main><h1>${h1}</h1><p>${body}</p>${links}</main></body></html>`;
}
export async function startDiffFixtureServer(): Promise<DiffFixtureServer> {
  let base = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base || "http://127.0.0.1");
    const [version, ...rest] = url.pathname.split("/").filter(Boolean);
    const path = `/${rest.join("/")}` || "/";
    res.setHeader("content-type", "text/html");
    if (path === "/robots.txt") { res.setHeader("content-type", "text/plain"); res.end(`User-agent: CodexSEO\nAllow: /\nSitemap: ${base}/${version}/sitemap.xml\n`); return; }
    if (path === "/sitemap.xml") { res.setHeader("content-type", "application/xml"); res.end(`<urlset><url><loc>${base}/${version}/</loc></url><url><loc>${base}/${version}/fixed</loc></url><url><loc>${base}/${version}/duplicate-a</loc></url><url><loc>${base}/${version}/duplicate-b</loc></url>${version === "v1" ? `<url><loc>${base}/${version}/removed</loc></url>` : `<url><loc>${base}/${version}/new-page</loc></url>`}</urlset>`); return; }
    if (path === "/") { const links = version === "v1" ? '<a href="removed">Removed</a><a href="fixed">Fixed</a><a href="duplicate-a">A</a><a href="duplicate-b">B</a><a href="deep/page">Deep</a>' : '<a href="fixed">Fixed</a><a href="new-page">New</a><a href="duplicate-a">A</a><a href="changed-content">Changed</a><a href="missing-target">Broken</a>'; res.end(page("Home", "Home", "Home page for diff fixture", links)); return; }
    if (path === "/fixed") { const head = version === "v1" ? '<meta name="robots" content="noindex">' : ""; res.end(page("Fixed", "Fixed", "This page becomes indexable in v2", "", head)); return; }
    if (path === "/removed" && version === "v1") { res.end(page("Removed", "Removed", "This page is removed in v2")); return; }
    if (path === "/new-page" && version === "v2") { res.end(page("New Page", "New Page", "A new page introduced in v2")); return; }
    if (path === "/duplicate-a") { res.end(page("Duplicate", "Duplicate", version === "v1" ? "same duplicate body alpha beta gamma" : "unique improved body alpha beta gamma")); return; }
    if (path === "/duplicate-b") { if (version === "v2") { res.statusCode = 404; res.end(page("Broken Duplicate", "Broken Duplicate", "This page now fails")); return; } res.end(page("Duplicate", "Duplicate", "same duplicate body alpha beta gamma")); return; }
    if (path === "/deep/page") { res.end(page("Deep", "Deep", "Deep page in v1")); return; }
    if (path === "/changed-content" && version === "v2") { res.end(page("Changed Content", "Changed Content", "Content changed intentionally without SEO regression")); return; }
    res.statusCode = 404; res.end(page("Not Found", "Not Found", "Missing"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("diff fixture failed");
  base = `http://127.0.0.1:${address.port}`;
  return { server, v1Url: `${base}/v1/`, v2Url: `${base}/v2/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
