"use server";

import { db } from "@/db/client";
import { requisitions, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { categorizeBatchByRules } from "@/lib/categorize";
import { and, eq } from "drizzle-orm";
import { DEMO_BANK_KEYS, type DemoBankKey, seedDemoBank, wipeAllDemoData } from "./seed";

export interface DemoActionOk<T = undefined> {
  ok: true;
  data?: T;
}
export interface DemoActionErr {
  ok: false;
  error: string;
}
export type DemoActionResult<T = undefined> = DemoActionOk<T> | DemoActionErr;

export async function seedDemoBankAction(
  bank: DemoBankKey,
): Promise<DemoActionResult<{ inserted: number; ruleMatched: number }>> {
  try {
    const session = await getCurrentSession();
    if (!session) return { ok: false, error: "unauthenticated" };
    if (session.isGuest) return { ok: false, error: "guestReadOnly" };
    if (!DEMO_BANK_KEYS.includes(bank)) return { ok: false, error: "invalidBank" };

    const { accountRowId, inserted } = await seedDemoBank(
      session.userId,
      bank,
      session.encryptionKey,
    );

    // Re-categorize anything still missing a category via rules (seed provides
    // categoryIds for most rows already, but rules may refine).
    const uncategorized = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(eq(transactions.userId, session.userId), eq(transactions.accountId, accountRowId)),
      );
    const ruleMatched = await categorizeBatchByRules(
      session.userId,
      uncategorized.map((r) => r.id),
    );

    return { ok: true, data: { inserted, ruleMatched } };
  } catch (err) {
    console.warn("seedDemoBankAction failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function wipeDemoDataAction(): Promise<
  DemoActionResult<{ removedRequisitions: number }>
> {
  try {
    const session = await getCurrentSession();
    if (!session) return { ok: false, error: "unauthenticated" };
    if (session.isGuest) return { ok: false, error: "guestReadOnly" };
    const res = await wipeAllDemoData(session.userId);
    return { ok: true, data: res };
  } catch (err) {
    console.warn("wipeDemoDataAction failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * Convenience: does the user currently have ANY demo connections?
 * Used by /settings/bank to decide whether to show "remove demo data".
 */
export async function hasDemoConnectionsAction(): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session) return false;
  const rows = await db
    .select({ id: requisitions.id })
    .from(requisitions)
    .where(and(eq(requisitions.userId, session.userId), eq(requisitions.provider, "demo")))
    .limit(1);
  return rows.length > 0;
}
