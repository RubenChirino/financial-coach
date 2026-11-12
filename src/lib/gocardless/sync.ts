import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, requisitions } from "@/db/schema";
import { type LinkResult, linkProviderAccounts, normalizeAccountNumber } from "@/lib/accounts/link";
import { decrypt, encrypt } from "@/lib/crypto";
import { upsertInstitution as upsertInstitutionRow } from "@/lib/ingest/institutions";
import {
  type AccountIngest,
  type IngestRow,
  ingestTransactions,
  syncWindowStart,
} from "@/lib/ingest/pipeline";
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
  return upsertInstitutionRow({
    gocardlessId: inst.id,
    name: inst.name,
    logoUrl: inst.logo,
    country: inst.countries[0] ?? "ES",
  });
}

export async function createRequisition(
  client: GoCardlessClient,
  opts: {
    userId: number;
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
      userId: opts.userId,
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
 * approved account ids on the requisition. Each one is linked through
 * `linkProviderAccounts`: a new account, an existing account continued
 * (re-link), or a question for the user. Safe to call again for the same
 * requisition (the callback page can be reloaded).
 */
export async function linkRequisitionAccounts(
  client: GoCardlessClient,
  opts: {
    userId: number;
    requisitionRowId: number;
    gocardlessRequisitionId: string;
    encryptionKey: Buffer;
  },
): Promise<LinkResult> {
  const req = await client.getRequisition(opts.gocardlessRequisitionId);
  const status = statusFromApi(req.status);

  await db
    .update(requisitions)
    .set({ status })
    .where(and(eq(requisitions.userId, opts.userId), eq(requisitions.id, opts.requisitionRowId)));

  if (status !== "linked") return { accountIds: [], created: 0, adopted: 0, pendingChoices: 0 };

  return linkProviderAccounts({
    userId: opts.userId,
    requisitionId: opts.requisitionRowId,
    encryptionKey: opts.encryptionKey,
    providerAccountIds: req.accounts,
    describe: async (accId) => {
      const [details, balances] = await Promise.all([
        client.getAccountDetails(accId),
        client.getAccountBalances(accId).catch(() => ({ balances: [] })),
      ]);
      const iban = normalizeAccountNumber(details.account.iban);
      const primary = pickPrimaryBalance(balances.balances);
      return {
        providerAccountId: accId,
        accountNumber: iban,
        ibanLast4: iban ? iban.slice(-4) : null,
        name: details.account.name ?? details.account.product ?? "Cuenta",
        ownerName: details.account.ownerName ?? null,
        balanceCents: primary ? toCents(primary.balanceAmount.amount) : 0,
        currency: primary?.balanceAmount.currency ?? details.account.currency ?? "EUR",
      };
    },
  });
}

/** Fetch and normalize one account's booked transactions since `since`. */
export async function fetchGoCardlessAccount(
  client: GoCardlessClient,
  opts: { gocardlessAccountId: string; since: Date },
): Promise<IngestRow[]> {
  const dateFrom = opts.since.toISOString().slice(0, 10);
  const txs = await client.getAccountTransactions(opts.gocardlessAccountId, { dateFrom });
  return txs.transactions.booked
    .map((t) => normalizeTransaction(t, opts.gocardlessAccountId))
    .filter((t): t is NonNullable<typeof t> => t !== null);
}

export interface SyncResult {
  inserted: number;
  skipped: number;
  accounts: number;
  /** Accounts whose fetch failed; their cursor did not move. */
  failed: number;
  ruleMatched: number;
}

/**
 * Sync every linked GoCardless account of the user: fetch each account from
 * its own cursor (see `syncWindowStart`), then ingest them all through the
 * pipeline in one run. An account whose fetch fails is left out, so its
 * `last_synced_at` stays put and the next sync covers the gap.
 */
export async function syncGoCardlessAccounts(
  client: GoCardlessClient,
  opts: { userId: number; encryptionKey: Buffer },
): Promise<SyncResult> {
  const rows = await db
    .select({
      accountRowId: accounts.id,
      cipher: accounts.gocardlessAccountId,
      lastSyncedAt: accounts.lastSyncedAt,
    })
    .from(accounts)
    .innerJoin(requisitions, eq(accounts.requisitionId, requisitions.id))
    .where(
      and(
        eq(requisitions.userId, opts.userId),
        eq(requisitions.status, "linked"),
        eq(requisitions.provider, "gocardless"),
      ),
    );

  const parts: AccountIngest[] = [];
  let failed = 0;
  for (const r of rows) {
    try {
      const gocardlessAccountId = decrypt(r.cipher, opts.encryptionKey);
      const since = syncWindowStart(r.lastSyncedAt);
      parts.push({
        accountId: r.accountRowId,
        rows: await fetchGoCardlessAccount(client, { gocardlessAccountId, since }),
      });
    } catch (err) {
      failed++;
      console.warn("gocardless fetch failed", r.accountRowId, err);
    }
  }

  const res = await ingestTransactions({
    userId: opts.userId,
    source: "gocardless",
    accounts: parts,
  });
  return {
    inserted: res.inserted,
    skipped: res.duplicates,
    accounts: rows.length,
    failed,
    ruleMatched: res.ruleMatched + res.keywordMatched,
  };
}
