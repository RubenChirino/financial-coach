import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, importBatches, transactions, users } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { ensureImportedAccount } = await import("./ingest");
const { deleteImportBatch, resetAllTransactions } = await import("./batches");

const KEY = Buffer.alloc(32, 7);
const USER_A = 1;
const USER_B = 2;

let accountA: number;
let accountB: number;

async function seedTx(
  userId: number,
  accountId: number,
  amountCents: number,
  batchId: number | null,
) {
  const n = (await fixture.db.select({ id: transactions.id }).from(transactions)).length;
  await fixture.db.insert(transactions).values({
    userId,
    accountId,
    gocardlessTransactionId: `tx-${n}`,
    bookingDate: new Date(Date.UTC(2026, 0, 1 + n)),
    amountCents,
    currency: "EUR",
    rawDescription: `row ${n}`,
    importBatchId: batchId,
  });
}

async function newBatch(userId: number): Promise<number> {
  const [b] = await fixture.db
    .insert(importBatches)
    .values({ userId })
    .returning({ id: importBatches.id });
  if (!b) throw new Error("no batch");
  return b.id;
}

const balanceOf = async (id: number) =>
  (
    await fixture.db.select({ b: accounts.balanceCents }).from(accounts).where(eq(accounts.id, id))
  )[0]?.b;
const txCount = async (userId: number) =>
  (
    await fixture.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, userId))
  ).length;

beforeEach(async () => {
  await fixture.client.execute("DELETE FROM transactions");
  await fixture.client.execute("DELETE FROM import_batches");
  await fixture.client.execute("DELETE FROM accounts");
  await fixture.client.execute("DELETE FROM users");
  await fixture.db.insert(users).values([
    { id: USER_A, encryptionSalt: "a" },
    { id: USER_B, encryptionSalt: "b" },
  ]);
  accountA = (await ensureImportedAccount({ userId: USER_A, encryptionKey: KEY })).accountRowId;
  accountB = (await ensureImportedAccount({ userId: USER_B, encryptionKey: KEY })).accountRowId;
});

describe("deleteImportBatch", () => {
  it("removes the batch's rows and record and recomputes the balance from what remains", async () => {
    const keep = await newBatch(USER_A);
    const undo = await newBatch(USER_A);
    await seedTx(USER_A, accountA, -1_000, keep);
    await seedTx(USER_A, accountA, 5_000, null); // pre-batch-tracking row
    await seedTx(USER_A, accountA, -300, undo);
    await seedTx(USER_A, accountA, -200, undo);

    expect(await deleteImportBatch(USER_A, undo)).toEqual({ deleted: 2 });
    expect(await balanceOf(accountA)).toBe(4_000);
    expect(await txCount(USER_A)).toBe(2);
    const batches = await fixture.db.select({ id: importBatches.id }).from(importBatches);
    expect(batches.map((b) => b.id)).toEqual([keep]);
  });

  it("is scoped to the caller: another user's batch id deletes nothing", async () => {
    const theirs = await newBatch(USER_B);
    await seedTx(USER_B, accountB, -700, theirs);
    await fixture.db.update(accounts).set({ balanceCents: -700 }).where(eq(accounts.id, accountB));

    expect(await deleteImportBatch(USER_A, theirs)).toEqual({ deleted: 0 });
    expect(await txCount(USER_B)).toBe(1);
    expect(await balanceOf(accountB)).toBe(-700);
    expect(await fixture.db.select().from(importBatches)).toHaveLength(1);
  });

  it("is all-or-nothing: a failing batch delete keeps the rows and the balance", async () => {
    const undo = await newBatch(USER_A);
    await seedTx(USER_A, accountA, -300, undo);
    await fixture.db.update(accounts).set({ balanceCents: -300 }).where(eq(accounts.id, accountA));
    await fixture.client.execute(
      "CREATE TRIGGER fail_batch BEFORE DELETE ON import_batches BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(deleteImportBatch(USER_A, undo)).rejects.toThrow(/boom/);
    } finally {
      await fixture.client.execute("DROP TRIGGER fail_batch");
    }
    expect(await txCount(USER_A)).toBe(1);
    expect(await balanceOf(accountA)).toBe(-300);
  });
});

describe("resetAllTransactions", () => {
  it("wipes only the caller's rows and batches and zeroes only their balances", async () => {
    const a = await newBatch(USER_A);
    const b = await newBatch(USER_B);
    await seedTx(USER_A, accountA, -100, a);
    await seedTx(USER_A, accountA, -100, null);
    await seedTx(USER_B, accountB, -900, b);
    await fixture.db.update(accounts).set({ balanceCents: -200 }).where(eq(accounts.id, accountA));
    await fixture.db.update(accounts).set({ balanceCents: -900 }).where(eq(accounts.id, accountB));

    expect(await resetAllTransactions(USER_A)).toEqual({ deleted: 2 });
    expect(await txCount(USER_A)).toBe(0);
    expect(await balanceOf(accountA)).toBe(0);
    expect(await txCount(USER_B)).toBe(1);
    expect(await balanceOf(accountB)).toBe(-900);
    const left = await fixture.db.select({ id: importBatches.id }).from(importBatches);
    expect(left.map((r) => r.id)).toEqual([b]);
  });
});
