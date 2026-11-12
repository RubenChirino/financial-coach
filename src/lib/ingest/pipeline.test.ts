import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

// Manual entry reads the session and revalidates Next paths.
const sessionState = vi.hoisted(() => ({
  current: null as null | { userId: number; isGuest: boolean; encryptionKey: Buffer },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => sessionState.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { and, eq, gte, isNull } = await import("drizzle-orm");
const {
  accounts,
  balanceHistory,
  categories,
  categoryRules,
  importBatches,
  institutions,
  recurringSubscriptions,
  requisitions,
  transactions,
  users,
} = await import("@/db/schema");
const { encrypt } = await import("@/lib/crypto");
const { AccountNotOwned, SYNC_MAX_DAYS, ingestTransactions, syncWindowStart } = await import(
  "./pipeline"
);
const { upsertInstitution } = await import("./institutions");
const { ensureImportedAccount, importParsedRows } = await import("@/lib/import/ingest");
const { importBatchState, listImportBatches } = await import("@/lib/import/batches");
const { syncGoCardlessAccounts } = await import("@/lib/gocardless/sync");
const { syncTrueLayerAccounts } = await import("@/lib/truelayer/sync");
const { seedDemoBank } = await import("@/lib/providers/demo/seed");
const { addManualTransactionAction } = await import("@/app/(app)/import/manual-transaction-action");
type IngestRow = import("./pipeline").IngestRow;
type GoCardlessClient = import("@/lib/gocardless/client").GoCardlessClient;
type TrueLayerClient = import("@/lib/truelayer/client").TrueLayerClient;

const KEY = Buffer.alloc(32, 7);
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

let cat: { subscriptions: number; groceries: number; other: number };

// One user per scenario keeps derived data (recurring, snapshots) separate.
const U = {
  replay: 1,
  crash: 2,
  concurrent: 3,
  owner: 4,
  intruder: 5,
  rules: 6,
  csv: 10,
  gocardless: 11,
  truelayer: 12,
  demo: 13,
  manual: 14,
} as const;

beforeAll(async () => {
  await fixture.db
    .insert(users)
    .values(Object.values(U).map((id) => ({ id, encryptionSalt: `salt-${id}` })));
  const inserted = await fixture.db
    .insert(categories)
    .values(
      (["subscriptions", "groceries", "other"] as const).map((slug, i) => ({
        slug,
        nameEs: slug,
        nameEn: slug,
        icon: "•",
        color: "#000000",
        sortOrder: i,
      })),
    )
    .returning({ id: categories.id, slug: categories.slug });
  const id = (slug: string) => inserted.find((c) => c.slug === slug)?.id ?? 0;
  cat = { subscriptions: id("subscriptions"), groceries: id("groceries"), other: id("other") };
});

async function importedAccount(userId: number, iban?: string): Promise<number> {
  const { accountRowId } = await ensureImportedAccount({ userId, encryptionKey: KEY, iban });
  return accountRowId;
}

async function accountRows(accountId: number) {
  return fixture.db.select().from(transactions).where(eq(transactions.accountId, accountId));
}

function row(i: number, overrides: Partial<IngestRow> = {}): IngestRow {
  return {
    externalId: `ext-${i}`,
    bookingDate: daysAgo(i % 80),
    amountCents: -(100 + i),
    currency: "EUR",
    merchantName: `Shop ${i}`,
    rawDescription: `Payment ${i}`,
    ...overrides,
  };
}

describe("syncWindowStart", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("fetches the full window on the first sync", () => {
    expect(syncWindowStart(null, now)).toEqual(new Date(now.getTime() - SYNC_MAX_DAYS * DAY_MS));
  });

  it("re-fetches ten days before the last successful sync", () => {
    const last = new Date(now.getTime() - 2 * DAY_MS);
    expect(syncWindowStart(last, now)).toEqual(new Date(last.getTime() - 10 * DAY_MS));
  });

  it("never reaches further back than the full window", () => {
    const last = new Date(now.getTime() - 200 * DAY_MS);
    expect(syncWindowStart(last, now)).toEqual(new Date(now.getTime() - SYNC_MAX_DAYS * DAY_MS));
  });
});

describe("ingestTransactions", () => {
  it("is idempotent: replaying the same input inserts nothing", async () => {
    const accountId = await importedAccount(U.replay);
    // Two identical content-derived rows are two transactions (ordinals).
    const twin = row(1, { externalId: "hash-twin", externalIdDerived: true });
    const input = [row(0), twin, { ...twin }, row(2)];

    const first = await ingestTransactions({
      userId: U.replay,
      source: "csv",
      accounts: [{ accountId, rows: input }],
    });
    expect(first.inserted).toBe(4);

    const again = await ingestTransactions({
      userId: U.replay,
      source: "csv",
      accounts: [{ accountId, rows: input }],
    });
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(4);
    expect(await accountRows(accountId)).toHaveLength(4);
  });

  it("recovers from a crash after k chunks: replay inserts exactly the missing rows", async () => {
    const accountId = await importedAccount(U.crash);
    // 1,200 rows = chunks of 500, 500, 200. Row 700 aborts the second chunk.
    const rows = Array.from({ length: 1200 }, (_, i) =>
      row(i, {
        merchantName: i % 2 === 0 ? "Mercadona" : `Shop ${i}`,
        rawDescription: i === 700 ? "BOOM" : `Payment ${i}`,
      }),
    );
    const [batch1] = await fixture.db
      .insert(importBatches)
      .values({ userId: U.crash, rowsParsed: rows.length, status: "running" })
      .returning({ id: importBatches.id });
    if (!batch1) throw new Error("no batch");

    await fixture.client.execute(
      "CREATE TRIGGER boom BEFORE INSERT ON transactions WHEN NEW.raw_description = 'BOOM' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    await expect(
      ingestTransactions({
        userId: U.crash,
        source: "csv",
        importBatchId: batch1.id,
        accounts: [{ accountId, rows, balance: { mode: "sum" } }],
      }),
    ).rejects.toThrow();

    // The first chunk is whole and already categorized.
    const afterCrash = await accountRows(accountId);
    expect(afterCrash).toHaveLength(500);
    for (const t of afterCrash) {
      if (t.merchantName === "Mercadona") {
        expect(t.categoryId).toBe(cat.groceries);
        expect(t.needsReview).toBe(false);
      } else {
        expect(t.categoryId).toBeNull();
        expect(t.needsReview).toBe(true);
      }
    }
    // Nothing marked the run as done.
    const [acc] = await fixture.db
      .select({ lastSyncedAt: accounts.lastSyncedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(acc?.lastSyncedAt).toBeNull();
    const history = await listImportBatches(U.crash);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: batch1.id, state: "running", rowsInserted: 500 });
    const createdAt = history[0]?.createdAt ?? new Date();
    expect(
      importBatchState("running", createdAt, new Date(createdAt.getTime() + 16 * 60_000)),
    ).toBe("interrupted");

    // Replay the same input (as a re-import does, under a new batch).
    await fixture.client.execute("DROP TRIGGER boom");
    const [batch2] = await fixture.db
      .insert(importBatches)
      .values({ userId: U.crash, rowsParsed: rows.length, status: "running" })
      .returning({ id: importBatches.id });
    if (!batch2) throw new Error("no batch");
    const replay = await ingestTransactions({
      userId: U.crash,
      source: "csv",
      importBatchId: batch2.id,
      accounts: [{ accountId, rows, balance: { mode: "sum" } }],
    });
    expect(replay.inserted).toBe(700);
    expect(replay.duplicates).toBe(500);

    const all = await accountRows(accountId);
    expect(all).toHaveLength(1200);
    expect(new Set(all.map((t) => t.gocardlessTransactionId)).size).toBe(1200);
    const [done] = await fixture.db
      .select({ balance: accounts.balanceCents, lastSyncedAt: accounts.lastSyncedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(done?.lastSyncedAt).not.toBeNull();
    expect(done?.balance).toBe(rows.reduce((s, r) => s + r.amountCents, 0));
    const after = await listImportBatches(U.crash);
    expect(after.find((b) => b.id === batch2.id)).toMatchObject({
      state: "complete",
      rowsInserted: 700,
    });
  });

  it("cannot duplicate under concurrent runs of the same input", async () => {
    const accountId = await importedAccount(U.concurrent);
    const rows = Array.from({ length: 50 }, (_, i) => row(i));
    const run = () =>
      ingestTransactions({ userId: U.concurrent, source: "csv", accounts: [{ accountId, rows }] });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.inserted + b.inserted).toBe(50);
    expect(a.inserted + a.duplicates).toBe(50);
    expect(b.inserted + b.duplicates).toBe(50);
    expect(await accountRows(accountId)).toHaveLength(50);
  });

  it("refuses an account the user does not own, and inserts nothing", async () => {
    const accountId = await importedAccount(U.owner);
    await expect(
      ingestTransactions({
        userId: U.intruder,
        source: "csv",
        accounts: [{ accountId, rows: [row(0)] }],
      }),
    ).rejects.toBeInstanceOf(AccountNotOwned);
    expect(await accountRows(accountId)).toHaveLength(0);
  });

  it("applies the user's rules before keywords", async () => {
    await fixture.db.insert(categoryRules).values({
      userId: U.rules,
      createdBy: "user",
      matchPattern: "netflix",
      matchType: "contains",
      categoryId: cat.other,
      priority: 10,
    });
    const accountId = await importedAccount(U.rules);
    const res = await ingestTransactions({
      userId: U.rules,
      source: "csv",
      accounts: [
        {
          accountId,
          rows: [
            row(0, { merchantName: "Netflix", rawDescription: "Netflix" }),
            row(1, { merchantName: "Mercadona", rawDescription: "Mercadona" }),
          ],
        },
      ],
    });
    expect(res).toMatchObject({ inserted: 2, ruleMatched: 1, keywordMatched: 1 });
    const stored = await accountRows(accountId);
    expect(stored.find((t) => t.merchantName === "Netflix")?.categoryId).toBe(cat.other);
    expect(stored.find((t) => t.merchantName === "Mercadona")?.categoryId).toBe(cat.groceries);
  });
});

describe("upsertInstitution", () => {
  it("converges on one row under concurrent get-or-create", async () => {
    const spec = { gocardlessId: "RACE_BANK", name: "Race", logoUrl: null, country: "ES" };
    const ids = await Promise.all(Array.from({ length: 5 }, () => upsertInstitution(spec)));
    expect(new Set(ids).size).toBe(1);
    const rows = await fixture.db
      .select()
      .from(institutions)
      .where(eq(institutions.gocardlessId, "RACE_BANK"));
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Parity: the same logical transactions, through every source, leave the same
// post-ingest state. Netflix ×4 monthly (keyword → subscriptions, recurring),
// Mercadona (keyword → groceries), an unknown merchant (needs review).
// ---------------------------------------------------------------------------

interface Logical {
  id: string;
  days: number;
  cents: number;
  merchant: string;
}
const LOGICAL: Logical[] = [
  { id: "nf1", days: 2, cents: -1199, merchant: "Netflix" },
  { id: "nf2", days: 32, cents: -1199, merchant: "Netflix" },
  { id: "nf3", days: 62, cents: -1199, merchant: "Netflix" },
  { id: "nf4", days: 92, cents: -1199, merchant: "Netflix" },
  { id: "mc1", days: 5, cents: -4510, merchant: "Mercadona" },
  { id: "zz1", days: 7, cents: -2000, merchant: "Zzyzx Ltd" },
];
const isoDay = (days: number) => daysAgo(days).toISOString().slice(0, 10);

async function bankAccount(
  userId: number,
  provider: "gocardless" | "truelayer",
  requisitionSecret: string,
  providerAccountId: string,
): Promise<number> {
  const institutionId = await upsertInstitution({
    gocardlessId: `${provider}_PARITY`,
    name: provider,
    logoUrl: null,
    country: "ES",
  });
  const [req] = await fixture.db
    .insert(requisitions)
    .values({
      userId,
      institutionId,
      provider,
      gocardlessRequisitionId: encrypt(requisitionSecret, KEY),
      status: "linked",
      reference: `${provider}-parity`,
    })
    .returning({ id: requisitions.id });
  if (!req) throw new Error("no requisition");
  const [acc] = await fixture.db
    .insert(accounts)
    .values({
      userId,
      requisitionId: req.id,
      gocardlessAccountId: encrypt(providerAccountId, KEY),
      name: `${provider} account`,
      balanceCents: 0,
      currency: "EUR",
    })
    .returning({ id: accounts.id });
  if (!acc) throw new Error("no account");
  return acc.id;
}

const sources: Record<"csv" | "gocardless" | "truelayer" | "manual", () => Promise<number>> = {
  async csv() {
    const accountId = await importedAccount(U.csv, "ES9121000418450200051332");
    await importParsedRows(
      LOGICAL.map((l, i) => ({
        lineNumber: i + 2,
        date: daysAgo(l.days),
        amountCents: l.cents,
        currency: "EUR",
        merchant: l.merchant,
        description: `${l.merchant} card payment ${l.id}`,
      })),
      { userId: U.csv, accountRowId: accountId },
    );
    return accountId;
  },

  async gocardless() {
    const accountId = await bankAccount(U.gocardless, "gocardless", "req-gc", "gc-acc-1");
    const client = {
      getAccountTransactions: async (id: string) => {
        expect(id).toBe("gc-acc-1");
        return {
          transactions: {
            booked: LOGICAL.map((l) => ({
              transactionId: `gc-${l.id}`,
              bookingDate: isoDay(l.days),
              transactionAmount: { amount: (l.cents / 100).toFixed(2), currency: "EUR" },
              creditorName: l.merchant,
              remittanceInformationUnstructured: `Card payment ${l.id}`,
            })),
            pending: [],
          },
        };
      },
    } as unknown as GoCardlessClient;
    const res = await syncGoCardlessAccounts(client, { userId: U.gocardless, encryptionKey: KEY });
    expect(res).toMatchObject({ inserted: LOGICAL.length, failed: 0 });
    return accountId;
  },

  async truelayer() {
    const tokens = JSON.stringify({
      accessToken: "tl-access",
      refreshToken: "tl-refresh",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const accountId = await bankAccount(U.truelayer, "truelayer", tokens, "tl-acc-1");
    const client = {
      getTransactions: async (accessToken: string, id: string) => {
        expect(accessToken).toBe("tl-access");
        expect(id).toBe("tl-acc-1");
        return LOGICAL.map((l) => ({
          transaction_id: `tl-${l.id}`,
          timestamp: daysAgo(l.days).toISOString(),
          description: `Card payment ${l.id}`,
          amount: l.cents / 100,
          currency: "EUR",
          transaction_type: "DEBIT",
          merchant_name: l.merchant,
        }));
      },
    } as unknown as TrueLayerClient;
    const res = await syncTrueLayerAccounts(client, { userId: U.truelayer, encryptionKey: KEY });
    expect(res).toMatchObject({ inserted: LOGICAL.length, failed: 0 });
    return accountId;
  },

  async manual() {
    sessionState.current = { userId: U.manual, isGuest: false, encryptionKey: KEY };
    try {
      for (const l of LOGICAL) {
        const res = await addManualTransactionAction({
          date: isoDay(l.days),
          amountCents: l.cents,
          currency: "eur",
          merchant: l.merchant,
          description: `Card payment ${l.id}`,
          categoryId: null,
        });
        expect(res.ok).toBe(true);
      }
    } finally {
      sessionState.current = null;
    }
    return importedAccount(U.manual);
  },
};

const userOf = { csv: U.csv, gocardless: U.gocardless, truelayer: U.truelayer, manual: U.manual };

async function postIngestState(userId: number, accountId: number) {
  const rows = await accountRows(accountId);
  const [acc] = await fixture.db
    .select({ lastSyncedAt: accounts.lastSyncedAt })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  const snapshots = await fixture.db
    .select({ id: balanceHistory.id })
    .from(balanceHistory)
    .where(
      and(
        eq(balanceHistory.accountId, accountId),
        gte(balanceHistory.capturedAt, new Date(new Date().setUTCHours(0, 0, 0, 0))),
      ),
    );
  const recurring = await fixture.db
    .select({ merchant: recurringSubscriptions.merchantName })
    .from(recurringSubscriptions)
    .where(eq(recurringSubscriptions.userId, userId));
  return { rows, lastSyncedAt: acc?.lastSyncedAt ?? null, snapshots, recurring };
}

describe("source parity", () => {
  it.each(Object.keys(sources) as (keyof typeof sources)[])(
    "%s lands in the same post-ingest state",
    async (source) => {
      const accountId = await sources[source]();
      const state = await postIngestState(userOf[source], accountId);

      expect(state.rows).toHaveLength(LOGICAL.length);
      const byMerchant = (m: string) => state.rows.filter((t) => t.merchantName === m);
      for (const t of byMerchant("Netflix")) {
        expect(t).toMatchObject({
          categoryId: cat.subscriptions,
          confidence: 95,
          needsReview: false,
        });
      }
      expect(byMerchant("Mercadona")[0]).toMatchObject({
        categoryId: cat.groceries,
        needsReview: false,
      });
      expect(byMerchant("Zzyzx Ltd")[0]).toMatchObject({ categoryId: null, needsReview: true });

      expect(state.recurring.map((r) => r.merchant.toLowerCase())).toContain("netflix");
      expect(state.snapshots).toHaveLength(1);
      expect(state.lastSyncedAt).not.toBeNull();
    },
  );

  it("demo seeding goes through the same steps", async () => {
    const { accountRowId, inserted } = await seedDemoBank(U.demo, "santander", KEY);
    expect(inserted).toBeGreaterThan(0);
    const state = await postIngestState(U.demo, accountRowId);
    expect(state.rows).toHaveLength(inserted);
    // Every row is either categorized or flagged for review.
    const uncategorizedSilently = await fixture.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountRowId),
          isNull(transactions.categoryId),
          eq(transactions.needsReview, false),
        ),
      );
    expect(uncategorizedSilently).toHaveLength(0);
    expect(state.recurring.length).toBeGreaterThan(0);
    expect(state.snapshots).toHaveLength(1);
    expect(state.lastSyncedAt).not.toBeNull();
  });
});
