"use server";

import { getCurrentSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import {
  type BatchResult,
  type RecorrectResult,
  categorizePendingBatch,
  countPendingCategorization,
  recorrectCategories,
} from "./index";

export interface RecorrectActionResult extends Partial<RecorrectResult> {
  ok: boolean;
  error?: string;
}

/**
 * Deterministic correction pass over already-categorized rows (no LLM). Run
 * once at the start of a categorize job to fix mis-filed transactions (e.g. the
 * old "comision" rule dumping everything into bank fees) and re-queue the
 * uncertain ones for the LLM.
 */
export async function recorrectCategoriesAction(): Promise<RecorrectActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  try {
    const res = await recorrectCategories();
    revalidatePath("/transactions");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

export interface PendingCountResult {
  ok: boolean;
  count?: number;
  error?: string;
}

/** How many transactions still need categorizing — used to size the progress bar. */
export async function countPendingCategorizationAction(): Promise<PendingCountResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  try {
    return { ok: true, count: await countPendingCategorization() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

export interface CategorizeBatchResult extends Partial<BatchResult> {
  ok: boolean;
  error?: string;
}

/**
 * Process one forward batch (id > afterId). The client calls this in a loop,
 * passing back `lastId`, until `hasMore` is false — keeping each request short
 * so the run never blocks or times out.
 */
export async function categorizeBatchAction(opts: {
  afterId?: number;
  limit?: number;
}): Promise<CategorizeBatchResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  try {
    const res = await categorizePendingBatch(opts);
    if (!res.hasMore) revalidatePath("/transactions");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}
