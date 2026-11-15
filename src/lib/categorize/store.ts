"use client";

import { create } from "zustand";
import {
  categorizeBatchAction,
  countPendingCategorizationAction,
  recorrectCategoriesAction,
} from "./actions";

export type CategorizeStatus = "idle" | "running" | "done" | "error";

/** Rows per request; the server groups them by merchant (≤ 25 merchants per LLM call). */
const BATCH_LIMIT = 50;

interface CategorizeState {
  status: CategorizeStatus;
  total: number;
  done: number;
  ruleMatched: number;
  keywordMatched: number;
  llmMatched: number;
  /** Already-categorized rows fixed by the deterministic correction pass. */
  corrected: number;
  errors: number;
  /** Rows left pending because the LLM step was refused. */
  skipped: number;
  /** Why the LLM step did not run (no cloud consent, quota, provider down), if it didn't. */
  llmSkipped: "cloudConsentRequired" | "rateLimited" | "unavailable" | null;
  error: string | null;
  /** Kick off a full background categorization run. No-op if already running. */
  start: () => Promise<void>;
  /** Hide the card (only meaningful once finished). */
  dismiss: () => void;
}

/**
 * Global categorization run state. Lives at module scope (not in a component)
 * so the batch loop keeps running while the user navigates between pages — the
 * floating progress card just reads this store wherever it's mounted.
 */
export const useCategorizeStore = create<CategorizeState>((set, get) => ({
  status: "idle",
  total: 0,
  done: 0,
  ruleMatched: 0,
  keywordMatched: 0,
  llmMatched: 0,
  corrected: 0,
  errors: 0,
  skipped: 0,
  llmSkipped: null,
  error: null,

  dismiss: () => {
    if (get().status === "running") return;
    set({ status: "idle" });
  },

  start: async () => {
    if (get().status === "running") return;
    set({
      status: "running",
      total: 0,
      done: 0,
      ruleMatched: 0,
      keywordMatched: 0,
      llmMatched: 0,
      corrected: 0,
      errors: 0,
      skipped: 0,
      llmSkipped: null,
      error: null,
    });

    // First, deterministically fix already-categorized mistakes and re-queue
    // uncertain rows — this is what flips a wrongly-"fees" Anthropic/café charge.
    const rec = await recorrectCategoriesAction();
    if (rec.ok) set({ corrected: rec.corrected ?? 0 });

    const count = await countPendingCategorizationAction();
    if (!count.ok) {
      set({ status: "error", error: count.error ?? "failed" });
      return;
    }
    set({ total: count.count ?? 0 });
    if ((count.count ?? 0) === 0) {
      set({ status: "done" });
      return;
    }

    const err = await runBatches(set);
    set(err ? { status: "error", error: err } : { status: "done" });
  },
}));

type SetState = (
  partial: Partial<CategorizeState> | ((s: CategorizeState) => Partial<CategorizeState>),
) => void;

/**
 * Forward-cursor batch loop. Each call is short; the loop survives navigation.
 * Returns an error string on failure, or null when the run completes.
 */
async function runBatches(set: SetState): Promise<string | null> {
  let afterId = 0;
  // Once the LLM step is refused or the provider fails, the rest of the run
  // applies rules and keywords only — no call per batch to a provider that
  // just said no.
  let skipLlm = false;
  while (true) {
    const res = await categorizeBatchAction({ afterId, limit: BATCH_LIMIT, skipLlm });
    if (!res.ok) return res.error ?? "failed";
    set((s) => ({
      done: s.done + (res.processed ?? 0),
      ruleMatched: s.ruleMatched + (res.ruleMatched ?? 0),
      keywordMatched: s.keywordMatched + (res.keywordMatched ?? 0),
      llmMatched: s.llmMatched + (res.llmMatched ?? 0),
      errors: s.errors + (res.errors ?? 0),
      skipped: s.skipped + (res.skipped ?? 0),
      llmSkipped: res.llmSkipped ?? s.llmSkipped,
    }));
    if (res.llmSkipped) skipLlm = true;
    afterId = res.lastId ?? afterId;
    if (!res.hasMore) return null;
  }
}

/** Total successfully categorized this run (excludes errored rows). */
export function categorizedCount(s: CategorizeState): number {
  return s.ruleMatched + s.keywordMatched + s.llmMatched;
}
