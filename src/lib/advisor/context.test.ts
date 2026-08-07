import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

// Replace the real db before importing modules that read it.
const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, budgets, categories, institutions, requisitions, transactions, users } =
  await import("@/db/schema");
const { buildAdvisorContext } = await import("./context");

// Captured from the seeded user row so every call scopes to the same owner.
let userId = 0;

async function seed() {
  const usr = await fixture.db
    .insert(users)
    .values({ encryptionSalt: "salt", name: "Owner" })
    .returning({ id: users.id });
  userId = usr[0]!.id;

  const inst = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "INST-1", name: "Bank", logoUrl: null, country: "ES" })
    .returning({ id: institutions.id });
  const req = await fixture.db
    .insert(requisitions)
    .values({
      userId,
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
      userId,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC",
      ibanLast4: "1234",
      name: "Checking",
      ownerName: null,
      balanceCents: 357_900, // 3,579 EUR
      currency: "EUR",
    })
    .returning({ id: accounts.id });

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
        // no budget
      },
    ])
    .returning({ id: categories.id, slug: categories.slug });

  const groceriesId = cat.find((c) => c.slug === "groceries")!.id;
  const restaurantsId = cat.find((c) => c.slug === "restaurants")!.id;

  // Budgets are per-user now — 300 EUR on groceries for this owner.
  await fixture.db
    .insert(budgets)
    .values({ userId, categoryId: groceriesId, monthlyCents: 30_000 });

  const now = new Date();
  const thisMonth = (day: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12));

  await fixture.db.insert(transactions).values([
    // Income this month
    {
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-income",
      bookingDate: thisMonth(1),
      amountCents: 250_000,
      currency: "EUR",
      merchantName: "Salary",
      rawDescription: "Salary",
      categoryId: null,
      needsReview: false,
    },
    // Groceries this month — merchant name contains an IBAN that MUST be redacted
    {
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-g1",
      bookingDate: thisMonth(5),
      amountCents: -12_000, // 120 EUR
      currency: "EUR",
      merchantName: "Mercadona ES7600491500051234567892",
      rawDescription: "Mercadona",
      categoryId: groceriesId,
      needsReview: false,
    },
    {
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-g2",
      bookingDate: thisMonth(10),
      amountCents: -8_000, // 80 EUR
      currency: "EUR",
      merchantName: "Lidl",
      rawDescription: "Lidl",
      categoryId: groceriesId,
      needsReview: false,
    },
    {
      userId,
      accountId: acc[0]!.id,
      gocardlessTransactionId: "tx-r1",
      bookingDate: thisMonth(12),
      amountCents: -4_500, // 45 EUR
      currency: "EUR",
      merchantName: "Cafe Central",
      rawDescription: "Cafe Central",
      categoryId: restaurantsId,
      needsReview: false,
    },
  ]);
}

describe("buildAdvisorContext", () => {
  beforeEach(async () => {
    await fixture.client.execute("DELETE FROM budgets");
    await fixture.client.execute("DELETE FROM transactions");
    await fixture.client.execute("DELETE FROM accounts");
    await fixture.client.execute("DELETE FROM requisitions");
    await fixture.client.execute("DELETE FROM institutions");
    await fixture.client.execute("DELETE FROM categories");
    await fixture.client.execute("DELETE FROM users");
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns aggregates in whole units (euros, not cents)", async () => {
    const ctx = await buildAdvisorContext({ userId });
    expect(ctx.accounts.totalBalance).toBe(3_579);
    expect(ctx.accounts.count).toBe(1);
    expect(ctx.currency).toBe("EUR");

    const current = ctx.months[0]!;
    expect(current.income).toBe(2_500);
    expect(current.expense).toBe(-(120 + 80 + 45));
    expect(current.net).toBe(2_500 - (120 + 80 + 45));
    // Categories within the month also in whole units
    const g = current.categories.find((c) => c.slug === "groceries");
    expect(g?.spent).toBe(200); // 120 + 80
  });

  it("redacts PII in merchant names — IBAN never reaches the LLM payload", async () => {
    const ctx = await buildAdvisorContext({ userId, topMerchantLimit: 5 });
    const blob = JSON.stringify(ctx);
    // The literal IBAN must not appear anywhere in the serialized snapshot.
    expect(blob).not.toMatch(/ES7600491500051234567892/);
    // The merchant we synthesized SHOULD show up — but redacted.
    const mercadona = ctx.topMerchants.find((m) => m.name.startsWith("Mercadona"));
    expect(mercadona).toBeDefined();
    expect(mercadona?.name).toMatch(/\[IBAN\]/);
  });

  it("includes only categories with positive budgets and computes pctUsed", async () => {
    const ctx = await buildAdvisorContext({ userId });
    expect(ctx.budgets).toHaveLength(1);
    const groceries = ctx.budgets[0]!;
    expect(groceries.slug).toBe("groceries");
    expect(groceries.monthlyBudget).toBe(300);
    expect(groceries.spentThisMonth).toBe(200);
    expect(groceries.pctUsed).toBe(67); // 200/300 ≈ 0.6666 → 67
  });

  it("clamps monthsBack and topMerchantLimit to safe bounds", async () => {
    const tooMany = await buildAdvisorContext({ userId, monthsBack: 999, topMerchantLimit: 999 });
    expect(tooMany.months.length).toBeLessThanOrEqual(12);
    expect(tooMany.topMerchants.length).toBeLessThanOrEqual(25);

    const tooFew = await buildAdvisorContext({ userId, monthsBack: 0, topMerchantLimit: 0 });
    expect(tooFew.months.length).toBeGreaterThanOrEqual(1);
  });

  it("never leaks raw transaction-level rows", async () => {
    const ctx = await buildAdvisorContext({ userId });
    // The shape exposes only aggregated keys — nothing per-tx.
    expect(Object.keys(ctx)).toEqual(
      expect.arrayContaining(["accounts", "months", "topMerchants", "budgets"]),
    );
    // No per-transaction identifiers or raw IBAN patterns anywhere.
    const blob = JSON.stringify(ctx);
    expect(blob).not.toMatch(/gocardlessTransactionId/);
    // A raw IBAN-shaped string would be 2 letters + digits — must not survive redaction.
    expect(blob).not.toMatch(/\bES\d{20,}\b/);
  });
});
