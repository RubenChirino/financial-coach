import { createTestDb } from "@/test/db-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Replace the real db before importing summary.ts.
const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, categories, institutions, requisitions, transactions } = await import(
  "@/db/schema"
);
const { getMonthSummary, getTopCategoriesThisMonth, getAccountsTotal, getNeedsReviewCount } =
  await import("./summary");

// The data owner under test. A second user (USER_B) is used by the isolation
// test to prove one user's queries never see another's rows.
const USER_A = 1;
const USER_B = 2;

async function seed(userId = USER_A, balanceCents = 250_000) {
  // institutions, requisition, account
  const inst = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: `INST-${userId}`, name: "Test Bank", logoUrl: null, country: "ES" })
    .returning({ id: institutions.id });
  const req = await fixture.db
    .insert(requisitions)
    .values({
      userId,
      institutionId: inst[0]!.id,
      gocardlessRequisitionId: "ENC",
      status: "linked",
      reference: `ref-${userId}`,
      link: null,
    })
    .returning({ id: requisitions.id });
  const acc = await fixture.db
    .insert(accounts)
    .values({
      userId,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC",
      ibanLast4: "1234",
      name: "Checking",
      ownerName: null,
      balanceCents,
      currency: "EUR",
    })
    .returning({ id: accounts.id });

  // two categories — shared taxonomy, so insert once and reuse across users
  // (the isolation test seeds a second user without re-creating categories).
  await fixture.db
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
    .onConflictDoNothing();
  const cat = await fixture.db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);

  const groceriesId = cat.find((c) => c.slug === "groceries")!.id;
  const restaurantsId = cat.find((c) => c.slug === "restaurants")!.id;

  const now = new Date();
  const thisMonth = (day: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12));
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));

  await fixture.db.insert(transactions).values([
    // current month — income
    {
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: `tx-income-${userId}`,
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
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: `tx-g1-${userId}`,
      bookingDate: thisMonth(5),
      amountCents: -5000,
      currency: "EUR",
      merchantName: "Mercadona",
      rawDescription: "Mercadona",
      categoryId: groceriesId,
      needsReview: false,
    },
    {
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: `tx-g2-${userId}`,
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
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: `tx-r1-${userId}`,
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
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: `tx-rv-${userId}`,
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
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: `tx-old-${userId}`,
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
    await fixture.client.execute("DELETE FROM transactions");
    await fixture.client.execute("DELETE FROM accounts");
    await fixture.client.execute("DELETE FROM requisitions");
    await fixture.client.execute("DELETE FROM institutions");
    await fixture.client.execute("DELETE FROM categories");
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getMonthSummary splits income vs expense within current month only", async () => {
    const s = await getMonthSummary(USER_A, 0);
    expect(s.incomeCents).toBe(200_000);
    expect(s.expenseCents).toBe(-(5000 + 3000 + 2500 + 1000));
    expect(s.netCents).toBe(s.incomeCents + s.expenseCents);
    expect(s.txCount).toBe(5); // excludes last-month tx
    expect(s.currency).toBe("EUR");
  });

  it("getTopCategoriesThisMonth orders by spend desc and excludes income", async () => {
    const top = await getTopCategoriesThisMonth(USER_A, 10, 0);
    expect(top.map((c) => c.slug)).toEqual(["groceries", "restaurants"]);
    expect(top[0]?.spentCents).toBe(8000); // 5000 + 3000
    expect(top[1]?.spentCents).toBe(2500);
  });

  it("getAccountsTotal sums balances across accounts", async () => {
    const t = await getAccountsTotal(USER_A);
    expect(t.totalCents).toBe(250_000);
    expect(t.accountCount).toBe(1);
    expect(t.currency).toBe("EUR");
  });

  it("getNeedsReviewCount counts only flagged transactions", async () => {
    const n = await getNeedsReviewCount(USER_A);
    expect(n).toBe(1);
  });

  it("isolates each user's data: one user never sees another's rows", async () => {
    // Seed a second, independent user with a different balance + a single income
    // transaction this month. USER_A's aggregates must stay exactly as before.
    await seed(USER_B, 999_000);

    const aTotal = await getAccountsTotal(USER_A);
    expect(aTotal.totalCents).toBe(250_000);
    expect(aTotal.accountCount).toBe(1);

    const bTotal = await getAccountsTotal(USER_B);
    expect(bTotal.totalCents).toBe(999_000);
    expect(bTotal.accountCount).toBe(1);

    // USER_A's month summary is unchanged by USER_B's rows.
    const aSummary = await getMonthSummary(USER_A, 0);
    expect(aSummary.incomeCents).toBe(200_000);
    expect(aSummary.txCount).toBe(5);

    // USER_B sees only its own seeded month (same fixture shape → 5 tx this month).
    const bSummary = await getMonthSummary(USER_B, 0);
    expect(bSummary.incomeCents).toBe(200_000);
    expect(bSummary.txCount).toBe(5);

    // A guest-like user with no accounts sees nothing.
    const emptyTotal = await getAccountsTotal(999);
    expect(emptyTotal.totalCents).toBe(0);
    expect(emptyTotal.accountCount).toBe(0);
  });
});
