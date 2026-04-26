import { createTestDb } from "@/test/db-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Replace the real db before importing summary.ts.
const fixture = createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, sqlite: fixture.sqlite }));

const { accounts, categories, institutions, requisitions, transactions } = await import(
  "@/db/schema"
);
const { getMonthSummary, getTopCategoriesThisMonth, getAccountsTotal, getNeedsReviewCount } =
  await import("./summary");

async function seed() {
  // institutions, requisition, account
  const inst = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "INST-1", name: "Test Bank", logoUrl: null, country: "ES" })
    .returning({ id: institutions.id });
  const req = await fixture.db
    .insert(requisitions)
    .values({
      institutionId: inst[0]!.id,
      gocardlessRequisitionId: "ENC",
      status: "linked",
      reference: "ref",
      link: null,
    })
    .returning({ id: requisitions.id });
  const acc = await fixture.db
    .insert(accounts)
    .values({
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC",
      ibanLast4: "1234",
      name: "Checking",
      ownerName: null,
      balanceCents: 250_000,
      currency: "EUR",
    })
    .returning({ id: accounts.id });

  // two categories
  const cat = await fixture.db
    .insert(categories)
    .values([
      {
        slug: "groceries",
        nameEs: "Alimentación",
        nameEn: "Groceries",
        icon: "🛒",
        color: "#10b981",
        sortOrder: 1,
      },
      {
        slug: "restaurants",
        nameEs: "Restaurantes",
        nameEn: "Restaurants",
        icon: "🍽️",
        color: "#f59e0b",
        sortOrder: 2,
      },
    ])
    .returning({ id: categories.id, slug: categories.slug });

  const groceriesId = cat.find((c) => c.slug === "groceries")!.id;
  const restaurantsId = cat.find((c) => c.slug === "restaurants")!.id;

  const now = new Date();
  const thisMonth = (day: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12));
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));

  await fixture.db.insert(transactions).values([
    // current month — income
    {
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-income",
      bookingDate: thisMonth(1),
      amountCents: 200_000,
      currency: "EUR",
      merchantName: "Salary",
      rawDescription: "Salary",
      categoryId: null,
      needsReview: false,
    },
    // current month — groceries -50, -30
    {
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-g1",
      bookingDate: thisMonth(5),
      amountCents: -5000,
      currency: "EUR",
      merchantName: "Mercadona",
      rawDescription: "Mercadona",
      categoryId: groceriesId,
      needsReview: false,
    },
    {
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-g2",
      bookingDate: thisMonth(10),
      amountCents: -3000,
      currency: "EUR",
      merchantName: "Lidl",
      rawDescription: "Lidl",
      categoryId: groceriesId,
      needsReview: false,
    },
    // current month — restaurants -25
    {
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-r1",
      bookingDate: thisMonth(12),
      amountCents: -2500,
      currency: "EUR",
      merchantName: "Cafe",
      rawDescription: "Cafe",
      categoryId: restaurantsId,
      needsReview: false,
    },
    // current month — needs review (uncategorized)
    {
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-rv",
      bookingDate: thisMonth(15),
      amountCents: -1000,
      currency: "EUR",
      merchantName: "Mystery",
      rawDescription: "?",
      categoryId: null,
      needsReview: true,
    },
    // last month — should NOT count toward this-month aggregates
    {
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-old",
      bookingDate: lastMonth,
      amountCents: -9999,
      currency: "EUR",
      merchantName: "Old",
      rawDescription: "Old",
      categoryId: groceriesId,
      needsReview: false,
    },
  ]);
}

describe("dashboard/summary", () => {
  beforeEach(async () => {
    fixture.sqlite.exec("DELETE FROM transactions");
    fixture.sqlite.exec("DELETE FROM accounts");
    fixture.sqlite.exec("DELETE FROM requisitions");
    fixture.sqlite.exec("DELETE FROM institutions");
    fixture.sqlite.exec("DELETE FROM categories");
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getMonthSummary splits income vs expense within current month only", async () => {
    const s = await getMonthSummary(0);
    expect(s.incomeCents).toBe(200_000);
    expect(s.expenseCents).toBe(-(5000 + 3000 + 2500 + 1000));
    expect(s.netCents).toBe(s.incomeCents + s.expenseCents);
    expect(s.txCount).toBe(5); // excludes last-month tx
    expect(s.currency).toBe("EUR");
  });

  it("getTopCategoriesThisMonth orders by spend desc and excludes income", async () => {
    const top = await getTopCategoriesThisMonth(10, 0);
    expect(top.map((c) => c.slug)).toEqual(["groceries", "restaurants"]);
    expect(top[0]?.spentCents).toBe(8000); // 5000 + 3000
    expect(top[1]?.spentCents).toBe(2500);
  });

  it("getAccountsTotal sums balances across accounts", async () => {
    const t = await getAccountsTotal();
    expect(t.totalCents).toBe(250_000);
    expect(t.accountCount).toBe(1);
    expect(t.currency).toBe("EUR");
  });

  it("getNeedsReviewCount counts only flagged transactions", async () => {
    const n = await getNeedsReviewCount();
    expect(n).toBe(1);
  });
});
