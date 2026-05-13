"use client";

import "driver.js/dist/driver.css";
import { driver } from "driver.js";
import { HelpCircle } from "lucide-react";
import { useCallback } from "react";

export interface TourStep {
  /** CSS selector of the element to highlight. Omit for a centred modal step. */
  element?: string;
  title: string;
  description: string;
  /** driver.js side — defaults to auto */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

export interface TourButtonProps {
  steps: TourStep[];
  /** Button label — defaults to "Tour" */
  label?: string;
  /** Shown in the driver.js progress bar, e.g. "Step {current} of {total}" */
  progressText?: string;
  /** Prev / Next / Done button labels */
  prevBtnText?: string;
  nextBtnText?: string;
  doneBtnText?: string;
}

/**
 * A small "?" button that launches a driver.js guided tour.
 *
 * Usage: import and drop anywhere in a page. Steps with `element` point to CSS
 * selectors of highlighted DOM nodes; steps without `element` are centred
 * overlay modals (good for intro/outro).
 */
export function TourButton({
  steps,
  label = "Tour",
  progressText,
  prevBtnText = "←",
  nextBtnText = "→",
  doneBtnText = "✓",
}: TourButtonProps) {
  const startTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 8,
      popoverClass: "fc-tour-popover",
      progressText: progressText ?? "{current}/{total}",
      prevBtnText,
      nextBtnText,
      doneBtnText,
      steps: steps.map((s) => ({
        ...(s.element ? { element: s.element } : {}),
        popover: {
          title: s.title,
          description: s.description,
          side: s.side,
          align: s.align ?? "start",
        },
      })),
    });
    driverObj.drive();
  }, [steps, progressText, prevBtnText, nextBtnText, doneBtnText]);

  return (
    <button
      type="button"
      onClick={startTour}
      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] shadow-sm transition-colors hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]"
    >
      <HelpCircle className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
