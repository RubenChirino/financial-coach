import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { transactions, users } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { parseCsv } = await import("./csv");
const { ensureImportedAccount, importParsedRows } = await import("./ingest");
type ParsedCsvRow = import("./csv").ParsedCsvRow;

const KEY = Buffer.alloc(32, 7);
const USER_A = 1;
const USER_B = 2;
const USER_C = 3;

const sample = parseCsv(
  readFileSync(path.resolve(__dirname, "../../../docs/sample-transactions.csv"), "utf8"),
);

async function importFor(userId: number, rows: ParsedCsvRow[], forceReimport = false) {
  const { accountRowId } = await ensureImportedAccount({ userId, encryptionKey: KEY });
  const res = await importParsedRows(rows, { userId, accountRowId, forceReimport });
  return { ...res, accountRowId };
}

async function countFor(userId: number): Promise<number> {
  const rows = await fixture.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return rows.length;
}

function row(i: number, overrides: Partial<ParsedCsvRow> = {}): ParsedCsvRow {
  return {
    lineNumber: i + 2,
    date: new Date(Date.UTC(2026, 0, 1 + (i % 300))),
    amountCents: -(100 + (i % 977)),
    currency: "EUR",
    merchant: `Shop ${i}`,
    description: `Card payment ${i}`,
    ...overrides,
  };
}

beforeAll(async () => {
  await fixture.db.insert(users).values([
    { id: USER_A, encryptionSalt: "a" },
    { id: USER_B, encryptionSalt: "b" },
    { id: USER_C, encryptionSalt: "c" },
  ]);
});

describe("CSV import identity", () => {
  it("parses the bundled sample file", () => {
    expect(sample.headerError).toBeNull();
    expect(sample.rows.length).toBeGreaterThan(20);
  });

  it("gives every user all rows of the same file, and reports no foreign duplicates", async () => {
    const a = await importFor(USER_A, sample.rows);
    const b = await importFor(USER_B, sample.rows);
    expect(a.inserted).toBe(sample.rows.length);
    expect(b.inserted).toBe(sample.rows.length);
    expect(b.duplicates).toBe(0);
    expect(await countFor(USER_A)).toBe(sample.rows.length);
    expect(await countFor(USER_B)).toBe(sample.rows.length);
  });

  it("re-uploading the same file inserts nothing", async () => {
    const again = await importFor(USER_A, sample.rows);
    expect(again.inserted).toBe(0);
    expect(again.existingDuplicates).toBe(sample.rows.length);
    expect(await countFor(USER_A)).toBe(sample.rows.length);
  });

  it("keeps identical rows within one file as separate transactions", async () => {
    const coffee = row(0, { merchant: "Café", description: "Café", amountCents: -200 });
    const first = await importFor(USER_C, [coffee, { ...coffee, lineNumber: 3 }, row(1)]);
    expect(first.inserted).toBe(3);
    expect(first.intraBatchDuplicates).toBe(0);

    // Re-upload: all three dedupe. A later export with a third coffee that
    // day adds exactly one row.
    expect((await importFor(USER_C, [coffee, coffee, row(1)])).inserted).toBe(0);
    expect((await importFor(USER_C, [coffee, coffee, coffee, row(1)])).inserted).toBe(1);
  });

  it("force-reimport inserts every row again", async () => {
    const before = await countFor(USER_B);
    const forced = await importFor(USER_B, sample.rows, true);
    expect(forced.inserted).toBe(sample.rows.length);
    expect(await countFor(USER_B)).toBe(before + sample.rows.length);
  });

  it("imports 5,000 rows in one go (above SQLite's bound-variable limit for one INSERT)", async () => {
    const big = Array.from({ length: 5_000 }, (_, i) => row(i));
    const userId = 4;
    await fixture.db.insert(users).values({ id: userId, encryptionSalt: "d" });
    const res = await importFor(userId, big);
    expect(res.inserted).toBe(5_000);
    expect(await countFor(userId)).toBe(5_000);
  }, 60_000);
});
