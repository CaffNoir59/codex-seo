import { describe, expect, it } from "vitest";
import { createUrlFilterState, filterUrl } from "../../src/crawler/url-filter.js";
import { resolveCrawlConfig } from "../../src/crawler/crawl-config.js";

const root = "https://example.com/";
function reason(url: string) {
  return filterUrl(url, root, resolveCrawlConfig(), createUrlFilterState()).reason;
}

describe("crawler URL exclusion security", () => {
  it("excludes non-http protocols with stable reasons", () => {
    expect(reason("mailto:test@example.com")).toBe("non-http-protocol");
    expect(reason("tel:+10000000000")).toBe("non-http-protocol");
    expect(reason("javascript:void(0)")).toBe("non-http-protocol");
  });

  it("excludes logout, admin, cart and checkout paths", () => {
    expect(reason("/logout")).toBe("blocked-path");
    expect(reason("/admin")).toBe("blocked-path");
    expect(reason("/cart")).toBe("blocked-path");
    expect(reason("/checkout")).toBe("blocked-path");
  });

  it("excludes excessively long URLs", () => {
    expect(reason(`/page/${"a".repeat(2100)}`)).toBe("url-too-long");
  });

  it("excludes generative calendar paths", () => {
    expect(reason("/events/2026/07/17")).toBe("calendar-pattern");
  });

  it("excludes sort and facet parameters", () => {
    expect(reason("/category?sort=price")).toBe("facet-or-sort-param");
    expect(reason("/category?filter=color")).toBe("facet-or-sort-param");
  });

  it("excludes repeated URL patterns after the threshold", () => {
    const state = createUrlFilterState();
    const config = resolveCrawlConfig();
    for (let i = 0; i < 20; i += 1) expect(filterUrl(`/item/${i}`, root, config, state).allowed).toBe(true);
    expect(filterUrl("/item/20", root, config, state).reason).toBe("repeated-url-pattern");
  });

  it("blocks subdomains by default and allows them only when requested", () => {
    expect(filterUrl("https://sub.example.com/a", root, resolveCrawlConfig(), createUrlFilterState()).reason).toBe("outside-domain");
    expect(filterUrl("https://sub.example.com/a", root, resolveCrawlConfig({ includeSubdomains: true }), createUrlFilterState()).allowed).toBe(true);
  });
});
