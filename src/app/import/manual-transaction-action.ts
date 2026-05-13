"use server";

import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { accounts, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { ensureImportedAccount } from "@/lib/import/ingest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface AddManualTransactionResult {
  ok: boolean;
  error?: string;
}

/**
 * Insert a single manually-entered transaction into the "Imported Transactions"
 * account and recompute the account balance.
 *
 * `amountCents` must be signed: negative = expense, positive = income.
 */
export async function addManualTransactionAction(input: {
  date: string; // ISO YYYY-MM-DD
  amountCents: number; // signed integer, in cents
  currency: string; // 3-letter ISO code
  merchant: string; // optional, empty string → stored as null
  description: string; // required
  categoryId: number | null;
}): Promise<AddManualTransactionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: "invalidDate" };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    return { ok: false, error: "invalidAmount" };
  }
  if (!input.description.trim()) {
    return { ok: false, error: "missingDescription" };
  }

  const { accountRowId } = await ensureImportedAccount({
    encryptionKey: session.encryptionKey,
  });

  const bookingDate = new Date(`${input.date}T12:00:00Z`);

  await db.insert(transactions).values({
    accountId: accountRowId,
    // Unique ID — "manual:" prefix + UUID makes it recognisable in debug queries.
    gocardlessTransactionId: `manual:${randomUUID()}`,
    bookingDate,
    amountCents: input.amountCents,
    currency: input.currency.toUpperCase(),
    merchantName: input.merchant.trim() || null,
    rawDescription: input.description.trim(),
    categoryId: input.categoryId ?? null,
    needsReview: false,
  });

  // Recompute cached account balance.
  const sumRow = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
    .from(transactions)
    .where(eq(transactions.accountId, accountRowId));
  await db
    .update(accounts)
    .set({ balanceCents: Number(sumRow[0]?.total ?? 0), lastSyncedAt: new Date() })
    .where(eq(accounts.id, accountRowId));

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/import");

  return { ok: true };
}
