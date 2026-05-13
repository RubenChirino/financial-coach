"use client";

import { useEffect } from "react";

/**
 * Registers the shell service worker from `public/sw.js` on the client.
 *
 * The SW only caches static shell routes (`/`, `/lock`, `/onboarding`,
 * `/manifest.json`) and explicitly skips `/api/*`, so financial data is never
 * persisted outside the encrypted SQLite DB. Registration is a no-op when the
 * browser lacks Service Worker support or when running in dev under http (the
 * app's production target is http://127.0.0.1 which is treated as secure).
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Defer until after first paint so registration doesn't compete with
    // hydration and initial network fetches.
    const handle = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Silently ignore — SW is optional progressive enhancement.
      });
    }, 1500);
    return () => window.clearTimeout(handle);
  }, []);

  return null;
}
