import { SESSION_COOKIE } from "@/lib/auth/constants";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/onboarding", "/lock"];
const ASSET_PREFIXES = ["/_next", "/api/health", "/icons", "/manifest.json", "/sw.js"];

/**
 * Build a per-request Content-Security-Policy.
 *
 * Why per-request and not in `next.config.ts`?
 *  - Next.js App Router renders inline bootstrap scripts (chunk preloading,
 *    React hydration boot, server-component flush) on every page. A static
 *    `script-src 'self'` blocks those scripts → blank page.
 *  - The fix recommended by Next.js is the "nonce + 'strict-dynamic'" pattern:
 *    we generate a fresh nonce per request, set it on the CSP header, and
 *    Next picks it up from the `x-nonce` request header to stamp it onto
 *    every script tag it emits. `'strict-dynamic'` then trusts any further
 *    scripts loaded transitively by those nonced scripts.
 *  - This keeps the policy strict (no `'unsafe-inline'`) without breaking
 *    hydration. See https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
 *
 * Dev-only `'unsafe-eval'`: required by the React refresh runtime that
 * Next's dev server injects. It's stripped in production builds.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind v4 + many UI libs inject runtime <style> tags that aren't
    // easily nonced. CSS has no script execution surface; allowing inline
    // styles is widely accepted as the right tradeoff.
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Local Ollama daemon — needed when LLM_PROVIDER=ollama. Cloud providers
    // are called from the server, never the browser, so they don't appear here.
    "connect-src 'self' http://127.0.0.1:11434 http://localhost:11434 ws: wss:",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ---------- Auth gate ----------
  if (ASSET_PREFIXES.some((p) => pathname.startsWith(p))) {
    return withSecurityHeaders(NextResponse.next(), req);
  }

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSessionCookie && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/lock";
    // Only echo the original path back when it's a clean in-app pathname.
    // Defence-in-depth in case Next.js ever surfaces something exotic here
    // (it shouldn't — `req.nextUrl.pathname` is always normalized — but the
    // /lock page revalidates this anyway).
    if (
      pathname.startsWith("/") &&
      !pathname.startsWith("//") &&
      !pathname.includes("\\") &&
      !/[\r\n\t]/.test(pathname)
    ) {
      url.searchParams.set("from", pathname);
    }
    return withSecurityHeaders(NextResponse.redirect(url), req);
  }

  return withSecurityHeaders(NextResponse.next(), req);
}

/**
 * Generate a fresh nonce, set it on the request's `x-nonce` header so Next
 * can read it inside server components, and write the matching CSP header
 * onto the response. This must run on every response Next emits — including
 * redirects and asset passes — otherwise the page that finally lands at the
 * browser may carry no CSP at all.
 */
function withSecurityHeaders(res: NextResponse, _req: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  // The request-side header is how Next.js components pull the nonce
  // (via `headers().get("x-nonce")`) to stamp inline scripts.
  res.headers.set("x-nonce", nonce);
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    /*
     * Match every path EXCEPT static assets that don't need CSP and would
     * otherwise pay the per-request cost.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
