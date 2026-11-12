import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { and, eq } = await import("drizzle-orm");
const { accountLinkChoices, accounts, institutions, requisitions, transactions, users } =
  await import("@/db/schema");
const { encrypt } = await import("@/lib/crypto");
const { accountNumberDigest, linkProviderAccounts, listLinkChoices, resolveLinkChoice } =
  await import("./link");
const { linkRequisitionAccounts, syncGoCardlessAccounts } = await import("@/lib/gocardless/sync");
type GoCardlessClient = import("@/lib/gocardless/client").GoCardlessClient;
type LinkedAccount = import("./link").LinkedAccount;

const KEY_A = Buffer.alloc(32, 1);
const KEY_B = Buffer.alloc(32, 2);
const DAY_MS = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

const U = { relink: 1, legacy: 2, fresh: 3, owner: 4, intruder: 5, stable: 6 } as const;
const IBAN = "ES91 2100 0418 4502 0005 1332";
const OTHER_IBAN = "ES79 2100 0813 6101 2345 6789";

let bank = 0;

beforeAll(async () => {
  await fixture.db
    .insert(users)
    .values(Object.values(U).map((id) => ({ id, encryptionSalt: `salt-${id}` })));
  const [inst] = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "BANK_A", name: "Bank A", country: "ES" })
    .returning({ id: institutions.id });
  if (!inst) throw new Error("no institution");
  bank = inst.id;
});

async function consent(userId: number, key: Buffer, status: "linked" | "expired" = "linked") {
  const [req] = await fixture.db
    .insert(requisitions)
    .values({
      userId,
      institutionId: bank,
      provider: "gocardless",
      gocardlessRequisitionId: encrypt(`req-${Math.random()}`, key),
      status,
      reference: `ref-${Math.random()}`,
    })
    .returning({ id: requisitions.id });
  if (!req) throw new Error("no requisition");
  return req.id;
}

/** An account as it was stored before `iban_hash` existed. */
async function legacyAccount(
  userId: number,
  key: Buffer,
  requisitionId: number,
  providerId: string,
) {
  const [acc] = await fixture.db
    .insert(accounts)
    .values({
      userId,
      requisitionId,
      gocardlessAccountId: encrypt(providerId, key),
      ibanLast4: "1332",
      name: "Cuenta Online",
    })
    .returning({ id: accounts.id });
  if (!acc) throw new Error("no account");
  return acc.id;
}

function described(providerAccountId: string, iban: string | null): LinkedAccount {
  return {
    providerAccountId,
    accountNumber: iban,
    ibanLast4: iban ? iban.replace(/\s/g, "").slice(-4) : null,
    name: "Cuenta Online",
    ownerName: null,
    balanceCents: 12_345,
    currency: "EUR",
  };
}

interface FakeTx {
  id: string;
  days: number;
  cents: number;
  text: string;
}

/** A GoCardless client for one consent: its accounts, their IBANs and their booked rows. */
function fakeGoCardless(opts: {
  accounts: string[];
  iban: Record<string, string | null>;
  booked?: Record<string, FakeTx[]>;
}) {
  const calls = { details: 0 };
  const client = {
    getRequisition: async (id: string) => ({ id, status: "LN", accounts: opts.accounts }),
    getAccountDetails: async (id: string) => {
      calls.details++;
      return {
        account: { iban: opts.iban[id] ?? undefined, name: "Cuenta Online", currency: "EUR" },
      };
    },
    getAccountBalances: async () => ({
      balances: [
        { balanceType: "closingBooked", balanceAmount: { amount: "123.45", currency: "EUR" } },
      ],
    }),
    getAccountTransactions: async (id: string) => ({
      transactions: {
        booked: (opts.booked?.[id] ?? []).map((t) => ({
          transactionId: t.id,
          bookingDate: day(t.days),
          transactionAmount: { amount: (t.cents / 100).toFixed(2), currency: "EUR" },
          creditorName: t.text,
        })),
        pending: [],
      },
    }),
  } as unknown as GoCardlessClient;
  return { client, calls };
}

const accountsOf = (userId: number) =>
  fixture.db.select().from(accounts).where(eq(accounts.userId, userId));
const rowsOf = (accountId: number) =>
  fixture.db.select().from(transactions).where(eq(transactions.accountId, accountId));
const requisitionExists = async (id: number) =>
  (await fixture.db.select().from(requisitions).where(eq(requisitions.id, id))).length === 1;

describe("re-link: a new consent for an account the user already has", () => {
  it("continues the account by IBAN and does not double the overlap, even with new ids", async () => {
    const userId = U.relink;
    const history: FakeTx[] = [
      { id: "old-1", days: 20, cents: -1_250, text: "Mercadona" },
      { id: "old-2", days: 12, cents: -3_000, text: "Renfe" },
      { id: "old-3", days: 6, cents: -450, text: "Cafe Central" },
      { id: "old-4", days: 3, cents: -200, text: "Coffee" },
      { id: "old-5", days: 3, cents: -200, text: "Coffee" },
    ];

    // First consent: link and sync the history.
    const req1 = await consent(userId, KEY_A);
    const first = fakeGoCardless({
      accounts: ["acc-old"],
      iban: { "acc-old": IBAN },
      booked: { "acc-old": history },
    });
    const linked1 = await linkRequisitionAccounts(first.client, {
      userId,
      requisitionRowId: req1,
      gocardlessRequisitionId: "gc-req-1",
      encryptionKey: KEY_A,
    });
    expect(linked1).toMatchObject({ created: 1, adopted: 0, pendingChoices: 0 });
    const accountId = linked1.accountIds[0] as number;
    expect(
      (await syncGoCardlessAccounts(first.client, { userId, encryptionKey: KEY_A })).inserted,
    ).toBe(5);

    // The consent expires; the user links the bank again. The bank hands out
    // a new account id (IBAN formatted differently) and new transaction ids.
    await fixture.db
      .update(requisitions)
      .set({ status: "expired" })
      .where(eq(requisitions.id, req1));
    const req2 = await consent(userId, KEY_A);
    const second = fakeGoCardless({
      accounts: ["acc-new"],
      iban: { "acc-new": IBAN.replace(/\s/g, "").toLowerCase() },
      booked: {
        "acc-new": [
          ...history.map((t) => ({ ...t, id: t.id.replace("old", "new") })),
          // Booked late, same day and amount as two stored coffees: a third coffee.
          { id: "new-6", days: 3, cents: -200, text: "Coffee" },
          { id: "new-7", days: 0, cents: -999, text: "Amazon" },
        ],
      },
    });
    const linked2 = await linkRequisitionAccounts(second.client, {
      userId,
      requisitionRowId: req2,
      gocardlessRequisitionId: "gc-req-2",
      encryptionKey: KEY_A,
    });
    expect(linked2).toMatchObject({
      created: 0,
      adopted: 1,
      pendingChoices: 0,
      accountIds: [accountId],
    });
    expect(await accountsOf(userId)).toHaveLength(1);
    expect(await requisitionExists(req1)).toBe(false);

    const synced = await syncGoCardlessAccounts(second.client, { userId, encryptionKey: KEY_A });
    expect(synced).toMatchObject({ inserted: 2, failed: 0 });
    const rows = await rowsOf(accountId);
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.amountCents === -200)).toHaveLength(3);

    // Replays change nothing: a second sync, and the callback page reloaded.
    expect(
      (await syncGoCardlessAccounts(second.client, { userId, encryptionKey: KEY_A })).inserted,
    ).toBe(0);
    const detailsBefore = second.calls.details;
    const again = await linkRequisitionAccounts(second.client, {
      userId,
      requisitionRowId: req2,
      gocardlessRequisitionId: "gc-req-2",
      encryptionKey: KEY_A,
    });
    expect(again).toMatchObject({ created: 0, adopted: 0, accountIds: [accountId] });
    expect(second.calls.details).toBe(detailsBefore);
    expect(await rowsOf(accountId)).toHaveLength(7);
  });

  it("continues the account when the provider account id is unchanged, IBAN or not", async () => {
    const userId = U.stable;
    const req1 = await consent(userId, KEY_A, "expired");
    const accountId = await legacyAccount(userId, KEY_A, req1, "acc-stable");
    const req2 = await consent(userId, KEY_A);
    const res = await linkProviderAccounts({
      userId,
      requisitionId: req2,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-stable"],
      describe: async (id) => described(id, null),
    });
    expect(res).toMatchObject({
      adopted: 1,
      created: 0,
      pendingChoices: 0,
      accountIds: [accountId],
    });
  });

  it("asks when nothing proves it is the same account, and applies the answer once", async () => {
    const userId = U.legacy;
    const req1 = await consent(userId, KEY_A, "expired");
    const oldId = await legacyAccount(userId, KEY_A, req1, "acc-legacy");
    const req2 = await consent(userId, KEY_A);

    const res = await linkProviderAccounts({
      userId,
      requisitionId: req2,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-renamed"],
      describe: async (id) => described(id, IBAN),
    });
    // Nothing linked or synced until the user answers.
    expect(res).toMatchObject({ accountIds: [], created: 0, adopted: 0, pendingChoices: 1 });
    expect(await accountsOf(userId)).toHaveLength(1);

    const [choice] = await listLinkChoices(userId, KEY_A);
    expect(choice?.candidates.map((c) => c.id)).toEqual([oldId]);
    expect(choice?.account).toMatchObject({ name: "Cuenta Online", ibanLast4: "1332" });

    const choiceId = choice?.id as number;
    expect(
      await resolveLinkChoice({ userId, encryptionKey: KEY_A, choiceId, targetAccountId: oldId }),
    ).toEqual({ ok: true, provider: "gocardless", applied: true });
    const [acc] = await accountsOf(userId);
    expect(acc).toMatchObject({ id: oldId, requisitionId: req2 });
    expect(acc?.ibanHash).toBe(accountNumberDigest(IBAN, KEY_A));
    expect(acc?.relinkedThrough).toBeInstanceOf(Date);
    expect(await requisitionExists(req1)).toBe(false);

    // A double submit finds nothing left to apply.
    expect(
      await resolveLinkChoice({ userId, encryptionKey: KEY_A, choiceId, targetAccountId: null }),
    ).toEqual({ ok: false, error: "notFound" });
    expect(await accountsOf(userId)).toHaveLength(1);
  });

  it("creates a new account when the numbers differ, or when the user says it is new", async () => {
    const userId = U.fresh;
    const req1 = await consent(userId, KEY_A);
    await linkProviderAccounts({
      userId,
      requisitionId: req1,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-1"],
      describe: async (id) => described(id, IBAN),
    });

    // A second account at the same bank, with a different IBAN: no question.
    const req2 = await consent(userId, KEY_A);
    const res = await linkProviderAccounts({
      userId,
      requisitionId: req2,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-2"],
      describe: async (id) => described(id, OTHER_IBAN),
    });
    expect(res).toMatchObject({ created: 1, adopted: 0, pendingChoices: 0 });

    // A third without an IBAN might be either: ask, and the user says "new".
    const req3 = await consent(userId, KEY_A);
    await linkProviderAccounts({
      userId,
      requisitionId: req3,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-3"],
      describe: async (id) => described(id, null),
    });
    const [choice] = await listLinkChoices(userId, KEY_A);
    expect(choice?.candidates).toHaveLength(2);
    const out = await resolveLinkChoice({
      userId,
      encryptionKey: KEY_A,
      choiceId: choice?.id as number,
      targetAccountId: null,
    });
    expect(out).toEqual({ ok: true, provider: "gocardless", applied: true });
    const all = await accountsOf(userId);
    expect(all).toHaveLength(3);
    expect(all.find((a) => a.requisitionId === req3)).toBeDefined();
    expect(await listLinkChoices(userId, KEY_A)).toEqual([]);
  });

  it("applies an answer once when it is submitted twice at the same time", async () => {
    const userId = U.fresh;
    const req = await consent(userId, KEY_A);
    await linkProviderAccounts({
      userId,
      requisitionId: req,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-double"],
      describe: async (id) => described(id, null),
    });
    const [choice] = await listLinkChoices(userId, KEY_A);
    const before = (await accountsOf(userId)).length;
    const answer = () =>
      resolveLinkChoice({
        userId,
        encryptionKey: KEY_A,
        choiceId: choice?.id as number,
        targetAccountId: null,
      });
    const results = await Promise.all([answer(), answer()]);
    expect(results.filter((r) => r.ok && r.applied)).toHaveLength(1);
    expect(await accountsOf(userId)).toHaveLength(before + 1);
  });

  it("never lets one user answer, or continue an account, of another", async () => {
    const reqA1 = await consent(U.owner, KEY_A, "expired");
    const ownerAccount = await legacyAccount(U.owner, KEY_A, reqA1, "acc-a");
    const reqA2 = await consent(U.owner, KEY_A);
    await linkProviderAccounts({
      userId: U.owner,
      requisitionId: reqA2,
      encryptionKey: KEY_A,
      providerAccountIds: ["acc-a2"],
      describe: async (id) => described(id, null),
    });
    const [ownerChoice] = await listLinkChoices(U.owner, KEY_A);

    // The intruder has a pending choice of their own at the same bank.
    const reqB1 = await consent(U.intruder, KEY_B, "expired");
    await legacyAccount(U.intruder, KEY_B, reqB1, "acc-b");
    const reqB2 = await consent(U.intruder, KEY_B);
    await linkProviderAccounts({
      userId: U.intruder,
      requisitionId: reqB2,
      encryptionKey: KEY_B,
      providerAccountIds: ["acc-b2"],
      describe: async (id) => described(id, null),
    });
    const [intruderChoice] = await listLinkChoices(U.intruder, KEY_B);
    expect(intruderChoice?.candidates.map((c) => c.id)).not.toContain(ownerAccount);

    expect(
      await resolveLinkChoice({
        userId: U.intruder,
        encryptionKey: KEY_B,
        choiceId: ownerChoice?.id as number,
        targetAccountId: null,
      }),
    ).toEqual({ ok: false, error: "notFound" });
    expect(
      await resolveLinkChoice({
        userId: U.intruder,
        encryptionKey: KEY_B,
        choiceId: intruderChoice?.id as number,
        targetAccountId: ownerAccount,
      }),
    ).toEqual({ ok: false, error: "notACandidate" });

    const [owned] = await fixture.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, ownerAccount), eq(accounts.userId, U.owner)));
    expect(owned?.requisitionId).toBe(reqA1);
    expect(
      await fixture.db
        .select()
        .from(accountLinkChoices)
        .where(eq(accountLinkChoices.userId, U.owner)),
    ).toHaveLength(1);
  });
});
