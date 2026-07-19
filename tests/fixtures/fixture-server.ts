import http from "node:http";
import zlib from "node:zlib";

export type FixtureServer = {
  server: http.Server;
  baseUrl: string;
  requestCounts: Map<string, number>;
  close(): Promise<void>;
};

export type FixtureServerOptions = {
  robotsMode?: "normal" | "missing" | "inaccessible" | "star";
  delayMs?: number;
};

function html(base: string, title: string, h1: string, body: string, links = "", head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="Description for ${title} fixture page with enough useful text."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="${base}${title === "Home" ? "/" : `/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}">${head}</head><body><header><a href="/">Home</a><a href="/category">Category</a></header><main><h1>${h1}</h1><p>${body}</p>${links}</main><footer>Common footer navigation legal privacy contact</footer></body></html>`;
}

function xmlUrl(base: string, loc: string): string {
  return `<url><loc>${base}${loc}</loc></url>`;
}

export async function startFixtureServer(options: FixtureServerOptions = {}): Promise<FixtureServer> {
  const requestCounts = new Map<string, number>();
  let baseUrl = "";
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl || "http://127.0.0.1");
    requestCounts.set(url.pathname + url.search, (requestCounts.get(url.pathname + url.search) ?? 0) + 1);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));

    if (url.pathname === "/robots.txt") {
      if (options.robotsMode === "missing") { res.statusCode = 404; res.end("missing"); return; }
      if (options.robotsMode === "inaccessible") { res.statusCode = 500; res.end("error"); return; }
      res.setHeader("content-type", "text/plain");
      const agent = options.robotsMode === "star" ? "*" : "CodexSEO";
      res.end(`User-agent: OtherBot\nDisallow: /\n\nUser-agent: ${agent}\nDisallow: /blocked\nAllow: /blocked/allowed\nCrawl-delay: 0\nSitemap: ${baseUrl}/sitemap-index.xml\n`);
      return;
    }

    if (url.pathname === "/sitemap-index.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(`<sitemapindex><sitemap><loc>${baseUrl}/sitemap.xml</loc></sitemap><sitemap><loc>${baseUrl}/nested-sitemap-index.xml</loc></sitemap><sitemap><loc>${baseUrl}/sitemap.xml.gz</loc></sitemap><sitemap><loc>${baseUrl}/invalid-sitemap.xml</loc></sitemap><sitemap><loc>${baseUrl}/missing-sitemap.xml</loc></sitemap></sitemapindex>`);
      return;
    }
    if (url.pathname === "/nested-sitemap-index.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(`<sitemapindex><sitemap><loc>${baseUrl}/sitemap-index.xml</loc></sitemap><sitemap><loc>${baseUrl}/extra-sitemap.xml</loc></sitemap></sitemapindex>`);
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(`<urlset>${["/", "/category", "/product?id=1", "/product?id=2", "/duplicate-a", "/duplicate-b", "/near-a", "/near-b", "/noindex", "/orphan", "/blocked", "/blocked/allowed", "/js", "/xss"].map((loc) => xmlUrl(baseUrl, loc)).join("")}<url><loc>https://outside.example/page</loc></url></urlset>`);
      return;
    }
    if (url.pathname === "/extra-sitemap.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(`<urlset>${xmlUrl(baseUrl, "/deep/level-3")}${xmlUrl(baseUrl, "/noindex")}</urlset>`);
      return;
    }
    if (url.pathname === "/sitemap.xml.gz") {
      res.setHeader("content-type", "application/gzip");
      res.end(zlib.gzipSync(`<urlset>${xmlUrl(baseUrl, "/gzip-only")}${xmlUrl(baseUrl, "/orphan")}</urlset>`));
      return;
    }
    if (url.pathname === "/invalid-sitemap.xml") { res.setHeader("content-type", "application/xml"); res.end("<urlset><url>"); return; }
    if (url.pathname === "/missing-sitemap.xml") { res.statusCode = 404; res.end("missing"); return; }

    if (url.pathname === "/redirect") { res.statusCode = 301; res.setHeader("location", "/redirect-target"); res.end(); return; }
    if (url.pathname === "/redirect-chain") { res.statusCode = 302; res.setHeader("location", "/redirect"); res.end(); return; }
    if (url.pathname === "/redirect-loop") { res.statusCode = 302; res.setHeader("location", "/redirect-loop"); res.end(); return; }
    if (url.pathname === "/redirect-external") { res.statusCode = 302; res.setHeader("location", "https://example.org/out"); res.end(); return; }
    if (url.pathname === "/redirect-blocked") { res.statusCode = 302; res.setHeader("location", "/blocked"); res.end(); return; }
    if (url.pathname === "/redirect-credentials") { res.statusCode = 302; res.setHeader("location", "http://user:pass@127.0.0.1/private"); res.end(); return; }
    if (url.pathname === "/redirect-ipv4") { res.statusCode = 302; res.setHeader("location", ["http://", ["10", "0", "0", "1"].join("."), "/private"].join("")); res.end(); return; }
    if (url.pathname === "/redirect-ipv6") { res.statusCode = 302; res.setHeader("location", "http://[::1]/private"); res.end(); return; }
    if (url.pathname === "/redirect-link-local") { res.statusCode = 302; res.setHeader("location", ["http://", ["169", "254", "1", "1"].join("."), "/private"].join("")); res.end(); return; }

    const nonHtml = new Map<string, string>([["/asset.jpg", "image/jpeg"], ["/asset.png", "image/png"], ["/asset.svg", "image/svg+xml"], ["/asset.webp", "image/webp"], ["/file.pdf", "application/pdf"], ["/archive.zip", "application/zip"], ["/video.mp4", "video/mp4"], ["/font.woff2", "font/woff2"], ["/binary.exe", "application/octet-stream"], ["/api-data", "application/json"]]);
    if (nonHtml.has(url.pathname)) { res.setHeader("content-type", nonHtml.get(url.pathname)!); res.end(url.pathname === "/api-data" ? '{"ok":true}' : ""); return; }

    res.setHeader("content-type", "text/html");
    if (url.pathname === "/") return res.end(html(baseUrl, "Home", "Home", "Home page links to core fixture sections and important crawl targets.", `<a href="/category">Category</a><a href="/product?id=1&utm_source=a#g">Product One</a><a href="/product?id=2">Product Two</a><a href="/deep/level-1">Deep</a><a href="/short-target">Short Target</a><a href="/redirect">Redirect</a><a href="/missing">Missing</a><a href="/duplicate-a">Duplicate A</a><a href="/duplicate-b">Duplicate B</a><a href="/near-a">Near A</a><a href="/near-b">Near B</a><a href="/noindex">Noindex</a><a href="/blocked">Blocked</a><a href="/blocked/allowed">Allowed blocked child</a><a href="/js">JS</a><a href="https://external.example/page">External</a><a href="mailto:test@example.com">Mail</a><a href="tel:+10000000000">Phone</a><a href="javascript:void(0)">JS void</a><a href="/logout">Logout</a><a href="/admin">Admin</a><a href="/cart">Cart</a><a href="/checkout">Checkout</a><a href="/events/2026/07/17">Calendar</a><a href="/category?sort=price">Sort</a><a href="/asset.jpg">JPG</a><a href="/asset.png">PNG</a><a href="/asset.svg">SVG</a><a href="/asset.webp">WEBP</a><a href="/file.pdf">PDF</a><a href="/archive.zip">ZIP</a><a href="/video.mp4">MP4</a><a href="/font.woff2">FONT</a><a href="/binary.exe">EXE</a><a href="/api-data">API</a><a href="/xss">XSS</a>`));
    if (url.pathname === "/category") return res.end(html(baseUrl, "Category", "Category", "Category hub with crawlable links and enough unique content.", `<a href="/product?id=1">Product One clean</a><a href="/deep/level-2">Alternate shorter deep path</a>`));
    if (url.pathname === "/product") return res.end(html(baseUrl, `Product ${url.searchParams.get("id") ?? "none"}`, `Product ${url.searchParams.get("id") ?? "none"}`, `Product detail ${url.searchParams.get("id") ?? "none"} has unique specifications and buying guidance.`));
    if (url.pathname === "/deep/level-1") return res.end(html(baseUrl, "Level 1", "Level 1", "Depth one page.", `<a href="/deep/level-2">Level 2</a><a href="/short-target">Target long path</a>`));
    if (url.pathname === "/deep/level-2") return res.end(html(baseUrl, "Level 2", "Level 2", "Depth two page.", `<a href="/deep/level-3">Level 3</a><a href="/short-target">Shorter rediscovery</a>`));
    if (url.pathname === "/deep/level-3") return res.end(html(baseUrl, "Level 3", "Level 3", "Depth three page.", `<a href="/deep/level-4">Level 4</a>`));
    if (url.pathname === "/deep/level-4") return res.end(html(baseUrl, "Level 4", "Level 4", "Depth four page.", `<a href="/deep/level-5">Level 5</a>`));
    if (url.pathname === "/deep/level-5") return res.end(html(baseUrl, "Level 5", "Level 5", "Depth five page."));
    if (url.pathname === "/short-target") return res.end(html(baseUrl, "Short Target", "Short Target", "This target can be discovered through multiple path lengths."));
    if (url.pathname === "/redirect-target") return res.end(html(baseUrl, "Redirect Target", "Redirect Target", "Redirect destination page."));
    if (url.pathname === "/duplicate-a" || url.pathname === "/duplicate-b") return res.end(html(baseUrl, "Duplicate", "Duplicate H1", "Exact duplicate main body alpha beta gamma delta epsilon zeta eta theta iota kappa."));
    if (url.pathname === "/near-a") return res.end(html(baseUrl, "Near A", "Near A", "Near duplicate article apple banana cherry durable evergreen focused guidance ranking crawler analysis optimization shared unique alpha."));
    if (url.pathname === "/near-b") return res.end(html(baseUrl, "Near B", "Near B", "Near duplicate article apple banana cherry durable evergreen focused guidance ranking crawler analysis optimization shared unique beta."));
    if (url.pathname === "/template-a") return res.end(html(baseUrl, "Template A", "Template A", "Shared header footer navigation but main content explains blue enterprise analytics migration planning."));
    if (url.pathname === "/template-b") return res.end(html(baseUrl, "Template B", "Template B", "Shared header footer navigation but main content explains green ecommerce catalog merchandising operations."));
    if (url.pathname === "/noindex") return res.end(html(baseUrl, "Noindex", "Noindex", "Noindex page in sitemap.", "", '<meta name="robots" content="noindex,nofollow">'));
    if (url.pathname === "/external-canonical") return res.end(html(baseUrl, "External Canonical", "External Canonical", "External canonical page.", "", '<link rel="canonical" href="https://external.example/canonical">'));
    if (url.pathname === "/canonical-404") return res.end(html(baseUrl, "Canonical 404", "Canonical 404", "Canonical points to a missing page.", "", `<link rel="canonical" href="${baseUrl}/missing">`));
    if (url.pathname === "/canonical-redirect") return res.end(html(baseUrl, "Canonical Redirect", "Canonical Redirect", "Canonical points to a redirect.", "", `<link rel="canonical" href="${baseUrl}/redirect">`));
    if (url.pathname === "/orphan") return res.end(html(baseUrl, "Orphan", "Orphan", "Orphan page appears in sitemap only."));
    if (url.pathname === "/gzip-only") return res.end(html(baseUrl, "Gzip Only", "Gzip Only", "Only discovered through gzipped sitemap."));
    if (url.pathname === "/blocked") return res.end(html(baseUrl, "Blocked", "Blocked", "Robots should block this page."));
    if (url.pathname === "/blocked/allowed") return res.end(html(baseUrl, "Allowed", "Allowed", "Allow rule under a blocked path."));
    if (url.pathname === "/xss") return res.end(html(baseUrl, '<script>alert("xss")</script>', "XSS", "This title must be escaped in reports."));
    if (url.pathname === "/js") return res.end(`<!doctype html><html><head><title>JS Shell</title></head><body><div id="app"></div><script>document.getElementById('app').innerHTML='<h1>Rendered JS Content</h1><a href="/js-target">JS Target</a><p>Dynamic content added by script.</p>';</script></body></html>`);
    if (url.pathname === "/js-target") return res.end(html(baseUrl, "JS Target", "JS Target", "Target discovered only after browser rendering."));
    if (url.pathname === "/missing") { res.statusCode = 404; return res.end(html(baseUrl, "Missing", "Missing", "Missing page.")); }
    if (url.pathname === "/server-error") { res.statusCode = 500; return res.end(html(baseUrl, "Server Error", "Server Error", "Error page.")); }
    res.statusCode = 404;
    res.end(html(baseUrl, "Not Found", "Not Found", "Fallback missing page."));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("fixture server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    baseUrl,
    requestCounts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

