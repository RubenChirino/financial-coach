import "server-only";

import { db } from "@/db/client";
import { accounts, institutions, requisitions, transactions } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { TrueLayerClient, TrueLayerConnectionTokens } from "./client";
import { decimalToCents, normalizeTrueLayerTransaction } from "./normalize";
import type { TrueLayerAccount } from "./types";

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

function serializeTokens(tokens: TrueLayerConnectionTokens): string {
  return JSON.stringify(tokens);
}

function parseTokens(raw: string): TrueLayerConnectionTokens {
  const parsed = JSON.parse(raw) as Partial<TrueLayerConnectionTokens>;
  if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== "number") {
    throw new Error("invalid TrueLayer tokens blob");
  }
  return parsed as TrueLayerConnectionTokens;
}

/**
 * Upsert a TrueLayer "institution" row keyed by `tl_<provider_id>` to avoid
 * colliding with GoCardless institution IDs on the unique index.
 */
export async function upsertTrueLayerInstitution(opts: {
  providerId: string;
  displayName: string;
  logoUrl: string | null;
  country: string;
}): Promise<number> {
  const externalId = `tl_${opts.providerId}`;
  const existing = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.gocardlessId, externalId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(institutions)
      .set({ name: opts.displayName, logoUrl: opts.logoUrl, country: opts.country })
      .where(eq(institutions.id, existing[0].id));
    return existing[0].id;
  }

  const inserted = await db
    .insert(institutions)
    .values({
      gocardlessId: externalId,
      name: opts.displayName,
      logoUrl: opts.logoUrl,
      country: opts.country,
    })
    .returning({ id: institutions.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("failed to insert institution");
  return id;
}

/**
 * Create a pending TrueLayer "requisition" row — analogous to GoCardless's
 * requisition but the encrypted blob stores `{accessToken, refreshToken,
 * expiresAt}` once the OAuth callback completes. Before that, the blob holds
 * an empty placeholder so the NOT-NULL constraint is satisfied.
 */
export async function createTrueLayerPendingConnection(opts: {
  userId: number;
  reference: string;
  encryptionKey: Buffer;
  /** Temporary placeholder institution — real one is resolved after consent. */
  placeholderInstitutionId: number;
}): Promise<{ requisitionRowId: number }> {
  const placeholder = encrypt(
    JSON.stringify({ accessToken: "", refreshToken: "", expiresAt: 0 }),
    opts.encryptionKey,
  );

  const inserted = await db
    .insert(requisitions)
    .values({
      userId: opts.userId,
      institutionId: opts.placeholderInstitutionId,
      provider: "truelayer",
      gocardlessRequisitionId: placeholder,
      status: "created",
      reference: opts.reference,
      link: null,
    })
    .returning({ id: requisitions.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("failed to insert requisition");
  return { requisitionRowId: id };
}

/**
 * After the OAuth callback produces an authorization code, exchange it for
 * tokens, resolve the real provider, persist accounts + balances, and flip
 * the requisition to "linked".
 */
export async function finalizeTrueLayerConnection(
  client: TrueLayerClient,
  opts: {
    userId: number;
    requisitionRowId: number;
    code: string;
    redirectUri: string;
    encryptionKey: Buffer;
  },
): Promise<{ accountRowIds: number[] }> {
  const tokenRes = await client.exchangeCode(opts.code, opts.redirectUri);
  if (!tokenRes.refresh_token) {
    throw new Error(
      "TrueLayer did not return a refresh_token — did the consent include offline_access?",
    );
  }
  const tokens: TrueLayerConnectionTokens = {
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token,
    expiresAt: Date.now() + tokenRes.expires_in * 1000,
  };

  const tlAccounts = await client.listAccounts(tokens.accessToken);
  if (tlAccounts.length === 0) {
    // Persist tokens so the user can retry sync, but mark the requisition
    // linked-with-no-accounts by leaving status as "created" so the UI treats
    // it as an incomplete connection.
    await db
      .update(requisitions)
      .set({ gocardlessRequisitionId: encrypt(serializeTokens(tokens), opts.encryptionKey) })
      .where(and(eq(requisitions.userId, opts.userId), eq(requisitions.id, opts.requisitionRowId)));
    return { accountRowIds: [] };
  }

  // Resolve the institution from the first account's provider (TrueLayer
  // groups accounts under a single bank per consent).
  const first = tlAccounts[0];
  if (!first) throw new Error("no TrueLayer accounts returned");
  const institutionRowId = await upsertTrueLayerInstitution({
    providerId: first.provider.provider_id,
    displayName: first.provider.display_name ?? first.provider.provider_id,
    logoUrl: first.provider.logo_uri ?? null,
    country: guessCountryFromProviderId(first.provider.provider_id),
  });

  await db
    .update(requisitions)
    .set({
      institutionId: institutionRowId,
      status: "linked",
      gocardlessRequisitionId: encrypt(serializeTokens(tokens), opts.encryptionKey),
    })
    .where(and(eq(requisitions.userId, opts.userId), eq(requisitions.id, opts.requisitionRowId)));

  const rowIds: number[] = [];
  for (const acc of tlAccounts) {
    const balance = await client.getBalance(tokens.accessToken, acc.account_id).catch(() => null);
    const balanceCents = balance ? decimalToCents(balance.current) : 0;
    const ibanLast4 = acc.account_number?.iban
      ? acc.account_number.iban.replace(/\s/g, "").slice(-4)
      : (acc.account_number?.number?.slice(-4) ?? null);

    const encryptedAccId = encrypt(acc.account_id, opts.encryptionKey);
    const inserted = await db
      .insert(accounts)
      .values({
        userId: opts.userId,
        requisitionId: opts.requisitionRowId,
        gocardlessAccountId: encryptedAccId,
        ibanLast4,
        name: acc.display_name || acc.account_type || "Account",
        balanceCents,
        currency: acc.currency || "GBP",
      })
      .returning({ id: accounts.id });
    const id = inserted[0]?.id;
    if (id) rowIds.push(id);
  }

  return { accountRowIds: rowIds };
}

/**
 * Return a valid access token for a TrueLayer connection, refreshing it (and
 * persisting the rotated pair) if it's within the refresh buffer.
 */
export async function getValidAccessToken(
  client: TrueLayerClient,
  opts: { userId: number; requisitionRowId: number; encryptionKey: Buffer },
): Promise<string> {
  const row = await db
    .select({ blob: requisitions.gocardlessRequisitionId })
    .from(requisitions)
    .where(and(eq(requisitions.userId, opts.userId), eq(requisitions.id, opts.requisitionRowId)))
    .limit(1);
  const rec = row[0];
  if (!rec) throw new Error("requisition not found");

  const tokens = parseTokens(decrypt(rec.blob, opts.encryptionKey));
  if (tokens.accessToken && tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) throw new Error("TrueLayer token expired and no refresh_token stored");
  const refreshed = await client.refreshAccessToken(tokens.refreshToken);
  const next: TrueLayerConnectionTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
  };
  await db
    .update(requisitions)
    .set({ gocardlessRequisitionId: encrypt(serializeTokens(next), opts.encryptionKey) })
    .where(and(eq(requisitions.userId, opts.userId), eq(requisitions.id, opts.requisitionRowId)));
  return next.accessToken;
}

export interface TrueLayerSyncResult {
  inserted: number;
  skipped: number;
  insertedIds: number[];
}

/** Pull recent transactions for one TrueLayer account and upsert them. */
export async function syncTrueLayerAccountTransactions(
  client: TrueLayerClient,
  opts: {
    userId: number;
    accountRowId: number;
    tlAccountId: string;
    accessToken: string;
    sinceDays?: number;
  },
): Promise<TrueLayerSyncResult> {
  const sinceDays = opts.sinceDays ?? 90;
  const from = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const txs = await client.getTransactions(opts.accessToken, opts.tlAccountId, { from });

  const normalized = txs
    .map((t) => normalizeTrueLayerTransaction(t, opts.tlAccountId))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  if (normalized.length === 0) {
    await db
      .update(accounts)
      .set({ lastSyncedAt: new Date() })
      .where(and(eq(accounts.userId, opts.userId), eq(accounts.id, opts.accountRowId)));
    return { inserted: 0, skipped: 0, insertedIds: [] };
  }

  const existing = await db
    .select({ id: transactions.gocardlessTransactionId })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, opts.userId),
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
          userId: opts.userId,
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
    .where(and(eq(accounts.userId, opts.userId), eq(accounts.id, opts.accountRowId)));

  return { inserted: fresh.length, skipped: normalized.length - fresh.length, insertedIds };
}

export type { TrueLayerAccount };

/**
 * Heuristic country mapping from the TrueLayer provider_id slug. Covers the
 * common prefixes; unknown providers default to GB (TrueLayer's home market).
 */
function guessCountryFromProviderId(providerId: string): string {
  const id = providerId.toLowerCase();
  if (id.includes("-fr-") || id.startsWith("fr-")) return "FR";
  if (id.includes("-de-") || id.startsWith("de-")) return "DE";
  if (id.includes("-es-") || id.startsWith("es-")) return "ES";
  if (id.includes("-ie-") || id.startsWith("ie-")) return "IE";
  if (id.includes("-it-") || id.startsWith("it-")) return "IT";
  if (id.includes("-nl-") || id.startsWith("nl-")) return "NL";
  if (id.includes("-pl-") || id.startsWith("pl-")) return "PL";
  if (id.includes("-pt-") || id.startsWith("pt-")) return "PT";
  return "GB";
}
