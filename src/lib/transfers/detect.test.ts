import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, institutions, requisitions, transactions } = await import("@/db/schema");
const { matchTransfers, detectTransfers } = await import("./detect");

const NOW = new Date("2026-04-15T12:00:00.000Z");
const USER = 1;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("matchTransfers (pure)", () => {
  it("pairs an equal-magnitude outflow/inflow across accounts within the window", () => {
    const legs = [
      { id: 1, accountId: 10, bookingDate: daysAgo(2), amountCents: -50000, currency: "EUR" },
      { id: 2, accountId: 20, bookingDate: daysAgo(1), amountCents: 50000, currency: "EUR" },
    ];
    const pairs = matchTransfers(legs);
    expect(pairs).toEqual([{ outId: 1, inId: 2 }]);
  });

  it("does not pair legs on the same account", () => {
    const legs = [
      { id: 1, accountId: 10, bookingDate: daysAgo(1), amountCents: -50000, currency: "EUR" },
      { id: 2, accountId: 10, bookingDate: daysAgo(1), amountCents: 50000, currency: "EUR" },
    ];
    expect(matchTransfers(legs)).toEqual([]);
  });

  it("does not pair across different currencies", () => {
    const legs = [
      { id: 1, accountId: 10, bookingDate: daysAgo(1), amountCents: -50000, currency: "EUR" },
      { id: 2, accountId: 20, bookingDate: daysAgo(1), amountCents: 50000, currency: "USD" },
    ];
    expect(matchTransfers(legs)).toEqual([]);
  });

  it("does not pair when dates are outside the window", () => {
    const legs = [
      { id: 1, accountId: 10, bookingDate: daysAgo(10), amountCents: -50000, currency: "EUR" },
      { id: 2, accountId: 20, bookingDate: daysAgo(1), amountCents: 50000, currency: "EUR" },
    ];
    expect(matchTransfers(legs)).toEqual([]);
  });

  it("leaves a lone refund (no opposite leg) unmatched", () => {
    const legs = [
      { id: 1, accountId: 10, bookingDate: daysAgo(1), amountCents: 1999, currency: "EUR" },
    ];
    expect(matchTransfers(legs)).toEqual([]);
  });

  it("uses each inflow at most once, nearest date wins", () => {
    const legs = [
      { id: 1, accountId: 10, bookingDate: daysAgo(3), amountCents: -10000, currency: "EUR" },
      { id: 2, accountId: 10, bookingDate: daysAgo(1), amountCents: -10000, currency: "EUR" },
      { id: 3, accountId: 20, bookingDate: daysAgo(1), amountCents: 10000, currency: "EUR" },
    ];
    // Only one inflow exists; it should pair with the nearest outflow (id 2).
    expect(matchTransfers(legs)).toEqual([{ outId: 2, inId: 3 }]);
  });
});

async function seedTwoAccounts() {
  const inst = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "INST-1", name: "Bank", logoUrl: null, country: "ES" })
    .returning({ id: institutions.id });
  const req = await fixture.db
    .insert(requisitions)
    .values({
      userId: USER,
      institutionId: inst[0]!.id,
      gocardlessRequisitionId: "ENC",
      status: "linked",
      reference: "ref",
      link: null,
    })
    .returning({ id: requisitions.id });
  const checking = await fixture.db
    .insert(accounts)
    .values({
      userId: USER,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC-A",
      name: "Checking",
      balanceCents: 100_000,
      currency: "EUR",
    })
    .returning({ id: accounts.id });
  const savings = await fixture.db
    .insert(accounts)
    .values({
      userId: USER,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC-B",
      name: "Savings",
      balanceCents: 50_000,
      currency: "EUR",
    })
    .returning({ id: accounts.id });
  return { checkingId: checking[0]!.id, savingsId: savings[0]!.id };
}

let txSeq = 0;
async function addTx(accountId: number, amountCents: number, date: Date): Promise<number> {
  txSeq += 1;
  const r = await fixture.db
    .insert(transactions)
    .values({
      userId: USER,
      accountId,
      gocardlessTransactionId: `TX-${txSeq}`,
      bookingDate: date,
      amountCents,
      currency: "EUR",
      rawDescription: "tx",
    })
    .returning({ id: transactions.id });
  return r[0]!.id;
}

describe("detectTransfers (DB)", () => {
  it("tags both legs of a transfer and is idempotent + manual-preserving", async () => {
    const { checkingId, savingsId } = await seedTwoAccounts();
    const outId = await addTx(checkingId, -50000, daysAgo(2));
    const inId = await addTx(savingsId, 50000, daysAgo(1));
    // An unrelated real expense that must stay untouched.
    const groceriesId = await addTx(checkingId, -3000, daysAgo(1));

    const count = await detectTransfers({ userId: USER, now: NOW });
    expect(count).toBe(1);

    const after = await fixture.db.select().from(transactions);
    const byId = new Map(after.map((t) => [t.id, t]));
    const outGroup = byId.get(outId)!.transferGroupId;
    expect(outGroup).toBeTruthy();
    expect(byId.get(inId)!.transferGroupId).toBe(outGroup);
    expect(byId.get(groceriesId)!.transferGroupId).toBeNull();

    // Re-running keeps a single stable pairing (idempotent).
    const count2 = await detectTransfers({ userId: USER, now: NOW });
    expect(count2).toBe(1);
  });
});
