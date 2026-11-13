"use server";

import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { accounts, institutions, requisitions, users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { GoCardlessClient, GoCardlessError } from "./client";
import {
  deleteGoCardlessCredentials,
  loadGoCardlessCredentials,
  saveGoCardlessCredentials,
} from "./credentials";
import { createRequisition, linkRequisitionAccounts, syncGoCardlessAccounts } from "./sync";
import type { Institution } from "./types";

export interface ActionOk<T = undefined> {
  ok: true;
  data?: T;
}
export interface ActionErr {
  ok: false;
  error: string;
}
export type ActionResult<T = undefined> = ActionOk<T> | ActionErr;

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) throw new Error("unauthenticated");
  // All callers here are bank-linking / sync writes (or the add-bank search that
  // leads to them) — never available to read-only guests.
  if (session.isGuest) throw new Error("guestReadOnly");
  return session;
}

async function requireClient(userId: number, encryptionKey: Buffer): Promise<GoCardlessClient> {
  const creds = await loadGoCardlessCredentials(userId, encryptionKey);
  if (!creds) throw new Error("noCredentials");
  return new GoCardlessClient(creds);
}

function humanizeError(err: unknown): string {
  if (err instanceof GoCardlessError) {
    const body = err.body;
    if (typeof body === "object" && body !== null) {
      const b = body as { summary?: string; detail?: string };
      return b.summary ?? b.detail ?? `GoCardless ${err.status}`;
    }
    return `GoCardless ${err.status}`;
  }
  if (err instanceof Error) {
    if (err.message === "unauthenticated") return "unauthenticated";
    if (err.message === "noCredentials") return "noCredentials";
    return err.message;
  }
  return "unknown";
}

export async function saveBankCredentialsAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const secretId = String(formData.get("secretId") ?? "").trim();
    const secretKey = String(formData.get("secretKey") ?? "").trim();
    if (!secretId || !secretKey) return { ok: false, error: "missingFields" };

    const testClient = new GoCardlessClient({ secretId, secretKey });
    await testClient.getToken();

    await saveGoCardlessCredentials(session.userId, session.encryptionKey, {
      secretId,
      secretKey,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export async function deleteBankCredentialsAction(): Promise<ActionResult> {
  try {
    const session = await requireSession();
    await deleteGoCardlessCredentials(session.userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export async function hasBankCredentialsAction(): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session) return false;
  return (await loadGoCardlessCredentials(session.userId, session.encryptionKey)) !== null;
}

export async function listInstitutionsAction(
  country: string,
): Promise<ActionResult<Institution[]>> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);
    const list = await client.listInstitutions(country);
    return { ok: true, data: list };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? `${env().HOST}:${env().PORT}`;
  return `${proto}://${host}`;
}

export async function startBankLinkAction(
  institutionId: string,
): Promise<ActionResult<{ link: string; reference: string }>> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);
    const inst = await client.getInstitution(institutionId);

    const origin = await originFromHeaders();
    const reference = `fc-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    const language = user?.language === "en" ? "EN" : "ES";

    const { link } = await createRequisition(client, {
      userId: session.userId,
      institution: inst,
      redirectUrl: `${origin}/settings/bank/callback?ref=${encodeURIComponent(reference)}`,
      reference,
      encryptionKey: session.encryptionKey,
      language,
    });
    return { ok: true, data: { link, reference } };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export async function finalizeBankLinkAction(
  reference: string,
): Promise<ActionResult<{ accountCount: number; pendingChoices: number }>> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);

    const row = await db
      .select()
      .from(requisitions)
      .where(and(eq(requisitions.userId, session.userId), eq(requisitions.reference, reference)))
      .limit(1);
    const req = row[0];
    if (!req) return { ok: false, error: "requisitionNotFound" };

    const gcId = decrypt(req.providerRequisitionId, session.encryptionKey);

    const linked = await linkRequisitionAccounts(client, {
      userId: session.userId,
      requisitionRowId: req.id,
      providerRequisitionId: gcId,
      encryptionKey: session.encryptionKey,
    });
    return {
      ok: true,
      data: { accountCount: linked.accountIds.length, pendingChoices: linked.pendingChoices },
    };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export async function syncAllAccountsAction(): Promise<
  ActionResult<{
    inserted: number;
    skipped: number;
    accounts: number;
    ruleMatched: number;
  }>
> {
  try {
    const session = await requireSession();
    const client = await requireClient(session.userId, session.encryptionKey);
    // Only real GoCardless-backed requisitions are polled; demo rows are
    // self-contained seeds with no network to call.
    const { inserted, skipped, accounts, ruleMatched } = await syncGoCardlessAccounts(client, {
      userId: session.userId,
      encryptionKey: session.encryptionKey,
    });
    return { ok: true, data: { inserted, skipped, accounts, ruleMatched } };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}

export interface BankConnectionSummary {
  requisitionId: number;
  status: string;
  provider: "gocardless" | "demo" | "truelayer" | "manual";
  institutionName: string;
  institutionLogo: string | null;
  accountCount: number;
  lastSyncedAt: number | null;
  createdAt: number;
}

export async function listBankConnectionsAction(): Promise<BankConnectionSummary[]> {
  const session = await getCurrentSession();
  if (!session) return [];
  const rows = await db
    .select({
      requisitionId: requisitions.id,
      status: requisitions.status,
      provider: requisitions.provider,
      institutionName: institutions.name,
      institutionLogo: institutions.logoUrl,
      createdAt: requisitions.createdAt,
    })
    .from(requisitions)
    .innerJoin(institutions, eq(institutions.id, requisitions.institutionId))
    .where(eq(requisitions.userId, session.userId))
    .orderBy(desc(requisitions.createdAt));

  const summaries: BankConnectionSummary[] = [];
  for (const r of rows) {
    const acc = await db
      .select({ id: accounts.id, lastSyncedAt: accounts.lastSyncedAt })
      .from(accounts)
      .where(and(eq(accounts.userId, session.userId), eq(accounts.requisitionId, r.requisitionId)));
    const lastSyncedAt = acc
      .map((a) => (a.lastSyncedAt ? a.lastSyncedAt.getTime() : 0))
      .reduce((max, v) => (v > max ? v : max), 0);
    summaries.push({
      requisitionId: r.requisitionId,
      status: r.status,
      provider: r.provider,
      institutionName: r.institutionName,
      institutionLogo: r.institutionLogo,
      accountCount: acc.length,
      lastSyncedAt: lastSyncedAt || null,
      createdAt: r.createdAt.getTime(),
    });
  }
  return summaries;
}

export async function deleteBankConnectionAction(requisitionId: number): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const row = await db
      .select()
      .from(requisitions)
      .where(and(eq(requisitions.userId, session.userId), eq(requisitions.id, requisitionId)))
      .limit(1);
    const req = row[0];
    if (!req) return { ok: false, error: "requisitionNotFound" };

    // Demo rows have no remote counterpart — skip the GC API call entirely,
    // and also skip loading a client (the user may not have any GC creds yet).
    if (req.provider === "gocardless") {
      const client = await requireClient(session.userId, session.encryptionKey).catch(() => null);
      if (client) {
        try {
          const gcId = decrypt(req.providerRequisitionId, session.encryptionKey);
          await client.deleteRequisition(gcId);
        } catch (err) {
          console.warn("remote requisition delete failed (continuing)", err);
        }
      }
    }
    await db
      .delete(requisitions)
      .where(and(eq(requisitions.userId, session.userId), eq(requisitions.id, requisitionId)));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: humanizeError(err) };
  }
}
