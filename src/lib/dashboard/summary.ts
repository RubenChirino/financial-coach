import "server-only";

import { db } from "@/db/client";
import {
  accounts,
  budgets,
  categories,
  institutions,
  requisitions,
  transactions,
} from "@/db/schema";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

export interface MonthSummary {
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  txCount: number;
  currency: string;
}

export interface CategoryBreakdown {
  categoryId: number;
  slug: string;
  nameEs: string;
  nameEn: string;
  icon: string;
  color: string;
  spentCents: number;
  budgetMonthlyCents: number | null;
  txCount: number;
}

export interface AccountsTotal {
  totalCents: number;
  currency: string;
  accountCount: number;
}

/**
 * Return {year, month} for the month offset from today (0 = current, -1 = prev).
 * Offsets use UTC to avoid off-by-one issues around DST.
 */
function monthRange(offset = 0): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, label };
}

export async function getMonthSummary(userId: number, offset = 0): Promise<MonthSummary> {
  const { start, end, label } = monthRange(offset);
  const result = await db
    .select({
      income: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end), 0)`,
      count: sql<number>`count(*)`,
      currency: sql<string | null>`max(${transactions.currency})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.bookingDate, start),
        lt(transactions.bookingDate, end),
      ),
    );

  const r = result[0] ?? { income: 0, expense: 0, count: 0, currency: null };
  return {
    month: label,
    incomeCents: Number(r.income) || 0,
    expenseCents: Number(r.expense) || 0,
    netCents: (Number(r.income) || 0) + (Number(r.expense) || 0),
    txCount: Number(r.count) || 0,
    currency: r.currency ?? "EUR",
  };
}

export async function getTopCategoriesThisMonth(
  userId: number,
  limit = 6,
  offset = 0,
): Promise<CategoryBreakdown[]> {
  const { start, end } = monthRange(offset);
  const rows = await db
    .select({
      categoryId: categories.id,
      slug: categories.slug,
      nameEs: categories.nameEs,
      nameEn: categories.nameEn,
      icon: categories.icon,
      color: categories.color,
      budgetMonthlyCents: budgets.monthlyCents,
      spentCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
      txCount: sql<number>`count(${transactions.id})`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(budgets, and(eq(budgets.categoryId, categories.id), eq(budgets.userId, userId)))
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.bookingDate, start),
        lt(transactions.bookingDate, end),
        isNotNull(transactions.categoryId),
        lt(transactions.amountCents, 0),
      ),
    )
    .groupBy(categories.id)
    .orderBy(
      desc(
        sql`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    slug: r.slug,
    nameEs: r.nameEs,
    nameEn: r.nameEn,
    icon: r.icon,
    color: r.color,
    spentCents: Number(r.spentCents) || 0,
    budgetMonthlyCents: r.budgetMonthlyCents ?? null,
    txCount: Number(r.txCount) || 0,
  }));
}

/**
 * SQL fragment that hides accounts which carry no balance AND no transactions —
 * a freshly-created shell with nothing in it. This is what filters the empty
 * "Imported Transactions" fallback out of the UI once the user has imported
 * to a real (IBAN-keyed) account instead.
 */
const accountIsVisible = sql`NOT (${accounts.balanceCents} = 0 AND NOT EXISTS (SELECT 1 FROM ${transactions} WHERE ${transactions.accountId} = ${accounts.id}))`;

export async function getAccountsTotal(userId: number): Promise<AccountsTotal> {
  const rows = await db
    .select({
      balance: accounts.balanceCents,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), accountIsVisible));
  if (rows.length === 0) return { totalCents: 0, currency: "EUR", accountCount: 0 };
  const total = rows.reduce((sum, r) => sum + (r.balance ?? 0), 0);
  const currency = rows[0]?.currency ?? "EUR";
  return { totalCents: total, currency, accountCount: rows.length };
}

export async function getNeedsReviewCount(userId: number): Promise<number> {
  const r = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.needsReview, true)));
  return Number(r[0]?.count) || 0;
}

export interface MonthFlowPoint {
  month: string; // "YYYY-MM"
  shortLabel: string; // "Apr" — pre-localized by caller
  incomeCents: number;
  expenseCents: number; // positive number (absolute value)
  netCents: number;
}

/**
 * Last N months (most recent last). Caller passes a locale so the short label
 * ("Apr" / "abr") is ready to render without a client-side `Intl` pass.
 */
export async function getMonthlyFlowHistory(
  userId: number,
  months = 6,
  locale: "es" | "en" = "es",
): Promise<MonthFlowPoint[]> {
  const intl = locale === "es" ? "es-ES" : "en-US";
  const fmt = new Intl.DateTimeFormat(intl, { month: "short" });
  const out: MonthFlowPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const { start, end, label } = monthRange(-i);
    const r = await db
      .select({
        income: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
        expense: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.bookingDate, start),
          lt(transactions.bookingDate, end),
        ),
      );
    const income = Number(r[0]?.income) || 0;
    const expense = Math.abs(Number(r[0]?.expense) || 0);
    out.push({
      month: label,
      shortLabel: fmt.format(start).replace(".", ""),
      incomeCents: income,
      expenseCents: expense,
      netCents: income - expense,
    });
  }
  return out;
}

export interface AccountTile {
  id: number;
  institutionName: string;
  institutionLogoUrl: string | null;
  accountName: string;
  ibanLast4: string | null;
  balanceCents: number;
  currency: string;
}

export async function listAccountsWithInstitutions(userId: number): Promise<AccountTile[]> {
  const rows = await db
    .select({
      id: accounts.id,
      institutionName: institutions.name,
      institutionLogoUrl: institutions.logoUrl,
      accountName: accounts.name,
      ibanLast4: accounts.ibanLast4,
      balanceCents: accounts.balanceCents,
      currency: accounts.currency,
    })
    .from(accounts)
    .innerJoin(requisitions, eq(requisitions.id, accounts.requisitionId))
    .innerJoin(institutions, eq(institutions.id, requisitions.institutionId))
    .where(and(eq(accounts.userId, userId), accountIsVisible))
    .orderBy(desc(accounts.balanceCents));
  return rows;
}

export interface InstitutionGroup {
  institutionName: string;
  institutionLogoUrl: string | null;
  requisitionId: number;
  provider: string;
  status: string;
  lastSyncedAt: Date | null;
  accounts: {
    id: number;
    name: string;
    ibanLast4: string | null;
    balanceCents: number;
    currency: string;
  }[];
}

/** Return accounts grouped by institution, ordered by total balance descending. */
export async function listInstitutionGroups(userId: number): Promise<InstitutionGroup[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      ibanLast4: accounts.ibanLast4,
      balanceCents: accounts.balanceCents,
      currency: accounts.currency,
      lastSyncedAt: accounts.lastSyncedAt,
      requisitionId: requisitions.id,
      provider: requisitions.provider,
      status: requisitions.status,
      institutionName: institutions.name,
      institutionLogoUrl: institutions.logoUrl,
    })
    .from(accounts)
    .innerJoin(requisitions, eq(requisitions.id, accounts.requisitionId))
    .innerJoin(institutions, eq(institutions.id, requisitions.institutionId))
    .where(and(eq(accounts.userId, userId), accountIsVisible))
    .orderBy(desc(accounts.balanceCents));

  const map = new Map<number, InstitutionGroup>();
  for (const r of rows) {
    let group = map.get(r.requisitionId);
    if (!group) {
      group = {
        institutionName: r.institutionName,
        institutionLogoUrl: r.institutionLogoUrl,
        requisitionId: r.requisitionId,
        provider: r.provider,
        status: r.status,
        lastSyncedAt: null,
        accounts: [],
      };
      map.set(r.requisitionId, group);
    }
    group.accounts.push({
      id: r.accountId,
      name: r.accountName,
      ibanLast4: r.ibanLast4,
      balanceCents: r.balanceCents,
      currency: r.currency,
    });
    // Track the most recent sync across all accounts in the group.
    if (r.lastSyncedAt) {
      if (!group.lastSyncedAt || r.lastSyncedAt > group.lastSyncedAt) {
        group.lastSyncedAt = r.lastSyncedAt;
      }
    }
  }

  // Sort groups by total balance (highest first).
  return Array.from(map.values()).sort((a, b) => {
    const sumA = a.accounts.reduce((s, acc) => s + acc.balanceCents, 0);
    const sumB = b.accounts.reduce((s, acc) => s + acc.balanceCents, 0);
    return sumB - sumA;
  });
}
