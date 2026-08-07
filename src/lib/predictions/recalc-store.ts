"use client";

import { create } from "zustand";
import { rebuildForecastAction } from "@/lib/predictions/actions";
import { runRecurringDetectionAction } from "@/lib/recurring/actions";
import { runTransferDetectionAction } from "@/lib/transfers/actions";

export type RecalcStatus = "idle" | "running" | "done" | "error";

/** Ordered pipeline steps — the card shows a localized label per step. */
export type RecalcStep = "transfers" | "recurring" | "forecast";
export const RECALC_STEPS: readonly RecalcStep[] = ["transfers", "recurring", "forecast"];

interface RecalcState {
  status: RecalcStatus;
  /** Index of the step currently running (0-based). */
  stepIndex: number;
  /** Recurring subscriptions found by the detection step. */
  subsDetected: number;
  /** Internal transfer pairs found by the detection step. */
  transfersDetected: number;
  error: string | null;
  /** Kick off a full background recalculation. No-op if already running. */
  start: () => Promise<void>;
  /** Hide the card (only meaningful once finished). */
  dismiss: () => void;
}

/**
 * Global "recalculate predictions" run state. Module-scope (like the
 * categorization and travels stores) so the pipeline keeps running while the
 * user navigates; the floating progress card reads this wherever it's mounted.
 *
 * The pipeline re-derives every input the forecast depends on, from all
 * transactions: internal transfers (so cross-account moves don't count as
 * income/expense), recurring subscriptions & income (the forecast's fixed
 * layers), then the forecast aggregation itself.
 */
export const useRecalcStore = create<RecalcState>((set, get) => ({
  status: "idle",
  stepIndex: 0,
  subsDetected: 0,
  transfersDetected: 0,
  error: null,

  dismiss: () => {
    if (get().status === "running") return;
    set({ status: "idle" });
  },

  start: async () => {
    if (get().status === "running") return;
    set({ status: "running", stepIndex: 0, subsDetected: 0, transfersDetected: 0, error: null });

    const transfers = await runTransferDetectionAction();
    if (!transfers.ok) {
      set({ status: "error", error: transfers.error ?? "failed" });
      return;
    }
    set({ transfersDetected: transfers.detected ?? 0, stepIndex: 1 });

    const recurring = await runRecurringDetectionAction();
    if (!recurring.ok) {
      set({ status: "error", error: recurring.error ?? "failed" });
      return;
    }
    set({ subsDetected: recurring.detected ?? 0, stepIndex: 2 });

    const forecast = await rebuildForecastAction();
    if (!forecast.ok) {
      set({ status: "error", error: forecast.error ?? "failed" });
      return;
    }

    set({ status: "done" });
  },
}));
