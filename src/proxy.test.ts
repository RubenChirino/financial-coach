import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { proxy } from "./proxy";

const nonceIn = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];

describe("proxy CSP nonce", () => {
  it("hands the render the same nonce the browser's CSP allows", () => {
    const req = new NextRequest("http://localhost/transactions", {
      headers: { cookie: `${SESSION_COOKIE}=x` },
    });
    const res = proxy(req);

    const csp = res.headers.get("content-security-policy");
    const nonce = nonceIn(csp);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    // Request-header overrides are how a proxy reaches the render: Next reads
    // the nonce from the request's CSP, server components from `x-nonce`.
    expect(res.headers.get("x-middleware-override-headers")?.split(",")).toEqual(
      expect.arrayContaining(["x-nonce", "content-security-policy"]),
    );
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(nonceIn(res.headers.get("x-middleware-request-content-security-policy"))).toBe(nonce);
    // Not echoed to the browser as a response header.
    expect(res.headers.get("x-nonce")).toBeNull();
  });

  it("uses a fresh nonce per request, and keeps the CSP on redirects", () => {
    const a = nonceIn(
      proxy(new NextRequest("http://localhost/lock")).headers.get("content-security-policy"),
    );
    const b = nonceIn(
      proxy(new NextRequest("http://localhost/lock")).headers.get("content-security-policy"),
    );
    expect(a).not.toBe(b);

    const redirect = proxy(new NextRequest("http://localhost/transactions"));
    expect(redirect.headers.get("location")).toContain("/lock?from=%2Ftransactions");
    expect(redirect.headers.get("content-security-policy")).toContain("script-src");
  });
});

describe("proxy auth gate", () => {
  it("serves static assets without a session, and gates app routes", () => {
    for (const path of [
      "/fonts/Inter-VariableFont_opsz_wght.ttf",
      "/icons/icon-192.png",
      "/manifest.json",
      "/sw.js",
      "/offline.html",
    ]) {
      expect(
        proxy(new NextRequest(`http://localhost${path}`)).headers.get("location"),
        path,
      ).toBeNull();
    }
    expect(proxy(new NextRequest("http://localhost/goals")).headers.get("location")).toContain(
      "/lock?from=%2Fgoals",
    );
  });
});
