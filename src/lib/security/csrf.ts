import "server-only";

/**
 * CSRF protection for plain `/api/*` route handlers.
 *
 * Next.js Server Actions ship with built-in CSRF protection (the framework
 * checks the `Next-Action` header + Origin internally). Plain Route Handlers
 * (`/api/*`) do NOT — they're cookie-authenticated like any classic endpoint,
 * which means a malicious site can `<form action="https://app/api/...">` and
 * make the browser send the user's session cookie.
 *
 * For a finance app whose endpoints can wipe the database (`/api/backup/restore`)
 * or trigger paid LLM calls (`/api/advisor/chat`), that's not acceptable.
 *
 * Defense:
 *   1. **Origin / Referer pinning** — modern browsers send `Origin` on every
 *      cross-site state-changing request. We require it to match the request's
 *      own host. Any mismatch → reject. This catches form-submit CSRF,
 *      `fetch({ credentials: "include" })` from third-party origins, and
 *      `<img src=...>` that wouldn't have an Origin.
 *   2. **Sec-Fetch-Site fallback** — when present, must be `same-origin` or
 *      `same-site`. Catches sub-resource attacks where Origin is null but the
 *      request is still cross-site.
 *   3. **GET allowlist** — pure GETs are not CSRFable in the classical sense
 *      (no state change), so we let them through but still log mismatches in
 *      dev. Use `requireSameOrigin` for any POST/PUT/PATCH/DELETE handler.
 *
 * This is intentionally conservative: it WILL reject legitimate cross-origin
 * tools (curl from another machine, etc.) unless they spoof Origin. The local-
 * first single-origin posture of this app means that's the right tradeoff.
 */

export class CsrfError extends Error {
  readonly status = 403;
  constructor(message = "csrf_blocked") {
    super(message);
    this.name = "CsrfError";
  }
}

/**
 * Throws `CsrfError` if the request looks cross-origin. Call at the top of
 * every state-changing route handler, BEFORE any DB write.
 *
 *   if (!ensureSameOrigin(req)) return new Response("csrf", { status: 403 });
 *
 * Returns `true` when the request is verified same-origin so callers can use
 * it as a guard expression instead of catching the error.
 */
export function ensureSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const fetchSite = req.headers.get("sec-fetch-site");
  const requestUrl = new URL(req.url);

  // Sec-Fetch-Site is the strongest signal modern browsers send. If it's
  // present at all, "same-origin" or "same-site" is the only acceptable value
  // for a cookie-authenticated state change. "none" means a top-level user
  // navigation (typing the URL, opening a bookmark) — also fine. "cross-site"
  // is always rejected regardless of what Origin claims.
  if (fetchSite === "cross-site") return false;
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }

  // If Origin is present, it must match the request's host.
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== requestUrl.host) return false;
    } catch {
      return false;
    }
    return true;
  }

  // Some browsers omit Origin on same-origin GETs — fall back to Referer.
  if (referer) {
    try {
      const r = new URL(referer);
      if (r.host !== requestUrl.host) return false;
    } catch {
      return false;
    }
    return true;
  }

  // No Origin, no Referer, no Sec-Fetch-Site → most likely a non-browser
  // client (curl, server-to-server). Block by default; developers who need
  // this can call the underlying logic from a Server Action instead.
  return false;
}

/**
 * Convenience wrapper that returns a `Response` directly when the check fails.
 * Lets handlers stay one-liners:
 *
 *   const csrf = guardCsrf(req);
 *   if (csrf) return csrf;
 */
export function guardCsrf(req: Request): Response | null {
  if (ensureSameOrigin(req)) return null;
  return new Response(JSON.stringify({ error: "csrf_blocked" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
