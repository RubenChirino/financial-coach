import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, transactions } from "@/db/schema";

/**
 * Whether this user has anything for the money-shaped features to act on.
 *
 * Used by the shell to hide affordances that can't do anything yet — the
 * EUR/USD display-currency toggle has no amounts to convert, and the topbar
 * search has no transactions to find. Showing them on an empty account is
 * just noise pointing at dead ends.
 *
 * Accounts are checked as well as transactions on purpose: a freshly linked
 * bank has a balance worth converting before any transaction has synced.
 *
 * Two `LIMIT 1` existence probes on indexed `user_id` columns, short-circuited
 * on the first hit. This runs once per shell render, so it stays cheap.
 */
export async function hasFinancialData(userId: number): Promise<boolean> {
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (account.length > 0) return true;

  const tx = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .limit(1);
  return tx.length > 0;
}
