import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

/**
 * Static security headers.
 *
 * Note: `Content-Security-Policy` is set in `src/middleware.ts` instead of
 * here because Next.js App Router emits inline bootstrap scripts on every
 * request and we follow the official recommendation of binding them to a
 * per-request nonce + `'strict-dynamic'`. A static CSP without a nonce would
 * either break hydration (`script-src 'self'` blocks the inline bootstrap)
 * or be effectively useless (`'unsafe-inline'` neutralizes the directive).
 *
 * Everything else is a constant per response and stays here, where Next can
 * cache the values across requests.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    const baseHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      {
        key: "Permissions-Policy",
        value:
          "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=()",
      },
      // Cross-origin isolation: prevent untrusted documents from sharing the
      // browsing context group, and forbid foreign sites from embedding our
      // resources cross-origin (CSRF / Spectre defense in depth).
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      // HSTS: only meaningful over HTTPS. Setting it on a plain-HTTP local dev
      // run is harmless (browsers ignore it), but on a deployed install it
      // pins the host to TLS for a year. `includeSubDomains` is conservative —
      // remove if running multi-subdomain on the same registrable domain.
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
    ];
    return [{ source: "/(.*)", headers: baseHeaders }];
  },
};

export default withNextIntl(nextConfig);
