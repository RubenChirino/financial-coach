import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: async () => ({ userId: 1, isGuest: false, encryptionKey: Buffer.alloc(32) }),
}));

const { accounts, categories, institutions, recurringSubscriptions, requisitions, transactions } =
  await import("@/db/schema");
const { detectRecurringSubscriptions, evaluateMerchant } = await import("./detect");
const { setSubscriptionActiveAction } = await import("./actions");
const { eq } = await import("drizzle-orm");

const NOW = new Date("2026-04-15T12:00:00.000Z");
const USER = 1;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

async function seedSkeleton() {
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
  const acc = await fixture.db
    .insert(accounts)
    .values({
      userId: USER,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC",
      ibanLast4: "1234",
      name: "Checking",
      ownerName: null,
      balanceCents: 100_000,
      currency: "EUR",
    })
    .returning({ id: accounts.id });
  const cat = await fixture.db
    .insert(categories)
    .values({
      slug: "subscriptions",
      nameEs: "Suscripciones",
      nameEn: "Subscriptions",
      icon: "📺",
      color: "#8b5cf6",
      sortOrder: 1,
    })
    .returning({ id: categories.id });
  return { accountId: acc[0]!.id, subscriptionsCategoryId: cat[0]!.id };
}

describe("evaluateMerchant (pure)", () => {
  it("detects a clean monthly subscription", () => {
    const txs = [
      { date: daysAgo(90), amountCents: -1199, categoryId: 1 },
      { date: daysAgo(60), amountCents: -1199, categoryId: 1 },
      { date: daysAgo(30), amountCents: -1199, categoryId: 1 },
      { date: daysAgo(1), amountCents: -1199, categoryId: 1 },
    ];
    const r = evaluateMerchant("Netflix", txs, NOW);
    expect(r).not.toBeNull();
    expect(r?.frequencyDays).toBe(30);
    expect(r?.averageAmountCents).toBe(1199);
    expect(r?.isActive).toBe(true);
  });

  it("rejects a series with too few occurrences", () => {
    const txs = [
      { date: daysAgo(60), amountCents: -1000, categoryId: null },
      { date: daysAgo(30), amountCents: -1000, categoryId: null },
    ];
    expect(evaluateMerchant("X", txs, NOW)).toBeNull();
  });

  it("rejects when amounts vary too much", () => {
    const txs = [
      { date: daysAgo(90), amountCents: -1000, categoryId: null },
      { date: daysAgo(60), amountCents: -3000, categoryId: null },
      { date: daysAgo(30), amountCents: -1500, categoryId: null },
      { date: daysAgo(1), amountCents: -8000, categoryId: null },
    ];
    expect(evaluateMerchant("Mercadona", txs, NOW)).toBeNull();
  });

  it("rejects when cadence does not match a known interval", () => {
    // Random gaps: 5, 19, 11 days — median 11, doesn't snap to weekly (7) or biweekly (14).
    const txs = [
      { date: daysAgo(35), amountCents: -1000, categoryId: null },
      { date: daysAgo(30), amountCents: -1000, categoryId: null },
      { date: daysAgo(11), amountCents: -1000, categoryId: null },
      { date: daysAgo(0), amountCents: -1000, categoryId: null },
    ];
    expect(evaluateMerchant("Random", txs, NOW)).toBeNull();
  });

  it("marks isActive=false when the last hit is older than 1.5 cycles", () => {
    // 3 monthly hits, last one ~60 days ago — 60 > 1.5 * 30.
    const txs = [
      { date: daysAgo(120), amountCents: -999, categoryId: null },
      { date: daysAgo(90), amountCents: -999, categoryId: null },
      { date: daysAgo(60), amountCents: -999, categoryId: null },
    ];
    const r = evaluateMerchant("OldGym", txs, NOW);
    expect(r).not.toBeNull();
    expect(r?.isActive).toBe(false);
  });

  it("snaps gaps with mild jitter to the nearest cadence", () => {
    // Real bank dates aren't perfectly periodic. ±2 day jitter on monthly should still match.
    const txs = [
      { date: daysAgo(91), amountCents: -2599, categoryId: null },
      { date: daysAgo(58), amountCents: -2599, categoryId: null },
      { date: daysAgo(29), amountCents: -2599, categoryId: null },
      { date: daysAgo(2), amountCents: -2599, categoryId: null },
    ];
    const r = evaluateMerchant("Spotify", txs, NOW);
    expect(r?.frequencyDays).toBe(30);
  });

  it("picks the modal categoryId across the series", () => {
    const txs = [
      { date: daysAgo(90), amountCents: -1199, categoryId: 7 },
      { date: daysAgo(60), amountCents: -1199, categoryId: 7 },
      { date: daysAgo(30), amountCents: -1199, categoryId: 9 },
      { date: daysAgo(1), amountCents: -1199, categoryId: 7 },
    ];
    expect(evaluateMerchant("X", txs, NOW)?.categoryId).toBe(7);
  });
});

describe("detectRecurringSubscriptions (DB)", () => {
  beforeEach(async () => {
    await fixture.client.execute("DELETE FROM recurring_subscriptions");
    await fixture.client.execute("DELETE FROM transactions");
    await fixture.client.execute("DELETE FROM accounts");
    await fixture.client.execute("DELETE FROM requisitions");
    await fixture.client.execute("DELETE FROM institutions");
    await fixture.client.execute("DELETE FROM categories");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists detected subscriptions and ignores noise", async () => {
    const { accountId, subscriptionsCategoryId } = await seedSkeleton();
    let txCounter = 0;
    const newTx = (date: Date, amount: number, merchant: string, categoryId: number | null) => ({
      userId: USER,
      accountId,
      gocardlessTransactionId: `tx-${txCounter++}`,
      bookingDate: date,
      amountCents: amount,
      currency: "EUR",
      merchantName: merchant,
      rawDescription: merchant,
      categoryId,
      needsReview: false,
    });

    await fixture.db.insert(transactions).values([
      // Netflix monthly — should be detected.
      newTx(daysAgo(90), -1199, "Netflix", subscriptionsCategoryId),
      newTx(daysAgo(60), -1199, "Netflix", subscriptionsCategoryId),
      newTx(daysAgo(30), -1199, "Netflix", subscriptionsCategoryId),
      newTx(daysAgo(2), -1199, "Netflix", subscriptionsCategoryId),
      // Random groceries — varied amounts, irregular dates → not a sub.
      newTx(daysAgo(50), -3527, "Mercadona", null),
      newTx(daysAgo(40), -2210, "Mercadona", null),
      newTx(daysAgo(33), -1898, "Mercadona", null),
      newTx(daysAgo(15), -4302, "Mercadona", null),
      // One-off purchase — single occurrence, definitely not a sub.
      newTx(daysAgo(20), -50_000, "Amazon", null),
    ]);

    const out = await detectRecurringSubscriptions({ userId: USER, now: NOW });
    expect(out.map((s) => s.merchantName)).toEqual(["Netflix"]);

    const rows = await fixture.db.select().from(recurringSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.merchantName).toBe("Netflix");
    expect(rows[0]?.frequencyDays).toBe(30);
    expect(rows[0]?.isActive).toBe(true);
    expect(rows[0]?.categoryId).toBe(subscriptionsCategoryId);
  });

  it("is idempotent — running twice yields the same row count", async () => {
    const { accountId } = await seedSkeleton();
    let txCounter = 0;
    const newTx = (date: Date, amount: number, merchant: string) => ({
      userId: USER,
      accountId,
      gocardlessTransactionId: `tx-${txCounter++}`,
      bookingDate: date,
      amountCents: amount,
      currency: "EUR",
      merchantName: merchant,
      rawDescription: merchant,
      categoryId: null,
      needsReview: false,
    });

    await fixture.db
      .insert(transactions)
      .values([
        newTx(daysAgo(90), -999, "Spotify"),
        newTx(daysAgo(60), -999, "Spotify"),
        newTx(daysAgo(30), -999, "Spotify"),
        newTx(daysAgo(1), -999, "Spotify"),
      ]);

    await detectRecurringSubscriptions({ userId: USER, now: NOW });
    await detectRecurringSubscriptions({ userId: USER, now: NOW });
    const rows = await fixture.db.select().from(recurringSubscriptions);
    expect(rows).toHaveLength(1);
  });

  it("groups merchants by normalised name (ignores S.L., long digit suffixes)", async () => {
    const { accountId } = await seedSkeleton();
    let txCounter = 0;
    const newTx = (date: Date, merchant: string) => ({
      userId: USER,
      accountId,
      gocardlessTransactionId: `tx-${txCounter++}`,
      bookingDate: date,
      amountCents: -1500,
      currency: "EUR",
      merchantName: merchant,
      rawDescription: merchant,
      categoryId: null,
      needsReview: false,
    });

    // Same merchant written 4 different ways across months — should still
    // collapse to a single subscription.
    await fixture.db
      .insert(transactions)
      .values([
        newTx(daysAgo(90), "GymPlus S.L. 20251201"),
        newTx(daysAgo(60), "GymPlus SL 20260102"),
        newTx(daysAgo(30), "GymPlus  20260203"),
        newTx(daysAgo(1), "GymPlus 20260404"),
      ]);
    const out = await detectRecurringSubscriptions({ userId: USER, now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]?.merchantName.toLowerCase()).toContain("gymplus");
  });

  describe("identity across runs", () => {
    let accountId = 0;
    let n = 0;
    const charge = (date: Date, merchant: string, amount = -1_199) => ({
      userId: USER,
      accountId,
      gocardlessTransactionId: `id-${n++}`,
      bookingDate: date,
      amountCents: amount,
      currency: "EUR",
      merchantName: merchant,
      rawDescription: merchant,
      categoryId: null,
      needsReview: false,
    });
    const monthly = (merchant: string, amount?: number) =>
      [90, 60, 30, 2].map((d) => charge(daysAgo(d), merchant, amount));
    const subs = () => fixture.db.select().from(recurringSubscriptions);

    beforeEach(async () => {
      ({ accountId } = await seedSkeleton());
    });

    it("keeps the row's id and the user's pause when the series is found again", async () => {
      await fixture.db.insert(transactions).values(monthly("Netflix"));
      await detectRecurringSubscriptions({ userId: USER, now: NOW });
      const [first] = await subs();
      expect(first).toMatchObject({ seriesKey: "-netflix", isActive: true, userStatus: null });

      await setSubscriptionActiveAction(first!.id, false);
      // A new charge arrives and detection runs again (every ingest does).
      await fixture.db.insert(transactions).values(charge(daysAgo(0), "Netflix", -1_299));
      await detectRecurringSubscriptions({ userId: USER, now: NOW });

      const rows = await subs();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: first!.id,
        isActive: false,
        userStatus: "inactive",
        averageAmountCents: 1_219,
      });
      expect(rows[0]!.lastSeenAt.getTime()).toBe(daysAgo(0).getTime());
    });

    it("drops a series that is no longer found, unless the user set its status", async () => {
      await fixture.db
        .insert(transactions)
        .values([...monthly("Netflix"), ...monthly("Spotify", -999)]);
      await detectRecurringSubscriptions({ userId: USER, now: NOW });
      const spotify = (await subs()).find((r) => r.seriesKey === "-spotify");
      await setSubscriptionActiveAction(spotify!.id, true);

      await fixture.client.execute("DELETE FROM transactions");
      await detectRecurringSubscriptions({ userId: USER, now: NOW });
      expect((await subs()).map((r) => r.seriesKey)).toEqual(["-spotify"]);
    });

    it("gives rows from before series keys their key, keeping their id", async () => {
      const [legacy] = await fixture.db
        .insert(recurringSubscriptions)
        .values({
          userId: USER,
          merchantName: "Netflix",
          averageAmountCents: 1_199,
          frequencyDays: 30,
          lastSeenAt: daysAgo(30),
          isActive: true,
        })
        .returning();
      // A stale legacy row whose series is gone, and an income series.
      await fixture.db.insert(recurringSubscriptions).values({
        userId: USER,
        merchantName: "Old Gym",
        averageAmountCents: 3_000,
        frequencyDays: 30,
        lastSeenAt: daysAgo(200),
        isActive: false,
      });
      await fixture.db
        .insert(transactions)
        .values([...monthly("Netflix"), ...monthly("Acme Payroll", 250_000)]);

      await detectRecurringSubscriptions({ userId: USER, now: NOW });
      const rows = await subs();
      expect(rows.map((r) => [r.seriesKey, r.averageAmountCents]).sort()).toEqual([
        ["+acme payroll", -250_000],
        ["-netflix", 1_199],
      ]);
      expect(rows.find((r) => r.seriesKey === "-netflix")?.id).toBe(legacy!.id);
      expect(
        await fixture.db
          .select()
          .from(recurringSubscriptions)
          .where(eq(recurringSubscriptions.merchantName, "Old Gym")),
      ).toEqual([]);
    });
  });
});
