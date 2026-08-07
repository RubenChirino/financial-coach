"use server";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, categories, institutions, requisitions, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";

/** Hard cap so a runaway range can't build an unbounded payload. */
const MAX_ROWS = 50_000;

export interface ExportTxRow {
  /** YYYY-MM-DD (UTC). */
  date: string;
  merchant: string;
  description: string;
  categoryEs: string;
  categoryEn: string;
  account: string;
  institution: string;
  amountCents: number;
  currency: string;
}

export interface ExportHeatmapRow {
  /** YYYY-MM-DD (UTC). */
  date: string;
  receivedCents: number;
  spentCents: number;
  netCents: number;
}

export interface ExportDataResult {
  ok: boolean;
  error?: string;
  transactions?: ExportTxRow[];
  heatmap?: ExportHeatmapRow[];
  /** Display labels of the accounts included, for the document header. */
  accountLabels?: string[];
  currency?: string;
}

/**
 * Data source for the export wizard. Returns the user's transactions in the
 * requested window — merged across the selected accounts (null = all) and
 * ordered ASC by booking date, as the export file should read chronologically —
 * or, for `kind: "heatmap"`, the same rows pre-aggregated into one row per
 * calendar day with activity. The file itself (CSV/PDF) is built client-side.
 *
 * Read-only: guests may export their demo data.
 */
export async function exportDataAction(input: {
  kind: "transactions" | "heatmap";
  /** Account row ids to include; null/empty = every account. */
  accountIds: number[] | null;
  fromMs: number;
  toMs: number;
}): Promise<ExportDataResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!Number.isFinite(input.fromMs) || !Number.isFinite(input.toMs) || input.fromMs > input.toMs) {
    return { ok: false, error: "invalidRange" };
  }

  const conds = [
    eq(transactions.userId, session.userId),
    gte(transactions.bookingDate, new Date(input.fromMs)),
    lte(transactions.bookingDate, new Date(input.toMs)),
  ];
  const ids = input.accountIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (ids.length > 0) conds.push(inArray(transactions.accountId, ids));

  const rows = await db
    .select({
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
      categoryEs: categories.nameEs,
      categoryEn: categories.nameEn,
      accountName: accounts.name,
      institutionName: institutions.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(requisitions, eq(requisitions.id, accounts.requisitionId))
    .innerJoin(institutions, eq(institutions.id, requisitions.institutionId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(...conds))
    .orderBy(asc(transactions.bookingDate), asc(transactions.id))
    .limit(MAX_ROWS);

  const accountLabels = [...new Set(rows.map((r) => `${r.institutionName} · ${r.accountName}`))];
  const currency = rows[0]?.currency ?? "EUR";

  if (input.kind === "transactions") {
    return {
      ok: true,
      currency,
      accountLabels,
      transactions: rows.map((r) => ({
        date: r.bookingDate.toISOString().slice(0, 10),
        merchant: r.merchantName ?? "",
        description: r.rawDescription,
        categoryEs: r.categoryEs ?? "",
        categoryEn: r.categoryEn ?? "",
        account: r.accountName,
        institution: r.institutionName,
        amountCents: r.amountCents,
        currency: r.currency,
      })),
    };
  }

  // Heatmap: one row per UTC day with activity, chronological.
  const byDay = new Map<string, ExportHeatmapRow>();
  for (const r of rows) {
    const day = r.bookingDate.toISOString().slice(0, 10);
    let entry = byDay.get(day);
    if (!entry) {
      entry = { date: day, receivedCents: 0, spentCents: 0, netCents: 0 };
      byDay.set(day, entry);
    }
    if (r.amountCents >= 0) entry.receivedCents += r.amountCents;
    else entry.spentCents += -r.amountCents;
    entry.netCents += r.amountCents;
  }

  return {
    ok: true,
    currency,
    accountLabels,
    heatmap: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
