"use server";

import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { accounts, institutions, requisitions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { encrypt } from "@/lib/crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { snapshotBalances } from "./history";

const MANUAL_INSTITUTION_GCID = "MANUAL_LOCAL";
const MANUAL_REFERENCE = "manual-local";

export type ManualAccountKind = "cash" | "investment" | "property" | "vehicle" | "loan" | "other";
const MANUAL_KINDS: ManualAccountKind[] = [
  "cash",
  "investment",
  "property",
  "vehicle",
  "loan",
  "other",
];

export interface ManualAccountInput {
  name: string;
  kind: ManualAccountKind;
  /** Magnitude in cents as entered. Liabilities are stored negative; see below. */
  balanceCents: number;
  currency: string;
}

export interface ManualAccountResult {
  ok: boolean;
  error?: string;
  accountId?: number;
}

export interface ManualAccountRow {
  id: number;
  name: string;
  kind: string;
  balanceCents: number;
  currency: string;
}

/** Liabilities reduce net worth, so they're persisted as a negative balance. */
function normalizeBalance(kind: ManualAccountKind, balanceCents: number): number {
  const n = Math.round(balanceCents);
  return kind === "loan" ? -Math.abs(n) : n;
}

function validate(input: ManualAccountInput): string | null {
  if (!input.name?.trim()) return "nameRequired";
  if (!MANUAL_KINDS.includes(input.kind)) return "invalidKind";
  if (!Number.isFinite(input.balanceCents)) return "invalidBalance";
  if (!input.currency?.trim()) return "invalidCurrency";
  return null;
}

/**
 * Idempotently ensure the synthetic "Manual" institution + per-user
 * `provider:"manual"` requisition exist, so manual accounts hang off a real
 * requisition row (accounts.requisitionId is NOT NULL) and every existing join
 * keeps working unchanged. Mirrors `ensureImportedAccount` in the import path.
 */
async function ensureManualRequisition(userId: number, encryptionKey: Buffer): Promise<number> {
  const existingInst = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.gocardlessId, MANUAL_INSTITUTION_GCID))
    .limit(1);
  const institutionId =
    existingInst[0]?.id ??
    (
      await db
        .insert(institutions)
        .values({
          gocardlessId: MANUAL_INSTITUTION_GCID,
          name: "Manual",
          logoUrl: null,
          country: "ES",
        })
        .returning({ id: institutions.id })
    )[0]?.id;
  if (!institutionId) throw new Error("failed to ensure manual institution");

  const existingReq = await db
    .select({ id: requisitions.id })
    .from(requisitions)
    .where(
      and(
        eq(requisitions.userId, userId),
        eq(requisitions.institutionId, institutionId),
        eq(requisitions.reference, MANUAL_REFERENCE),
      ),
    )
    .limit(1);
  const requisitionId =
    existingReq[0]?.id ??
    (
      await db
        .insert(requisitions)
        .values({
          userId,
          institutionId,
          provider: "manual",
          gocardlessRequisitionId: encrypt(MANUAL_REFERENCE, encryptionKey),
          status: "linked",
          reference: MANUAL_REFERENCE,
          link: null,
          expiresAt: null,
        })
        .returning({ id: requisitions.id })
    )[0]?.id;
  if (!requisitionId) throw new Error("failed to ensure manual requisition");
  return requisitionId;
}

export async function createManualAccountAction(
  input: ManualAccountInput,
): Promise<ManualAccountResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const requisitionId = await ensureManualRequisition(session.userId, session.encryptionKey);
  const inserted = await db
    .insert(accounts)
    .values({
      userId: session.userId,
      requisitionId,
      gocardlessAccountId: encrypt(`manual-${randomUUID()}`, session.encryptionKey),
      name: input.name.trim().slice(0, 80),
      kind: input.kind,
      isManual: true,
      balanceCents: normalizeBalance(input.kind, input.balanceCents),
      currency: input.currency,
    })
    .returning({ id: accounts.id });

  await snapshotBalances(session.userId).catch(() => 0);
  revalidatePath("/");
  revalidatePath("/banks");
  return { ok: true, accountId: inserted[0]?.id };
}

export async function updateManualAccountAction(
  accountId: number,
  input: ManualAccountInput,
): Promise<ManualAccountResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  await db
    .update(accounts)
    .set({
      name: input.name.trim().slice(0, 80),
      kind: input.kind,
      balanceCents: normalizeBalance(input.kind, input.balanceCents),
      currency: input.currency,
    })
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, session.userId),
        eq(accounts.isManual, true),
      ),
    );

  await snapshotBalances(session.userId).catch(() => 0);
  revalidatePath("/");
  revalidatePath("/banks");
  return { ok: true, accountId };
}

/** List the current user's manual accounts (for the Banks management UI). */
export async function listManualAccountsAction(): Promise<ManualAccountRow[]> {
  const session = await getCurrentSession();
  if (!session) return [];
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      balanceCents: accounts.balanceCents,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, session.userId), eq(accounts.isManual, true)));
}
