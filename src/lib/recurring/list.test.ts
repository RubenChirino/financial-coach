import { createTestDb } from "@/test/db-fixture";
import { describe, expect, it, vi } from "vitest";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { recurringSubscriptions, users } = await import("@/db/schema");
const { getUpcomingRenewals } = await import("./list");

const USER = 1;
const DAY = 24 * 60 * 60 * 1000;

async function seedUser() {
  await fixture.db.insert(users).values({ encryptionSalt: "salt" });
}

async function addSub(opts: {
  merchant: string;
  amountCents: number;
  frequencyDays: number;
  lastSeenDaysAgo: number;
  isActive?: boolean;
}) {
  await fixture.db.insert(recurringSubscriptions).values({
    userId: USER,
    merchantName: opts.merchant,
    averageAmountCents: opts.amountCents,
    frequencyDays: opts.frequencyDays,
    lastSeenAt: new Date(Date.now() - opts.lastSeenDaysAgo * DAY),
    isActive: opts.isActive ?? true,
  });
}

describe("getUpcomingRenewals", () => {
  it("projects the next charge a frequency ahead of last seen", async () => {
    await seedUser();
    // Monthly, last seen 25 days ago → next charge in ~5 days.
    await addSub({
      merchant: "Netflix",
      amountCents: 1199,
      frequencyDays: 30,
      lastSeenDaysAgo: 25,
    });

    const renewals = await getUpcomingRenewals(USER, { withinDays: 35 });
    expect(renewals).toHaveLength(1);
    expect(renewals[0]?.merchantName).toBe("Netflix");
    expect(renewals[0]?.daysUntil).toBeGreaterThanOrEqual(4);
    expect(renewals[0]?.daysUntil).toBeLessThanOrEqual(6);
  });

  it("excludes inactive subscriptions and those outside the window", async () => {
    // Inactive monthly sub.
    await addSub({
      merchant: "OldGym",
      amountCents: 3000,
      frequencyDays: 30,
      lastSeenDaysAgo: 10,
      isActive: false,
    });
    // Active yearly sub last seen recently → next charge ~355 days out (outside 35d).
    await addSub({
      merchant: "Domain",
      amountCents: 1500,
      frequencyDays: 365,
      lastSeenDaysAgo: 10,
    });

    const renewals = await getUpcomingRenewals(USER, { withinDays: 35 });
    const names = renewals.map((r) => r.merchantName);
    expect(names).not.toContain("OldGym");
    expect(names).not.toContain("Domain");
  });
});
