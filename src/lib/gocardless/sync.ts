import "server-only";

import { db } from "@/db/client";
import { accounts, institutions, requisitions, transactions } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { GoCardlessClient } from "./client";
import { normalizeTransaction, pickPrimaryBalance, toCents } from "./normalize";
import type { Institution, Requisition } from "./types";

const MAX_HISTORY_DAYS = 730;

function statusFromApi(
  status: Requisition["status"],
): "created" | "linked" | "expired" | "suspended" | "revoked" {
  switch (status) {
    case "LN":
      return "linked";
    case "EX":
      return "expired";
    case "SU":
      return "suspended";
    case "RJ":
      return "revoked";
    default:
      return "created";
  }
}

export async function upsertInstitution(inst: Institution): Promise<number> {
  const existing = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.gocardlessId, inst.id))
    .limit(1);

  if (existing[0]) {
    await db
      .update(institutions)
      .set({ name: inst.name, logoUrl: inst.logo, country: inst.countries[0] ?? "ES" })
      .where(eq(institutions.id, existing[0].id));
    return existing[0].id;
  }

  const inserted = await db
    .insert(institutions)
    .values({
      gocardlessId: inst.id,
      name: inst.name,
      logoUrl: inst.logo,
      country: inst.countries[0] ?? "ES",
    })
    .returning({ id: institutions.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("failed to insert institution");
  return id;
}

export async function createRequisition(
  client: GoCardlessClient,
  opts: {
    institution: Institution;
    redirectUrl: string;
    reference: string;
    encryptionKey: Buffer;
    language: "ES" | "EN";
  },
): Promise<{ requisitionRowId: number; link: string; gocardlessRequisitionId: string }> {
  const institutionRowId = await upsertInstitution(opts.institution);

  const req = await client.createRequisition({
    redirect: opts.redirectUrl,
    institution_id: opts.institution.id,
    reference: opts.reference,
    user_language: opts.language,
  });

  const encryptedId = encrypt(req.id, opts.encryptionKey);
  const expiresAt = new Date(Date.now() + MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const inserted = await db
    .insert(requisitions)
    .values({
      institutionId: institutionRowId,
      gocardlessRequisitionId: encryptedId,
      status: statusFromApi(req.status),
      reference: opts.reference,
      link: req.link,
      expiresAt,
    })
    .returning({ id: requisitions.id });

  const requisitionRowId = inserted[0]?.id;
  if (!requisitionRowId) throw new Error("failed to insert requisition");
  return { requisitionRowId, link: req.link, gocardlessRequisitionId: req.id };
}

/**
 * After the user finishes consent at their bank, GoCardless lists the
 * approved account IDs on the requisition. We persist one account row per
 * GoCardless account, storing the GC account id encrypted.
 */
export async function linkRequisitionAccounts(
  client: GoCardlessClient,
  opts: {
    requisitionRowId: number;
    gocardlessRequisitionId: string;
    encryptionKey: Buffer;
  },
): Promise<{ accountRowIds: number[] }> {
  const req = await client.getRequisition(opts.gocardlessRequisitionId);
  const status = statusFromApi(req.status);

  await db.update(requisitions).set({ status }).where(eq(requisitions.id, opts.requisitionRowId));

  if (status !== "linked") return { accountRowIds: [] };

  const rowIds: number[] = [];
  for (const accId of req.accounts) {
    const [details, balances] = await Promise.all([
      client.getAccountDetails(accId),
      client.getAccountBalances(accId).catch(() => ({ balances: [] })),
    ]);

    const encryptedAccId = encrypt(accId, opts.encryptionKey);
    const iban = details.account.iban ?? null;
    const ibanLast4 = iban ? iban.replace(/\s/g, "").slice(-4) : null;
    const primary = pickPrimaryBalance(balances.balances);
    const balanceCents = primary ? toCents(primary.balanceAmount.amount) : 0;
    const currency = primary?.balanceAmount.currency ?? details.account.currency ?? "EUR";

    const inserted = await db
      .insert(accounts)
      .values({
        requisitionId: opts.requisitionRowId,
        gocardlessAccountId: encryptedAccId,
        ibanLast4,
        name: details.account.name ?? details.account.product ?? "Cuenta",
        ownerName: details.account.ownerName ?? null,
        balanceCents,
        currency,
      })
      .returning({ id: accounts.id });
    const id = inserted[0]?.id;
    if (id) rowIds.push(id);
  }
  return { accountRowIds: rowIds };
}

export interface SyncAccountResult {
  inserted: number;
  skipped: number;
  insertedIds: number[];
}

/**
 * Pull recent transactions for an account and upsert them into the DB.
 * Dedup is driven by the unique index on `transactions.gocardless_transaction_id`;
 * we rely on `ON CONFLICT DO NOTHING` rather than pre-reading the set of
 * existing IDs. Returns counts for UX feedback.
 */
export async function syncAccountTransactions(
  client: GoCardlessClient,
  opts: {
    accountRowId: number;
    gocardlessAccountId: string;
    sinceDays?: number;
  },
): Promise<SyncAccountResult> {
  const sinceDays = opts.sinceDays ?? 90;
  const dateFrom = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const txs = await client.getAccountTransactions(opts.gocardlessAccountId, { dateFrom });

  const normalized = txs.transactions.booked
    .map((t) => normalizeTransaction(t, opts.gocardlessAccountId))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  if (normalized.length === 0) {
    await db
      .update(accounts)
      .set({ lastSyncedAt: new Date() })
      .where(eq(accounts.id, opts.accountRowId));
    return { inserted: 0, skipped: 0, insertedIds: [] };
  }

  const existing = await db
    .select({ id: transactions.gocardlessTransactionId })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, opts.accountRowId),
        inArray(
          transactions.gocardlessTransactionId,
          normalized.map((t) => t.externalId),
        ),
      ),
    );
  const existingIds = new Set(existing.map((r) => r.id));
  const fresh = normalized.filter((t) => !existingIds.has(t.externalId));

  const insertedIds: number[] = [];
  if (fresh.length > 0) {
    const rows = await db
      .insert(transactions)
      .values(
        fresh.map((t) => ({
          accountId: opts.accountRowId,
          gocardlessTransactionId: t.externalId,
          bookingDate: t.bookingDate,
          valueDate: t.valueDate,
          amountCents: t.amountCents,
          currency: t.currency,
          merchantName: t.merchantName,
          rawDescription: t.rawDescription,
          needsReview: true,
        })),
      )
      .returning({ id: transactions.id });
    for (const r of rows) insertedIds.push(r.id);
  }

  await db
    .update(accounts)
    .set({ lastSyncedAt: new Date() })
    .where(eq(accounts.id, opts.accountRowId));

  return {
    inserted: fresh.length,
    skipped: normalized.length - fresh.length,
    insertedIds,
  };
}
