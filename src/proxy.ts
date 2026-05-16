import { SESSION_COOKIE } from "@/lib/auth/constants";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/onboarding", "/lock"];
const ASSET_PREFIXES = [
  "/_next",
  "/api/health",
  // Auth.js routes must be reachable without a session — the user hits them
  // *to* obtain a session via OAuth handshake.
  "/api/auth",
  "/icons",
  "/manifest.json",
  "/sw.js",
];

// Auth.js cookie names (env-dependent — `__Secure-` prefix only over HTTPS).
// Checking both is cheap and avoids guessing NODE_ENV from middleware.
const OAUTH_SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

function hasAuthCookie(req: NextRequest): boolean {
  if (req.cookies.get(SESSION_COOKIE)?.value) return true;
  return OAUTH_SESSION_COOKIES.some((name) => Boolean(req.cookies.get(name)?.value));
}

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
  const isOAuth = process.env.AUTH_MODE === "oauth";
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  // connect-src:
  //   - In oauth (hosted) mode, the browser never needs to call Ollama —
  //     all LLM calls go server-side via the AI SDK route. Stripping the
  //     localhost allowance closes a small data-exfil vector (a successful
  //     XSS could POST to a victim's local Ollama daemon).
  //   - In local mode the daemon is reachable on 127.0.0.1, so we keep it.
  //   - `ws:`/`wss:` is required by Next dev's HMR socket. We drop the
  //     plain-text `ws:` in production for the same defense-in-depth reason.
  const connectParts: string[] = ["'self'"];
  if (!isOAuth) {
    connectParts.push("http://127.0.0.1:11434", "http://localhost:11434");
  }
  if (isDev) {
    connectParts.push("ws:", "wss:");
  } else {
    connectParts.push("wss:");
  }

  // img-src:
  //   - `https:` is too permissive (a stored-XSS payload could embed a
  //     tracking pixel pointing anywhere). We tighten to: self for hosted
  //     icons, data:/blob: for inline SVGs and generated previews, and a
  //     small allow-list for third-party bank/institution logos.
  //   - If you add a new logo source, append it here rather than reopening
  //     the wildcard.
  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    // Lucide-served institution logos (used by the bank tile when available).
    "https://*.googleusercontent.com",
    "https://lh3.googleusercontent.com",
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind v4 + many UI libs inject runtime <style> tags that aren't
    // easily nonced. CSS has no script execution surface; allowing inline
    // styles is widely accepted as the right tradeoff.
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectParts.join(" ")}`,
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

  const hasSessionCookie = hasAuthCookie(req);
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
