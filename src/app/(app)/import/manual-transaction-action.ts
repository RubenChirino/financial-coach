"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth/session";
import { ensureImportedAccount } from "@/lib/import/ingest";
import { ingestTransactions } from "@/lib/ingest/pipeline";

export interface AddManualTransactionResult {
  ok: boolean;
  error?: string;
}

/**
 * Insert a single manually-entered transaction into the "Imported Transactions"
 * account through the ingestion pipeline, and recompute the account balance.
 * A category the user picked is kept as a manual pick (confidence 100, which
 * the correction pass never overwrites); without one, rules and keywords run.
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
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

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
    userId: session.userId,
    encryptionKey: session.encryptionKey,
  });

  const bookingDate = new Date(`${input.date}T12:00:00Z`);

  await ingestTransactions({
    userId: session.userId,
    source: "manual",
    accounts: [
      {
        accountId: accountRowId,
        balance: { mode: "sum" },
        rows: [
          {
            // "manual:" prefix + UUID makes it recognisable in debug queries.
            externalId: `manual:${randomUUID()}`,
            bookingDate,
            amountCents: input.amountCents,
            currency: input.currency.toUpperCase(),
            merchantName: input.merchant.trim() || null,
            rawDescription: input.description.trim(),
            categoryId: input.categoryId ?? null,
            confidence: input.categoryId != null ? 100 : null,
            needsReview: false,
          },
        ],
      },
    ],
  });

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/import");

  return { ok: true };
}
