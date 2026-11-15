import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, institutions, requisitions, transactions } = await import("@/db/schema");
const { listTransactions } = await import("./list");
type Filters = import("./list").TransactionFilters;

const USER_A = 1;
const USER_B = 2;

/** Deterministic PRNG so a failure reproduces exactly. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function createAccount(userId: number, name: string): Promise<number> {
  const inst = await fixture.db
    .insert(institutions)
    .values({
      providerInstitutionId: `INST-${userId}-${name}`,
      name: `Bank ${name}`,
      country: "ES",
    })
    .returning({ id: institutions.id });
  const req = await fixture.db
    .insert(requisitions)
    .values({
      userId,
      institutionId: inst[0]!.id,
      providerRequisitionId: "ENC",
      status: "linked",
      reference: `ref-${userId}-${name}`,
    })
    .returning({ id: requisitions.id });
  const acc = await fixture.db
    .insert(accounts)
    .values({ userId, requisitionId: req[0]!.id, providerAccountId: "ENC", name })
    .returning({ id: accounts.id });
  return acc[0]!.id;
}

let accountA1 = 0;
let accountA2 = 0;

beforeAll(async () => {
  accountA1 = await createAccount(USER_A, "a1");
  accountA2 = await createAccount(USER_A, "a2");
  const accountB = await createAccount(USER_B, "b");

  // 230 rows for user A over only 6 distinct days → every page boundary falls
  // inside a run of identical booking dates, the case the old `<=` cursor broke.
  const rand = mulberry32(42);
  const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
  const rows = [];
  for (let i = 0; i < 230; i++) {
    rows.push({
      userId: USER_A,
      accountId: rand() < 0.5 ? accountA1 : accountA2,
      externalId: `a-${i}`,
      bookingDate: day(Math.floor(rand() * 6)),
      amountCents: -Math.floor(rand() * 10_000) - 1,
      currency: "EUR",
      merchantName: rand() < 0.3 ? "Mercadona" : `Shop ${i % 17}`,
      rawDescription: `Compra ${i}`,
      needsReview: rand() < 0.4,
    });
  }
  // User B shares the same dates; none of these may ever leak into A's pages.
  for (let i = 0; i < 40; i++) {
    rows.push({
      userId: USER_B,
      accountId: accountB,
      externalId: `b-${i}`,
      bookingDate: day(i % 6),
      amountCents: -100,
      currency: "EUR",
      merchantName: "Mercadona",
      rawDescription: `Compra B ${i}`,
      needsReview: true,
    });
  }
  await fixture.db.insert(transactions).values(rows);
});

/** Walk every page with a given page size, returning the ids in order. */
async function paginate(filters: Filters, pageSize: number): Promise<number[]> {
  const ids: number[] = [];
  let cursor: { bookingDate: number; id: number } | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await listTransactions({ userId: USER_A, ...filters, cursor, limit: pageSize });
    ids.push(...page.rows.map((r) => r.id));
    if (!page.nextCursor) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

async function everything(filters: Filters): Promise<number[]> {
  const all = await listTransactions({ userId: USER_A, ...filters, limit: 10_000 });
  expect(all.nextCursor).toBeNull();
  return all.rows.map((r) => r.id);
}

describe("listTransactions keyset pagination", () => {
  const filterSets: [string, () => Filters][] = [
    ["no filters", () => ({})],
    ["search query", () => ({ query: "mercadona" })],
    ["needs review", () => ({ needsReviewOnly: true })],
    ["one account", () => ({ accountId: accountA2 })],
    [
      "account + review + query",
      () => ({ accountId: accountA1, needsReviewOnly: true, query: "shop" }),
    ],
  ];

  for (const [label, makeFilters] of filterSets) {
    it(`concatenated pages equal the full ordered list (${label})`, async () => {
      const filters = makeFilters();
      const expected = await everything(filters);
      expect(expected.length).toBeGreaterThan(0);
      for (const pageSize of [1, 2, 3, 7, 10, 50, 229, 230, 231]) {
        const got = await paginate(filters, pageSize);
        expect(new Set(got).size).toBe(got.length); // no repeats
        expect(got).toEqual(expected); // no gaps, same order
      }
    });
  }

  it("orders by booking date then id, both descending", async () => {
    const all = await listTransactions({ userId: USER_A, limit: 10_000 });
    for (let i = 1; i < all.rows.length; i++) {
      const prev = all.rows[i - 1]!;
      const cur = all.rows[i]!;
      const prevKey = [prev.bookingDate.getTime(), prev.id];
      const curKey = [cur.bookingDate.getTime(), cur.id];
      expect(
        prevKey[0]! > curKey[0]! || (prevKey[0] === curKey[0] && prevKey[1]! > curKey[1]!),
      ).toBe(true);
    }
  });

  it("returns no cursor when the last page is exactly full", async () => {
    const total = (await everything({})).length;
    const page = await listTransactions({ userId: USER_A, limit: total });
    expect(page.rows).toHaveLength(total);
    expect(page.nextCursor).toBeNull();
  });

  it("never returns another user's rows", async () => {
    const ids = await paginate({}, 7);
    const ownerRows = await fixture.db
      .select({ id: transactions.id, userId: transactions.userId })
      .from(transactions);
    const owner = new Map(ownerRows.map((r) => [r.id, r.userId]));
    expect(ids.every((id) => owner.get(id) === USER_A)).toBe(true);
    expect(ids).toHaveLength(230);
  });
});
