import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, categories, categoryRules, transactions, users } = await import("@/db/schema");
const { asc, eq } = await import("drizzle-orm");
const { ensureImportedAccount } = await import("@/lib/import/ingest");
const { recorrectCategories } = await import("./index");

const USER = 1;
const OTHER = 2;
const KEY = Buffer.alloc(32, 7);
const cat: Record<string, number> = {};

async function seedTx(
  userId: number,
  merchantName: string,
  categoryId: number | null,
  confidence: number | null,
) {
  const [acc] = await fixture.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const n = (await fixture.db.select({ id: transactions.id }).from(transactions)).length;
  await fixture.db.insert(transactions).values({
    userId,
    accountId: acc?.id ?? 0,
    gocardlessTransactionId: `tx-${n}`,
    bookingDate: new Date(Date.UTC(2026, 0, 1 + n)),
    amountCents: -1_234,
    currency: "EUR",
    merchantName,
    rawDescription: merchantName,
    categoryId,
    confidence,
  });
}

const state = async () =>
  (
    await fixture.db
      .select({
        categoryId: transactions.categoryId,
        confidence: transactions.confidence,
        needsReview: transactions.needsReview,
      })
      .from(transactions)
      .orderBy(asc(transactions.id))
  ).map((r) => [r.categoryId, r.confidence, r.needsReview]);

beforeEach(async () => {
  for (const t of ["transactions", "category_rules", "accounts", "categories", "users"]) {
    await fixture.client.execute(`DELETE FROM ${t}`);
  }
  await fixture.db.insert(users).values([
    { id: USER, encryptionSalt: "a" },
    { id: OTHER, encryptionSalt: "b" },
  ]);
  for (const slug of ["groceries", "subscriptions", "other", "bank_fees"]) {
    const [row] = await fixture.db
      .insert(categories)
      .values({ slug, nameEs: slug, nameEn: slug, icon: "x", color: "#000" })
      .returning({ id: categories.id });
    cat[slug] = row?.id ?? 0;
  }
  await fixture.db.insert(categoryRules).values({
    userId: USER,
    createdBy: "user",
    matchPattern: "acme",
    matchType: "contains",
    categoryId: cat.other ?? 0,
    priority: 10,
  });
  await ensureImportedAccount({ userId: USER, encryptionKey: KEY });
  await ensureImportedAccount({ userId: OTHER, encryptionKey: KEY });

  await seedTx(USER, "Mercadona", cat.other ?? null, null); // keyword → groceries
  await seedTx(USER, "Netflix", cat.other ?? null, 100); // manual pick: untouched
  await seedTx(USER, "ACME corp", null, null); // user rule → other
  await seedTx(USER, "Unknown shop", cat.bank_fees ?? null, 1); // stale rule match → requeue
  await seedTx(USER, "Mercadona", cat.groceries ?? null, 95); // already right
  await seedTx(OTHER, "Mercadona", cat.other ?? null, null); // another user: untouched
});

describe("recorrectCategories", () => {
  it("re-applies rules and keywords, requeues stale rule matches, and spares manual picks", async () => {
    expect(await recorrectCategories(USER)).toEqual({ corrected: 2, requeued: 1 });
    expect(await state()).toEqual([
      [cat.groceries, 95, false],
      [cat.other, 100, false],
      [cat.other, 1, false],
      [null, null, true],
      [cat.groceries, 95, false],
      [cat.other, null, false],
    ]);
    // Converged: a second run changes nothing.
    expect(await recorrectCategories(USER)).toEqual({ corrected: 0, requeued: 0 });
  });

  it("is all-or-nothing: a failing requeue rolls back the corrections too", async () => {
    const before = await state();
    await fixture.client.execute(
      "CREATE TRIGGER fail_requeue BEFORE UPDATE ON transactions WHEN NEW.category_id IS NULL BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(recorrectCategories(USER)).rejects.toThrow(/boom/);
    } finally {
      await fixture.client.execute("DROP TRIGGER fail_requeue");
    }
    expect(await state()).toEqual(before);
  });
});

describe("upsertUserRule", () => {
  it("keeps one rule per (user, pattern), re-pointed on a new correction", async () => {
    const { upsertUserRule } = await import("./rules");
    await upsertUserRule(USER, "lidl", cat.groceries ?? 0);
    await upsertUserRule(USER, "lidl", cat.other ?? 0);
    await upsertUserRule(OTHER, "lidl", cat.groceries ?? 0);
    const rules = await fixture.db
      .select({ userId: categoryRules.userId, categoryId: categoryRules.categoryId })
      .from(categoryRules)
      .where(eq(categoryRules.matchPattern, "lidl"))
      .orderBy(asc(categoryRules.userId));
    expect(rules).toEqual([
      { userId: USER, categoryId: cat.other },
      { userId: OTHER, categoryId: cat.groceries },
    ]);
  });
});
