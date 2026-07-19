import http from "node:http";

export type PerformanceFixtureServer = {
  baseUrl: string;
  lightUrl: string;
  heavyUrl: string;
  siteUrl: string;
  fastUrl: string;
  mediumUrl: string;
  slowUrl: string;
  verySlowUrl: string;
  requestCounts: Map<string, number>;
  close(): Promise<void>;
};

function page(title: string, body: string, links = "", head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1>${body}${links}</main></body></html>`;
}

export async function startPerformanceFixtureServer(): Promise<PerformanceFixtureServer> {
  const requestCounts = new Map<string, number>();
  let baseUrl = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", baseUrl || "http://127.0.0.1");
    requestCounts.set(url.pathname, (requestCounts.get(url.pathname) ?? 0) + 1);
    if (url.pathname === "/robots.txt") { res.setHeader("content-type", "text/plain"); res.end("User-agent: *\nAllow: /\n"); return; }
    if (url.pathname === "/redirect") { res.statusCode = 302; res.setHeader("location", "/light"); res.end(); return; }
    if (url.pathname === "/style.css") { res.setHeader("content-type", "text/css"); res.setHeader("content-length", "1200"); res.end("body{font-family:Arial,sans-serif}.hero{min-height:280px}".padEnd(1200, " ")); return; }
    if (url.pathname === "/app.js") { res.setHeader("content-type", "application/javascript"); const js = "window.__fixture=true;".padEnd(24000, " "); res.setHeader("content-length", String(Buffer.byteLength(js))); res.end(js); return; }
    if (url.pathname === "/longtask.js") { res.setHeader("content-type", "application/javascript"); res.end("const s=Date.now();while(Date.now()-s<130){};document.body.dataset.longtask='1';"); return; }
    if (url.pathname.startsWith("/img-")) { const body = Buffer.alloc(18000, 1); res.setHeader("content-type", "image/png"); res.setHeader("content-length", String(body.length)); res.end(body); return; }
    if (url.pathname === "/font.woff2") { const body = Buffer.alloc(4000, 2); res.setHeader("content-type", "font/woff2"); res.setHeader("content-length", String(body.length)); res.end(body); return; }
    if (url.pathname === "/tiny.png") { const body = Buffer.alloc(1200, 1); res.setHeader("content-type", "image/png"); res.setHeader("content-length", String(body.length)); res.end(body); return; }
    if (url.pathname === "/medium-img.png") { const body = Buffer.alloc(45000, 2); res.setHeader("content-type", "image/png"); res.setHeader("content-length", String(body.length)); res.end(body); return; }
    if (url.pathname === "/slow-hero.png") { setTimeout(() => { const body = Buffer.alloc(650000, 3); res.setHeader("content-type", "image/png"); res.setHeader("content-length", String(body.length)); res.end(body); }, 350); return; }
    if (url.pathname === "/very-slow-hero.png") { setTimeout(() => { const body = Buffer.alloc(1200000, 4); res.setHeader("content-type", "image/png"); res.setHeader("content-length", String(body.length)); res.end(body); }, 900); return; }
    if (url.pathname === "/medium.css") { const css = "body{font-family:Arial}.box{padding:20px;margin:8px}".padEnd(32000, " "); res.setHeader("content-type", "text/css"); res.setHeader("content-length", String(Buffer.byteLength(css))); res.end(css); return; }
    if (url.pathname === "/slow.css") { setTimeout(() => { const css = "body{font-family:Arial}.hero{display:block;margin:0}.late{height:220px}".padEnd(120000, " "); res.setHeader("content-type", "text/css"); res.setHeader("content-length", String(Buffer.byteLength(css))); res.end(css); }, 250); return; }
    if (url.pathname === "/very-slow.css") { setTimeout(() => { const css = "@font-face{font-family:Delayed;src:url('/delayed-font.woff2')}body{font-family:Delayed,Arial}.hero{display:block}".padEnd(200000, " "); res.setHeader("content-type", "text/css"); res.setHeader("content-length", String(Buffer.byteLength(css))); res.end(css); }, 700); return; }
    if (url.pathname === "/delayed-font.woff2") { setTimeout(() => { const body = Buffer.alloc(120000, 5); res.setHeader("content-type", "font/woff2"); res.setHeader("content-length", String(body.length)); res.end(body); }, 700); return; }
    if (url.pathname === "/medium.js") { const js = "for(let i=0;i<20000;i++){Math.sqrt(i)}".padEnd(60000, " "); res.setHeader("content-type", "application/javascript"); res.setHeader("content-length", String(Buffer.byteLength(js))); res.end(js); return; }
    if (url.pathname === "/slow.js") { const js = "const s=Date.now();while(Date.now()-s<450){};setTimeout(()=>{const d=document.createElement('div');d.style.height='240px';d.textContent='late';document.body.prepend(d)},100);".padEnd(350000, " "); res.setHeader("content-type", "application/javascript"); res.setHeader("content-length", String(Buffer.byteLength(js))); res.end(js); return; }
    if (url.pathname === "/very-slow.js") { const js = "for(let t=0;t<3;t++){const s=Date.now();while(Date.now()-s<500){}};setTimeout(()=>{for(let i=0;i<3;i++){const d=document.createElement('div');d.style.height='260px';d.textContent='shift';document.body.prepend(d)}},100);".padEnd(900000, " "); res.setHeader("content-type", "application/javascript"); res.setHeader("content-length", String(Buffer.byteLength(js))); res.end(js); return; }
    if (url.pathname === "/fast") { res.setHeader("content-type", "text/html"); res.end(page("Fast", '<p>Fast deterministic page.</p><img src="/tiny.png" width="40" height="30" alt="tiny">')); return; }
    if (url.pathname === "/medium") { res.setHeader("content-type", "text/html"); const images = Array.from({ length: 4 }, (_, i) => `<img src="/medium-img.png?${i}" width="240" height="135" alt="m${i}">`).join(""); res.end(page("Medium", `<p>Medium page.</p>${images}<script src="/medium.js"></script>`, '', '<link rel="stylesheet" href="/medium.css">')); return; }
    if (url.pathname === "/slow") { setTimeout(() => { res.setHeader("content-type", "text/html"); const many = Array.from({ length: 12 }, (_, i) => `<img src="/medium-img.png?s=${i}" width="240" height="135" alt="s${i}">`).join(""); res.end(page("Slow", `<img class="hero" src="/slow-hero.png" width="1200" height="700" alt="hero"><p>Slow page.</p>${many}<script src="/slow.js"></script>`, '', '<link rel="stylesheet" href="/slow.css">')); }, 250); return; }
    if (url.pathname === "/very-slow") { setTimeout(() => { res.setHeader("content-type", "text/html"); const many = Array.from({ length: 24 }, (_, i) => `<img src="/medium-img.png?v=${i}" width="240" height="135" alt="v${i}">`).join(""); res.end(page("Very Slow", `<img class="hero" src="/very-slow-hero.png" width="1400" height="900" alt="hero"><p>Very slow page.</p>${many}<script src="/very-slow.js"></script>`, '', '<link rel="stylesheet" href="/very-slow.css"><link rel="preload" href="/delayed-font.woff2" as="font" crossorigin>')); }, 800); return; }    if (url.pathname === "/light") { res.setHeader("content-type", "text/html"); res.end(page("Light", "<p>Small page used for stable local performance collection.</p>", '<a href="/heavy">Heavy</a><a href="/lcp">LCP</a><a href="/cls">CLS</a>', '<link rel="stylesheet" href="/style.css">')); return; }
    if (url.pathname === "/heavy") { res.setHeader("content-type", "text/html"); const images = Array.from({ length: 12 }, (_, index) => `<img src="/img-${index}.png" width="160" height="90" alt="${index}">`).join(""); res.end(page("Heavy", `<p>Heavy page with resources.</p>${images}<script src="/app.js"></script><script src="/longtask.js"></script>`, '<a href="/light">Light</a>', '<link rel="stylesheet" href="/style.css"><link rel="preload" href="/font.woff2" as="font" crossorigin>')); return; }
    if (url.pathname === "/lcp") { res.setHeader("content-type", "text/html"); res.end(page("LCP", '<div class="hero"><img src="/img-hero.png" width="800" height="450" alt="hero"></div>')); return; }
    if (url.pathname === "/cls") { res.setHeader("content-type", "text/html"); res.end(page("CLS", '<div id="late"></div><p>Below late block.</p><script>setTimeout(()=>{document.getElementById("late").style.height="180px";document.getElementById("late").textContent="late";},20)</script>')); return; }
    if (url.pathname === "/many") { res.setHeader("content-type", "text/html"); const scripts = Array.from({ length: 8 }, (_, index) => `<script src="/app.js?${index}"></script>`).join(""); res.end(page("Many", `<p>Many resources.</p>${scripts}`)); return; }
    res.statusCode = 404;
    res.setHeader("content-type", "text/html");
    res.end(page("Missing", "<p>Missing page.</p>"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("fixture server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    lightUrl: `${baseUrl}/light`,
    fastUrl: `${baseUrl}/fast`,
    mediumUrl: `${baseUrl}/medium`,
    slowUrl: `${baseUrl}/slow`,
    verySlowUrl: `${baseUrl}/very-slow`,
    heavyUrl: `${baseUrl}/heavy`,
    siteUrl: `${baseUrl}/light`,
    requestCounts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}