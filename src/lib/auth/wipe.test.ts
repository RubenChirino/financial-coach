import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const {
  accounts,
  advisorConversations,
  advisorMessages,
  categories,
  categoryRules,
  transactions,
  users,
} = await import("@/db/schema");
const { ensureImportedAccount } = await import("@/lib/import/ingest");
const { wipeLocalInstallation } = await import("./wipe");

const USER = 1;
const KEPT = new Set(["categories", "category_rules", "city_countries", "__drizzle_migrations"]);

async function seed() {
  await fixture.db.insert(users).values({ id: USER, encryptionSalt: "a" });
  const [sys] = await fixture.db
    .insert(categories)
    .values({ slug: "groceries", nameEs: "x", nameEn: "x", icon: "x", color: "#000" })
    .returning({ id: categories.id });
  const [custom] = await fixture.db
    .insert(categories)
    .values({ slug: "mine", nameEs: "x", nameEn: "x", icon: "x", color: "#000", isSystem: false })
    .returning({ id: categories.id });
  const categoryId = sys?.id ?? 0;
  await fixture.db.insert(categoryRules).values([
    { matchPattern: "lidl", matchType: "contains", categoryId }, // built-in
    { userId: USER, createdBy: "user", matchPattern: "acme", matchType: "contains", categoryId },
    {
      userId: USER,
      createdBy: "user",
      matchPattern: "mine",
      matchType: "contains",
      categoryId: custom?.id ?? 0,
    },
  ]);
  const { accountRowId } = await ensureImportedAccount({
    userId: USER,
    encryptionKey: Buffer.alloc(32, 7),
  });
  await fixture.db.insert(transactions).values({
    userId: USER,
    accountId: accountRowId,
    externalId: "t1",
    bookingDate: new Date(),
    amountCents: -100,
    currency: "EUR",
    rawDescription: "x",
    categoryId,
  });
  const [conv] = await fixture.db
    .insert(advisorConversations)
    .values({ userId: USER })
    .returning({ id: advisorConversations.id });
  await fixture.db
    .insert(advisorMessages)
    .values({ conversationId: conv?.id ?? 0, role: "user", content: "hi" });
}

async function nonEmptyTables(): Promise<string[]> {
  const tables = await fixture.client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const out: string[] = [];
  for (const { name } of tables.rows) {
    const n = await fixture.client.execute(`SELECT count(*) AS n FROM "${String(name)}"`);
    if (Number(n.rows[0]?.n) > 0) out.push(String(name));
  }
  return out.sort();
}

describe("wipeLocalInstallation", () => {
  it("is all-or-nothing: a failing statement leaves every row in place", async () => {
    await seed();
    const before = await nonEmptyTables();
    await fixture.client.execute(
      "CREATE TRIGGER fail_wipe BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(wipeLocalInstallation(USER)).rejects.toThrow(/boom/);
    } finally {
      await fixture.client.execute("DROP TRIGGER fail_wipe");
    }
    expect(await nonEmptyTables()).toEqual(before);
    expect(before).toEqual(expect.arrayContaining(["accounts", "transactions", "users"]));
  });

  it("empties every user table and keeps the system taxonomy and built-in rules", async () => {
    await wipeLocalInstallation(USER);
    expect((await nonEmptyTables()).filter((t) => !KEPT.has(t))).toEqual([]);
    const cats = await fixture.db
      .select({ slug: categories.slug, isSystem: categories.isSystem })
      .from(categories);
    expect(cats.map((c) => c.slug)).toContain("groceries");
    expect(cats.map((c) => c.slug)).not.toContain("mine");
    expect(cats.every((c) => c.isSystem)).toBe(true);
    const rules = await fixture.db
      .select({ pattern: categoryRules.matchPattern, userId: categoryRules.userId })
      .from(categoryRules);
    expect(rules.map((r) => r.pattern)).toContain("lidl");
    expect(rules.every((r) => r.userId === null)).toBe(true);
    expect(await fixture.db.select().from(accounts)).toEqual([]);
  });
});
