import { createTestDb } from "@/test/db-fixture";
import { describe, expect, it, vi } from "vitest";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, institutions, requisitions, balanceHistory, users } = await import("@/db/schema");
const { snapshotBalances, getNetWorthSeries } = await import("./history");

const USER = 1;

async function seed() {
  // balance_history.user_id is a CREATE-TABLE foreign key (enforced), so a real
  // user row must exist.
  await fixture.db.insert(users).values({ encryptionSalt: "salt" });
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
  await fixture.db.insert(accounts).values([
    {
      userId: USER,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC-CASH",
      name: "Cash",
      kind: "cash",
      isManual: true,
      balanceCents: 50_000,
      currency: "EUR",
    },
    {
      userId: USER,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC-LOAN",
      name: "Car loan",
      kind: "loan",
      isManual: true,
      balanceCents: -800_000,
      currency: "EUR",
    },
  ]);
}

describe("snapshotBalances + getNetWorthSeries", () => {
  it("snapshots once per account per day (idempotent) and nets liabilities", async () => {
    await seed();

    const first = await snapshotBalances(USER);
    expect(first).toBe(2);

    // Same day → no new rows.
    const second = await snapshotBalances(USER);
    expect(second).toBe(0);

    const rows = await fixture.db.select().from(balanceHistory);
    expect(rows).toHaveLength(2);

    const series = await getNetWorthSeries(USER, { days: 30 });
    expect(series.points).toHaveLength(1);
    // 50_000 (cash) + (−800_000) (loan) = −750_000
    expect(series.points[0]?.netCents).toBe(-750_000);
  });
});
