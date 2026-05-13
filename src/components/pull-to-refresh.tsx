"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface PullToRefreshProps {
  /**
   * Optional async action invoked before `router.refresh()`. If it throws the
   * spinner is hidden but the error is swallowed — pull-to-refresh is a soft
   * affordance, not a critical path.
   */
  onRefresh?: () => Promise<unknown> | unknown;
  /** Pixels of pull required to commit a refresh. */
  threshold?: number;
  children: React.ReactNode;
}

/**
 * Mobile pull-to-refresh wrapper. Activates only when the document is scrolled
 * to the top, the gesture starts as a vertical drag, and the user pulls past
 * `threshold`. Desktop / mouse users are unaffected.
 */
export function PullToRefresh({ onRefresh, threshold = 70, children }: PullToRefreshProps) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0]?.clientY ?? null;
    }
    function onTouchMove(e: TouchEvent) {
      if (startY.current == null || refreshing) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy > 0) {
        setPull(Math.min(dy, threshold * 1.6));
      } else {
        setPull(0);
      }
    }
    async function onTouchEnd() {
      if (startY.current == null) return;
      const committed = pull >= threshold;
      startY.current = null;
      if (committed && !refreshing) {
        setRefreshing(true);
        try {
          if (onRefresh) await onRefresh();
          router.refresh();
        } catch {
          // Soft affordance — no toast.
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    }
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [onRefresh, pull, refreshing, router, threshold]);

  return (
    <div className="relative">
      <div
        aria-hidden={pull === 0 && !refreshing}
        className="pointer-events-none absolute left-0 right-0 top-0 flex items-center justify-center transition-transform"
        style={{
          transform: `translateY(${refreshing ? threshold : pull}px)`,
          opacity: refreshing ? 1 : Math.min(pull / threshold, 1),
          height: 36,
          marginTop: -36,
        }}
      >
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--surface-card)] text-[color:var(--brand-primary)] shadow"
          style={{
            transform: refreshing ? undefined : `rotate(${(pull / threshold) * 360}deg)`,
          }}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </span>
      </div>
      {children}
    </div>
  );
}
