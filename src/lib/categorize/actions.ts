"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import {
  type BatchResult,
  categorizePendingBatch,
  countPendingCategorization,
  type RecorrectResult,
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
    const res = await recorrectCategories(session.userId);
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
    return { ok: true, count: await countPendingCategorization(session.userId) };
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
const BatchOpts = z.object({
  afterId: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  skipLlm: z.boolean().optional(),
});

export async function categorizeBatchAction(
  opts: z.input<typeof BatchOpts>,
): Promise<CategorizeBatchResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  const parsed = BatchOpts.safeParse(opts);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  try {
    const res = await categorizePendingBatch({ userId: session.userId, ...parsed.data });
    if (!res.hasMore) revalidatePath("/transactions");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}
