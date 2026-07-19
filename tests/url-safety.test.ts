import { describe, expect, it } from "vitest";
import { assertSafeRedirectTarget, isForbiddenIp, validateUrlSyntax } from "../src/core/url-safety.js";

describe("url safety", () => {
  it("accepts public HTTP URLs syntactically", () => {
    expect(validateUrlSyntax("https://example.com/path").hostname).toBe("example.com");
  });

  it("blocks localhost", () => {
    expect(() => validateUrlSyntax("http://localhost/")).toThrow(/Blocked host/);
  });

  it("blocks private IPv4", () => {
    const privateUrlHost = ["192", "168", "1", "20"].join(".");
    const privateIp = ["10", "0", "0", "1"].join(".");
    expect(() => validateUrlSyntax(`http://${privateUrlHost}/`)).toThrow(/Blocked private/);
    expect(isForbiddenIp(privateIp)).toBe(true);
  });

  it("blocks private IPv6", () => {
    expect(() => validateUrlSyntax("http://[::1]/")).toThrow(/Blocked private/);
    expect(isForbiddenIp("fd00::1")).toBe(true);
  });

  it("blocks unsupported protocols and URL credentials", () => {
    expect(() => validateUrlSyntax("file:///etc/passwd")).toThrow(/protocol/);
    expect(() => validateUrlSyntax("https://user:pass@example.com")).toThrow(/credentials/);
  });

  it("blocks redirects to private targets", async () => {
    await expect(assertSafeRedirectTarget("https://example.com", "http://127.0.0.1/admin")).rejects.toThrow(/Blocked private/);
  });
});
