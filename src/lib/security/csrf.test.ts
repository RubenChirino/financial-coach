import { describe, expect, it } from "vitest";
import { ensureSameOrigin } from "./csrf";

/**
 * Build a fake Request: undici's `new Request` strips "forbidden" headers
 * like Origin/Referer when set programmatically, which would defeat these
 * tests. We construct a minimal stand-in that exposes the same `headers.get`
 * surface our function actually uses.
 */
function makeReq(headers: Record<string, string>, url = "https://app.local/api/x"): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    headers: {
      get(name: string) {
        return lower[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as Request;
}

describe("ensureSameOrigin", () => {
  it("accepts a same-origin request with matching Origin", () => {
    const req = makeReq({ origin: "https://app.local" });
    expect(ensureSameOrigin(req)).toBe(true);
  });

  it("rejects a cross-origin Origin", () => {
    const req = makeReq({ origin: "https://evil.example" });
    expect(ensureSameOrigin(req)).toBe(false);
  });

  it("rejects when Sec-Fetch-Site is cross-site even with valid Origin", () => {
    const req = makeReq({
      origin: "https://app.local",
      "sec-fetch-site": "cross-site",
    });
    expect(ensureSameOrigin(req)).toBe(false);
  });

  it("accepts when Sec-Fetch-Site is same-origin", () => {
    const req = makeReq({
      origin: "https://app.local",
      "sec-fetch-site": "same-origin",
    });
    expect(ensureSameOrigin(req)).toBe(true);
  });

  it("falls back to Referer when Origin is missing", () => {
    const req = makeReq({ referer: "https://app.local/some/page" });
    expect(ensureSameOrigin(req)).toBe(true);
  });

  it("rejects a cross-origin Referer", () => {
    const req = makeReq({ referer: "https://evil.example/landing" });
    expect(ensureSameOrigin(req)).toBe(false);
  });

  it("rejects when no Origin, no Referer, no Sec-Fetch-Site (curl-like)", () => {
    const req = makeReq({});
    expect(ensureSameOrigin(req)).toBe(false);
  });

  it("accepts a top-level navigation (sec-fetch-site=none) with same-origin Origin", () => {
    const req = makeReq({
      origin: "https://app.local",
      "sec-fetch-site": "none",
    });
    expect(ensureSameOrigin(req)).toBe(true);
  });

  it("rejects a malformed Origin header", () => {
    const req = makeReq({ origin: "not-a-url" });
    expect(ensureSameOrigin(req)).toBe(false);
  });

  it("rejects unknown Sec-Fetch-Site values", () => {
    const req = makeReq({
      origin: "https://app.local",
      "sec-fetch-site": "weird",
    });
    expect(ensureSameOrigin(req)).toBe(false);
  });
});
