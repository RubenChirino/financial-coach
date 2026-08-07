import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";

/**
 * Internal transfer detector.
 *
 * Detects money the user moved between their OWN accounts (e.g. checking →
 * savings). Such a move shows up as two transactions — a negative leg on the
 * source account and a positive leg on the destination — and, left untouched,
 * inflates BOTH income and expenses across the dashboard, budgets, and the
 * forecast. We pair the legs and tag them with a shared `transferGroupId` so
 * the money-math queries can exclude them (they still count toward balances /
 * net worth, which is correct — the money didn't leave the user).
 *
 * Heuristics (deliberately tight to keep false positives low — see the plan's
 * risk note): an outflow on account A pairs with an inflow on account B when
 *   - the accounts differ,
 *   - the currency matches,
 *   - `abs(amountCents)` is identical, and
 *   - the booking dates are within ±`windowDays` (default 3).
 * When several inflows qualify, the nearest in time wins (greedy). Each inflow
 * is used at most once.
 *
 * Manual override always wins: rows the user has decided on (`transferManual =
 * true`) are never read or written by the auto pass, so a user "this isn't a
 * transfer" / "these two are" decision survives re-detection.
 */

export interface TransferLeg {
  id: number;
  accountId: number;
  bookingDate: Date;
  amountCents: number;
  currency: string;
}

export interface TransferPair {
  outId: number;
  inId: number;
}

const DEFAULT_WINDOW_DAYS = 3;
const DEFAULT_LOOKBACK_DAYS = 180;

/**
 * Pure matcher — extracted so it can be unit-tested without touching the DB.
 *
 * Pairs opposite-sign legs of equal magnitude across different accounts within
 * the date window. Closest-in-time candidates are matched first (global greedy)
 * so that when several legs of the same amount exist, the one that's actually a
 * transfer — the nearest counterpart — is the one excluded, not an unrelated
 * real expense that happens to share the amount. Each leg is used at most once.
 */
export function matchTransfers(
  legs: TransferLeg[],
  windowDays = DEFAULT_WINDOW_DAYS,
): TransferPair[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const outflows = legs.filter((t) => t.amountCents < 0);
  const inflows = legs.filter((t) => t.amountCents > 0);

  // Build every eligible (outflow, inflow) candidate, then assign closest first.
  const candidates: { outId: number; inId: number; delta: number }[] = [];
  for (const out of outflows) {
    for (const inc of inflows) {
      if (inc.accountId === out.accountId) continue;
      if (inc.currency !== out.currency) continue;
      if (Math.abs(inc.amountCents) !== Math.abs(out.amountCents)) continue;
      const delta = Math.abs(inc.bookingDate.getTime() - out.bookingDate.getTime());
      if (delta > windowMs) continue;
      candidates.push({ outId: out.id, inId: inc.id, delta });
    }
  }
  // Closest in time first; deterministic tiebreak by ids.
  candidates.sort((a, b) => a.delta - b.delta || a.outId - b.outId || a.inId - b.inId);

  const usedOut = new Set<number>();
  const usedIn = new Set<number>();
  const pairs: TransferPair[] = [];
  for (const c of candidates) {
    if (usedOut.has(c.outId) || usedIn.has(c.inId)) continue;
    usedOut.add(c.outId);
    usedIn.add(c.inId);
    pairs.push({ outId: c.outId, inId: c.inId });
  }
  return pairs;
}

interface DetectOptions {
  /** Owner whose transactions this pass operates on. */
  userId: number;
  lookbackDays?: number;
  now?: Date;
}

/**
 * Run transfer detection over the DB and persist `transferGroupId` on matched
 * legs. Returns the number of pairs found.
 *
 * Idempotent: clears auto-assigned links in the window, then re-tags the fresh
 * matches. Only ever reads/writes rows with `transferManual = false`, so manual
 * decisions are preserved across runs.
 */
export async function detectTransfers(opts: DetectOptions): Promise<number> {
  const { userId } = opts;
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const autoScope = and(
    eq(transactions.userId, userId),
    gte(transactions.bookingDate, since),
    eq(transactions.transferManual, false),
  );

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(autoScope);

  const pairs = matchTransfers(rows);

  // Reset auto links in the window, then set fresh ones. Manual rows are
  // excluded by `autoScope`, so this never clobbers a user decision.
  await db.update(transactions).set({ transferGroupId: null }).where(autoScope);

  for (const p of pairs) {
    const gid = randomUUID();
    await db
      .update(transactions)
      .set({ transferGroupId: gid })
      .where(and(eq(transactions.userId, userId), eq(transactions.id, p.outId)));
    await db
      .update(transactions)
      .set({ transferGroupId: gid })
      .where(and(eq(transactions.userId, userId), eq(transactions.id, p.inId)));
  }

  return pairs.length;
}
