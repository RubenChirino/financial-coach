"use client";

import { create } from "zustand";
import { countTravelCitiesAction, resolveTravelCitiesBatchAction } from "./actions";

export type DetectStatus = "idle" | "running" | "done" | "error";

const BATCH_LIMIT = 20;

interface DetectState {
  status: DetectStatus;
  total: number;
  done: number;
  resolved: number;
  aiUsed: boolean;
  error: string | null;
  /** Kick off a full background "detect trips" run. No-op if already running. */
  start: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Global "detect trips" run state — module-level so the resolution loop keeps
 * running across navigation, mirroring the categorization store. The floating
 * card reads this wherever it's mounted.
 */
export const useDetectStore = create<DetectState>((set, get) => ({
  status: "idle",
  total: 0,
  done: 0,
  resolved: 0,
  aiUsed: false,
  error: null,

  dismiss: () => {
    if (get().status === "running") return;
    set({ status: "idle" });
  },

  start: async () => {
    if (get().status === "running") return;
    set({ status: "running", total: 0, done: 0, resolved: 0, aiUsed: false, error: null });

    const count = await countTravelCitiesAction();
    if (!count.ok) {
      set({ status: "error", error: count.error ?? "failed" });
      return;
    }
    set({ total: count.count ?? 0 });
    if ((count.count ?? 0) === 0) {
      set({ status: "done" });
      return;
    }

    let afterKey = "";
    while (true) {
      const res = await resolveTravelCitiesBatchAction({ afterKey, limit: BATCH_LIMIT });
      if (!res.ok) {
        set({ status: "error", error: res.error ?? "failed" });
        return;
      }
      set((s) => ({
        done: s.done + (res.scanned ?? 0),
        resolved: s.resolved + (res.resolved ?? 0),
        aiUsed: s.aiUsed || !!res.aiUsed,
      }));
      afterKey = res.lastKey ?? afterKey;
      if (!res.hasMore) break;
    }

    set({ status: "done" });
  },
}));
