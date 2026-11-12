import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { eq } = await import("drizzle-orm");
const { accounts, insightDismissals, insights, institutions, requisitions, transactions, users } =
  await import("@/db/schema");
const { computeInsights, dismissInsights, listActiveInsights, monthKey } = await import("./engine");

const USER = 1;
const OTHER = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MARCH_20 = new Date("2026-03-20T12:00:00Z");

let accountId = 0;
let tx = 0;

async function income(userId: number, date: Date, cents = 250_000) {
  await fixture.db.insert(transactions).values({
    userId,
    accountId,
    gocardlessTransactionId: `tx-${tx++}`,
    bookingDate: date,
    amountCents: cents,
    currency: "EUR",
    merchantName: "Payroll",
    rawDescription: "Payroll",
    needsReview: false,
  });
}

beforeAll(async () => {
  await fixture.db.insert(users).values([
    { id: USER, encryptionSalt: "s1" },
    { id: OTHER, encryptionSalt: "s2" },
  ]);
  const [inst] = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "BANK", name: "Bank", country: "ES" })
    .returning({ id: institutions.id });
  const [req] = await fixture.db
    .insert(requisitions)
    .values({
      userId: USER,
      institutionId: inst!.id,
      gocardlessRequisitionId: "enc",
      status: "linked",
      reference: "ref",
    })
    .returning({ id: requisitions.id });
  const [acc] = await fixture.db
    .insert(accounts)
    .values({
      userId: USER,
      requisitionId: req!.id,
      gocardlessAccountId: "enc",
      name: "Everyday",
      balanceCents: 4_200, // under €100: a low-balance insight
    })
    .returning({ id: accounts.id });
  accountId = acc!.id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("insights", () => {
  it("are computed on read, in the user's language, and written nowhere", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MARCH_20);
    await income(USER, new Date("2026-03-15T00:00:00Z"));

    const en = await listActiveInsights(USER, "en");
    expect(en.map((i) => i.key)).toEqual([`low_balance:${accountId}`, "on_track:2026-03"]);
    expect(en[0]).toMatchObject({
      kind: "low_balance",
      severity: "warning",
      title: "Low balance in Everyday",
      actionHref: "/banks",
    });
    expect(en[0]?.body).toContain("€42");
    const es = await computeInsights(USER, "es");
    expect(es.find((i) => i.kind === "on_track")?.title).toBe("¡Vas bien este mes!");

    expect(await fixture.db.select().from(insights)).toEqual([]);
    expect(await fixture.db.select().from(insightDismissals)).toEqual([]);
  });

  it("stay dismissed across recomputes, and come back when the key changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MARCH_20);
    const low = `low_balance:${accountId}`;

    expect(await dismissInsights(USER, [low, "on_track:2026-03"], "en")).toEqual([
      low,
      "on_track:2026-03",
    ]);
    expect(await listActiveInsights(USER, "en")).toEqual([]);
    // Recomputing (every page render does) does not bring them back.
    expect(await listActiveInsights(USER, "en")).toEqual([]);

    // Twelve days later it is April: a new month is a new on-track insight.
    vi.setSystemTime(new Date(MARCH_20.getTime() + 12 * DAY_MS));
    expect(monthKey(new Date())).toBe("2026-04");
    await income(USER, new Date("2026-04-01T00:00:00Z"));
    expect((await listActiveInsights(USER, "en")).map((i) => i.key)).toEqual(["on_track:2026-04"]);

    // After 30 days the low-balance dismissal lapses; the next dismissal prunes it.
    vi.setSystemTime(new Date(MARCH_20.getTime() + 31 * DAY_MS));
    expect((await listActiveInsights(USER, "en")).map((i) => i.key)).toContain(low);
    await dismissInsights(USER, ["on_track:2026-04"], "en");
    const kept = await fixture.db
      .select({ key: insightDismissals.insightKey })
      .from(insightDismissals)
      .where(eq(insightDismissals.userId, USER));
    expect(kept.map((k) => k.key)).toEqual(["on_track:2026-04"]);
  });

  it("accept only keys the user's own rules produce now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MARCH_20);
    const before = await fixture.db.select().from(insightDismissals);
    // Another user's account, a made-up key, a key that does not apply now.
    expect(
      await dismissInsights(
        OTHER,
        [`low_balance:${accountId}`, "anything", "on_track:2026-03"],
        "en",
      ),
    ).toEqual([]);
    expect(await fixture.db.select().from(insightDismissals)).toEqual(before);
  });
});

describe("recurring_increase", () => {
  it("flags a subscription whose latest charge rose, from one query over all of them", async () => {
    const { recurringSubscriptions } = await import("@/db/schema");
    const charge = async (merchantName: string, date: Date, cents: number) =>
      fixture.db.insert(transactions).values({
        userId: USER,
        accountId,
        gocardlessTransactionId: `tx-${tx++}`,
        bookingDate: date,
        amountCents: -cents,
        currency: "EUR",
        merchantName,
        rawDescription: merchantName,
        needsReview: false,
      });
    const sub = (merchantName: string, averageAmountCents: number) => ({
      userId: USER,
      merchantName,
      seriesKey: `out:${merchantName.toLowerCase()}`,
      averageAmountCents,
      frequencyDays: 30,
      lastSeenAt: MARCH_20,
    });
    const [hiked] = await fixture.db
      .insert(recurringSubscriptions)
      .values([sub("Streamly", 1_000), sub("Gymbox", 3_000)])
      .returning({ id: recurringSubscriptions.id });
    // Streamly: older charges at the average, the latest one 30 % higher.
    await charge("Streamly", new Date(MARCH_20.getTime() - 60 * DAY_MS), 1_000);
    await charge("Streamly", new Date(MARCH_20.getTime() - 2 * DAY_MS), 1_300);
    // Gymbox: an older high charge, but the latest is at the average.
    await charge("Gymbox", new Date(MARCH_20.getTime() - 40 * DAY_MS), 4_500);
    await charge("Gymbox", new Date(MARCH_20.getTime() - 5 * DAY_MS), 3_000);

    const keys = (await computeInsights(USER, "en", MARCH_20))
      .map((i) => i.key)
      .filter((k) => k.startsWith("recurring_increase:"));
    expect(keys).toEqual([`recurring_increase:${hiked?.id}:1300`]);
  });
});
