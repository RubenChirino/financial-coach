"use server";

import { db } from "@/db/client";
import { goals } from "@/db/schema";
import type { Goal } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { desc, eq } from "drizzle-orm";
import { recomputeAllGoalsProgress } from "./auto-track";

export interface GoalActionOk<T = undefined> {
  ok: true;
  data?: T;
}
export interface GoalActionErr {
  ok: false;
  error: string;
}
export type GoalActionResult<T = undefined> = GoalActionOk<T> | GoalActionErr;

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) throw new Error("unauthenticated");
  if (session.isGuest) throw new Error("guestReadOnly");
  return session;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listGoalsAction(): Promise<Goal[]> {
  const session = await getCurrentSession();
  if (!session) return [];
  return db.select().from(goals).orderBy(desc(goals.createdAt));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateGoalInput {
  title: string;
  emoji: string;
  targetCents: number;
  savedCents: number;
  deadline?: number | null;
  categoryId?: number | null;
  notes?: string | null;
}

export async function createGoalAction(
  input: CreateGoalInput,
): Promise<GoalActionResult<{ id: number }>> {
  try {
    await requireSession();

    const title = input.title.trim();
    if (!title) return { ok: false, error: "missingTitle" };
    if (input.targetCents <= 0) return { ok: false, error: "invalidTarget" };
    if (input.savedCents < 0) return { ok: false, error: "invalidSaved" };

    const inserted = await db
      .insert(goals)
      .values({
        title,
        emoji: input.emoji || "🎯",
        targetCents: input.targetCents,
        savedCents: Math.min(input.savedCents, input.targetCents),
        deadline: input.deadline ? new Date(input.deadline) : null,
        categoryId: input.categoryId ?? null,
        notes: input.notes?.trim() || null,
      })
      .returning({ id: goals.id });

    const id = inserted[0]?.id;
    if (!id) return { ok: false, error: "insertFailed" };
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateGoalInput {
  id: number;
  title: string;
  emoji: string;
  targetCents: number;
  savedCents: number;
  deadline?: number | null;
  categoryId?: number | null;
  notes?: string | null;
}

export async function updateGoalAction(input: UpdateGoalInput): Promise<GoalActionResult> {
  try {
    await requireSession();

    const title = input.title.trim();
    if (!title) return { ok: false, error: "missingTitle" };
    if (input.targetCents <= 0) return { ok: false, error: "invalidTarget" };

    await db
      .update(goals)
      .set({
        title,
        emoji: input.emoji || "🎯",
        targetCents: input.targetCents,
        savedCents: Math.max(0, Math.min(input.savedCents, input.targetCents)),
        deadline: input.deadline ? new Date(input.deadline) : null,
        categoryId: input.categoryId ?? null,
        notes: input.notes?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, input.id));

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Update progress only (quick bump from the card)
// ---------------------------------------------------------------------------

export async function updateGoalProgressAction(
  id: number,
  savedCents: number,
): Promise<GoalActionResult> {
  try {
    await requireSession();
    if (savedCents < 0) return { ok: false, error: "invalidSaved" };

    const row = await db
      .select({ targetCents: goals.targetCents })
      .from(goals)
      .where(eq(goals.id, id))
      .limit(1);
    if (!row[0]) return { ok: false, error: "notFound" };

    await db
      .update(goals)
      .set({
        savedCents: Math.min(savedCents, row[0].targetCents),
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id));

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Recompute `savedCents` for all goals linked to a budgeted category.
 * Exposed so the Goals page can offer a one-click "sync progress" button and
 * so the bank-sync pipeline can refresh it automatically after pulling new
 * transactions.
 */
export async function recomputeGoalsProgressAction(): Promise<
  GoalActionResult<{ updated: number }>
> {
  try {
    await requireSession();
    const updated = await recomputeAllGoalsProgress();
    return { ok: true, data: { updated } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function deleteGoalAction(id: number): Promise<GoalActionResult> {
  try {
    await requireSession();
    await db.delete(goals).where(eq(goals.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
