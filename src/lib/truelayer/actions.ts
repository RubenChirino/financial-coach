"use server";

import { randomBytes } from "node:crypto";
import { db } from "@/db/client";
import { accounts, requisitions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { categorizeBatchByRules } from "@/lib/categorize";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { TrueLayerClient, type TrueLayerCredentials, TrueLayerError } from "./client";
import {
  deleteTrueLayerCredentials,
  loadTrueLayerCredentials,
  saveTrueLayerCredentials,
} from "./credentials";
import {
  createTrueLayerPendingConnection,
  finalizeTrueLayerConnection,
  getValidAccessToken,
  syncTrueLayerAccountTransactions,
  upsertTrueLayerInstitution,
} from "./sync";

export interface TLActionOk<T = undefined> {
  ok: true;
  data?: T;
}
export interface TLActionErr {
  ok: false;
  error: string;
}
export type TLActionResult<T = undefined> = TLActionOk<T> | TLActionErr;

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) throw new Error("unauthenticated");
  // Only bank-linking / sync writes call this — never read-only guests.
  if (session.isGuest) throw new Error("guestReadOnly");
  return session;
}

async function requireClient(userId: number, encryptionKey: Buffer): Promise<TrueLayerClient> {
  const creds = await loadTrueLayerCredentials(userId, encryptionKey);
  if (!creds) throw new Error("noTrueLayerCredentials");
  return new TrueLayerClient(creds);
}

function humanizeError(err: unknown): string {
  if (err instanceof TrueLayerError) {
    const b = err.body as { error?: string; error_description?: string; message?: string } | null;
    return b?.error_description ?? b?.message ?? b?.error ?? `TrueLayer ${err.status}`;
  }
  if (err instanceof Error) return err.message;
  return "unknown";
}

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? `${env().HOST}:${env().PORT}`;
  return `${proto}://${host}`;
}

export async function saveTrueLayerCredentialsAction(formData: FormData): Promise<TLActionResult> {
  try {
    const session = await requireSession();
    const clientId = String(formData.get("clientId") ?? "").trim();
    const clientSecret = String(formData.get("clientSecret") ?? "").trim();
    const environment =
      String(formData.get("environment") ?? "sandbox").trim() === "live" ? "live" : "sandbox";
    if (!clientId || !clientSecret) return { ok: false, error: "missingFields" };

    const creds: TrueLayerCredentials = { clientId, clientSecret, environment };
    await saveTrueLayerCredentials(session.userId, session.encryptionKey, creds);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export async function deleteTrueLayerCredentialsAction(): Promise<TLActionResult> {
  try {
    const session = await requireSession();
    await deleteTrueLayerCredentials(session.userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export async function hasTrueLayerCredentialsAction(): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session) return false;
  return (await loadTrueLayerCredentials(session.userId, session.encryptionKey)) !== null;
}

/**
 * Kick off a TrueLayer OAuth consent flow. Returns the hosted-auth URL the
 * client should redirect to; we've already pre-inserted a placeholder
 * requisition keyed by `reference` (TrueLayer returns it as `state`).
 */
export async function startTrueLayerLinkAction(
  /** ISO-3166-1 alpha-2 country code (e.g. "ES", "GB"). When provided,
   *  TrueLayer's bank-picker is pre-filtered to institutions from that country. */
  country?: string,
): Promise<TLActionResult<{ link: string; reference: string }>> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);

    // We don't know the real bank yet — use a placeholder institution row so
    // the requisition.institutionId FK is satisfied. It gets overwritten in
    // the callback once we call listAccounts.
    const placeholderId = await upsertTrueLayerInstitution({
      providerId: "pending",
      displayName: "TrueLayer (pending)",
      logoUrl: null,
      country: country ?? "GB",
    });

    const reference = `tl-${Date.now()}-${randomBytes(4).toString("hex")}`;
    await createTrueLayerPendingConnection({
      reference,
      encryptionKey: session.encryptionKey,
      placeholderInstitutionId: placeholderId,
    });

    const origin = await originFromHeaders();
    const redirectUri = `${origin}/settings/bank/truelayer/callback`;
    const link = client.buildAuthUrl({ redirectUri, state: reference, country });
    return { ok: true, data: { link, reference } };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

/**
 * Handle the OAuth callback: exchange the `code` for tokens, list accounts,
 * and persist everything. Called from the callback page after TrueLayer
 * redirects back with `?code=...&state=<reference>`.
 */
export async function finalizeTrueLayerLinkAction(
  reference: string,
  code: string,
): Promise<TLActionResult<{ accountCount: number }>> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);

    const row = await db
      .select()
      .from(requisitions)
      .where(and(eq(requisitions.reference, reference), eq(requisitions.provider, "truelayer")))
      .limit(1);
    const req = row[0];
    if (!req) return { ok: false, error: "requisitionNotFound" };

    const origin = await originFromHeaders();
    const redirectUri = `${origin}/settings/bank/truelayer/callback`;

    const { accountRowIds } = await finalizeTrueLayerConnection(client, {
      requisitionRowId: req.id,
      code,
      redirectUri,
      encryptionKey: session.encryptionKey,
    });
    return { ok: true, data: { accountCount: accountRowIds.length } };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

/**
 * Sync every linked TrueLayer-backed account for the current user. Mirrors
 * `syncAllAccountsAction` in the GoCardless module but operates only on the
 * "truelayer" provider rows.
 */
export async function syncAllTrueLayerAccountsAction(): Promise<
  TLActionResult<{ inserted: number; skipped: number; accounts: number; ruleMatched: number }>
> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);

    const rows = await db
      .select({
        accountRowId: accounts.id,
        tlAccountCipher: accounts.gocardlessAccountId,
        requisitionId: requisitions.id,
      })
      .from(accounts)
      .innerJoin(requisitions, eq(accounts.requisitionId, requisitions.id))
      .where(and(eq(requisitions.status, "linked"), eq(requisitions.provider, "truelayer")));

    let inserted = 0;
    let skipped = 0;
    const allInsertedIds: number[] = [];
    // Cache the access token per requisition so we don't refresh twice if one
    // connection has multiple accounts.
    const tokenByReq = new Map<number, string>();

    for (const r of rows) {
      try {
        let accessToken = tokenByReq.get(r.requisitionId);
        if (!accessToken) {
          accessToken = await getValidAccessToken(client, {
            requisitionRowId: r.requisitionId,
            encryptionKey: session.encryptionKey,
          });
          tokenByReq.set(r.requisitionId, accessToken);
        }
        const tlAccId = decrypt(r.tlAccountCipher, session.encryptionKey);
        const res = await syncTrueLayerAccountTransactions(client, {
          accountRowId: r.accountRowId,
          tlAccountId: tlAccId,
          accessToken,
        });
        inserted += res.inserted;
        skipped += res.skipped;
        allInsertedIds.push(...res.insertedIds);
      } catch (err) {
        console.warn("truelayer sync account failed", r.accountRowId, err);
      }
    }

    const ruleMatched = await categorizeBatchByRules(allInsertedIds);
    return { ok: true, data: { inserted, skipped, accounts: rows.length, ruleMatched } };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

// Re-export types for convenience on the call-site.
export type { TrueLayerCredentials } from "./client";
