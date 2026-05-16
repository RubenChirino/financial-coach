"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Global top progress bar shown during route navigation.
 *
 * Why we need this:
 *   Next.js App Router waits for the server component tree (DB queries, AI
 *   calls, etc.) to render before painting a new page. Between the click and
 *   the new content, the browser shows the previous page completely frozen,
 *   which feels like a 1–2s stall even though the request is in flight.
 *
 *   `loading.tsx` Suspense boundaries cover the *inside* of each route once
 *   they mount, but the user still wants instant feedback at the moment the
 *   click happens. This bar fills that gap.
 *
 * How it works:
 *   - We listen for document-level clicks on `<a>` elements that look like
 *     in-app navigations (same-origin, no modifier keys, no `download` attr).
 *   - On a qualifying click we show the bar and start an indeterminate
 *     animation toward ~80% (so it always moves but never completes prematurely).
 *   - When `pathname` or `searchParams` change — i.e. Next finished routing —
 *     we snap to 100% and fade out.
 *
 * Trade-offs / non-goals:
 *   - We deliberately don't use `<Link>`'s `useLinkStatus` because it only
 *     reports the status for a single child of `<Link>`; tracking *all* links
 *     globally would require wrapping every Link in the app.
 *   - The bar is purely visual feedback. It does not actually measure progress
 *     of the underlying request — that information isn't exposed by Next.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const completeTimeoutRef = useRef<number | null>(null);
  // Capture the navigation that's in flight so a finished route updates the
  // bar even when the click target was already-current (we still want to fade
  // back to 0 on click).
  const navigatingRef = useRef(false);

  // ── Detect navigation start ────────────────────────────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Ignore clicks with modifiers (new tab, save target, etc.) — those
      // don't trigger a same-page navigation.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // Walk up to find the nearest <a>.
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // External links, downloads, mailto, tel — let the browser handle.
      if (
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        /^(mailto:|tel:|sms:|javascript:|#)/i.test(href)
      ) {
        return;
      }
      // Cross-origin: skip.
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        // Same path + same search means it's effectively a no-op — don't show.
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      start();
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // ── Complete on navigation finish ──────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: We intentionally
  // react to pathname/searchParams changes only. `complete` is stable enough
  // for this effect.
  useEffect(() => {
    if (navigatingRef.current) complete();
  }, [pathname, searchParams]);

  function start() {
    navigatingRef.current = true;
    setVisible(true);
    setProgress(8);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (completeTimeoutRef.current) window.clearTimeout(completeTimeoutRef.current);
    // Trickle up toward 80% but never reach it — completion comes from the
    // pathname-change effect below.
    intervalRef.current = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 80) return p;
        const remaining = 80 - p;
        return p + Math.max(0.5, remaining * 0.08);
      });
    }, 200);
  }

  function complete() {
    navigatingRef.current = false;
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setProgress(100);
    // Fade out after the snap-to-100 transition has visibly landed.
    completeTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      // Reset for the next navigation after the fade.
      window.setTimeout(() => setProgress(0), 200);
    }, 200);
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      if (completeTimeoutRef.current) window.clearTimeout(completeTimeoutRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms ease-out" }}
    >
      <div
        className="h-full bg-[color:var(--brand-primary)] shadow-[0_0_10px_color-mix(in_srgb,var(--brand-primary)_60%,transparent)]"
        style={{
          width: `${progress}%`,
          transition: "width 200ms ease-out",
        }}
      />
    </div>
  );
}
