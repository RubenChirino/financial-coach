import { createTestDb } from "@/test/db-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, institutions, requisitions, transactions } = await import("@/db/schema");
const { listTravels } = await import("./detect");

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 2, 1, 12); // 2026-03-01

let accountId = 0;
let txSeq = 0;

async function seedAccount() {
  const inst = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "INST", name: "Bank", logoUrl: null, country: "ES" })
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
      balanceCents: 100_000,
      currency: "EUR",
    })
    .returning({ id: accounts.id });
  accountId = acc[0]!.id;
}

async function tx(opts: {
  dayOffset: number;
  amountCents: number;
  currency: string;
  merchant?: string;
  isRecurring?: boolean;
}) {
  txSeq += 1;
  await fixture.db.insert(transactions).values({
    accountId,
    gocardlessTransactionId: `tx-${txSeq}`,
    bookingDate: new Date(BASE + opts.dayOffset * DAY),
    amountCents: opts.amountCents,
    currency: opts.currency,
    merchantName: opts.merchant ?? "Shop",
    rawDescription: opts.merchant ?? "Shop",
    isRecurring: opts.isRecurring ?? false,
    needsReview: false,
  });
}

describe("listTravels", () => {
  beforeEach(async () => {
    await fixture.client.execute("DELETE FROM transactions");
    await fixture.client.execute("DELETE FROM accounts");
    await fixture.client.execute("DELETE FROM requisitions");
    await fixture.client.execute("DELETE FROM institutions");
    txSeq = 0;
    await seedAccount();
  });

  it("detects a foreign-currency trip and ignores home-currency spending", async () => {
    // Home-currency spend (must be ignored).
    await tx({ dayOffset: 0, amountCents: -5000, currency: "EUR" });
    await tx({ dayOffset: 1, amountCents: -3000, currency: "EUR" });
    // GBP trip: 3 payments across 3 days.
    await tx({ dayOffset: 10, amountCents: -2000, currency: "GBP", merchant: "Pub London" });
    await tx({ dayOffset: 11, amountCents: -4000, currency: "GBP", merchant: "Tube" });
    await tx({ dayOffset: 12, amountCents: -1000, currency: "GBP", merchant: "Cafe" });

    const trips = await listTravels({ homeCurrency: "EUR" });
    expect(trips).toHaveLength(1);
    const t = trips[0]!;
    expect(t.currency).toBe("GBP");
    expect(t.country).toBe("United Kingdom");
    expect(t.txCount).toBe(3);
    expect(t.totalSpentCents).toBe(7000); // 2000 + 4000 + 1000
    expect(t.merchantNames).toEqual(["Pub London", "Tube", "Cafe"]);
    expect(t.tripKey.startsWith("GBP:")).toBe(true);
  });

  it("drops a one-off foreign charge that isn't a trip", async () => {
    await tx({ dayOffset: 5, amountCents: -9900, currency: "USD" }); // single lone charge
    const trips = await listTravels({ homeCurrency: "EUR" });
    expect(trips).toHaveLength(0);
  });

  it("keeps a 2-payment cluster only when it spans 2+ days", async () => {
    // Two USD payments on the SAME day → not a trip.
    await tx({ dayOffset: 3, amountCents: -1000, currency: "USD" });
    await tx({ dayOffset: 3, amountCents: -2000, currency: "USD" });
    expect(await listTravels({ homeCurrency: "EUR" })).toHaveLength(0);

    // Two JPY payments across two days → a trip.
    await tx({ dayOffset: 20, amountCents: -1000, currency: "JPY" });
    await tx({ dayOffset: 21, amountCents: -2000, currency: "JPY" });
    const trips = await listTravels({ homeCurrency: "EUR" });
    expect(trips.map((t) => t.currency)).toEqual(["JPY"]);
  });

  it("splits the same currency into separate trips across a long gap", async () => {
    // Trip 1
    await tx({ dayOffset: 0, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 1, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 2, amountCents: -1000, currency: "GBP" });
    // Trip 2 — well beyond the 14-day gap.
    await tx({ dayOffset: 40, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 41, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 42, amountCents: -1000, currency: "GBP" });

    const trips = await listTravels({ homeCurrency: "EUR" });
    expect(trips).toHaveLength(2);
    // Newest first.
    expect(trips[0]!.startDate.getTime()).toBeGreaterThan(trips[1]!.startDate.getTime());
    expect(new Set(trips.map((t) => t.tripKey)).size).toBe(2);
  });

  it("excludes recurring foreign charges (a foreign subscription is not travel)", async () => {
    await tx({ dayOffset: 0, amountCents: -1500, currency: "USD", isRecurring: true });
    await tx({ dayOffset: 30, amountCents: -1500, currency: "USD", isRecurring: true });
    await tx({ dayOffset: 60, amountCents: -1500, currency: "USD", isRecurring: true });
    expect(await listTravels({ homeCurrency: "EUR" })).toHaveLength(0);
  });

  it("groups different currencies into separate trips", async () => {
    await tx({ dayOffset: 0, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 1, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 2, amountCents: -1000, currency: "GBP" });
    await tx({ dayOffset: 0, amountCents: -1000, currency: "CHF" });
    await tx({ dayOffset: 1, amountCents: -1000, currency: "CHF" });
    await tx({ dayOffset: 2, amountCents: -1000, currency: "CHF" });

    const trips = await listTravels({ homeCurrency: "EUR" });
    expect(trips).toHaveLength(2);
    expect(new Set(trips.map((t) => t.currency))).toEqual(new Set(["GBP", "CHF"]));
  });
});
