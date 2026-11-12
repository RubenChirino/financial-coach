import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

/**
 * Two-user isolation: every server action that takes a row id must leave
 * another user's row untouched. User B calls each action with user A's ids;
 * A's data must be byte-for-byte unchanged afterwards. Positive controls at
 * the end prove the same calls DO act when A makes them, so a no-op harness
 * can't make this suite pass vacuously.
 */

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/i18n/locale", () => ({ getLocale: async () => "en" }));

let currentUserId = 0;
vi.mock("@/lib/auth/session", () => {
  class GuestReadOnlyError extends Error {}
  const getCurrentSession = async () =>
    currentUserId
      ? {
          userId: currentUserId,
          encryptionKey: Buffer.alloc(32, currentUserId),
          createdAt: 0,
          lastActivityAt: 0,
        }
      : null;
  return {
    getCurrentSession,
    isGuestSession: async () => false,
    assertWritable: async () => {},
    GuestReadOnlyError,
  };
});

const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const { setTransactionCategoryAction } = await import("@/lib/transactions/actions");
const { createRuleFromTransactionAction, deleteUserRuleAction } = await import(
  "@/lib/categorize/rules-actions"
);
const { unlinkTransferAction, confirmTransferAction } = await import("@/lib/transfers/actions");
const { deleteImportBatchAction } = await import("@/app/(app)/import/batch-actions");
const { deleteAccountAction } = await import("@/lib/accounts/actions");
const { updateManualAccountAction } = await import("@/lib/accounts/manual");
const { updateGoalAction, updateGoalProgressAction, deleteGoalAction } = await import(
  "@/lib/goals/actions"
);
const { deleteConversationAction } = await import("@/lib/advisor/actions");
const { dismissInsightAction } = await import("@/lib/insights/actions");
const { setSubscriptionActiveAction } = await import("@/lib/recurring/actions");
const { deleteBankConnectionAction } = await import("@/lib/gocardless/actions");

const USER_A = 1;
const USER_B = 2;

interface Ids {
  categoryId: number;
  requisitionId: number;
  accountId: number;
  manualAccountId: number;
  txId: number;
  batchId: number;
  goalId: number;
  ruleId: number;
  conversationId: number;
  insightKey: string;
  subscriptionId: number;
}
let a: Ids;

async function seedUserA(): Promise<Ids> {
  const d = fixture.db;
  const [cat] = await d
    .insert(schema.categories)
    .values({ slug: "groceries", nameEs: "Súper", nameEn: "Groceries", icon: "x", color: "#000" })
    .returning();
  const [other] = await d
    .insert(schema.categories)
    .values({ slug: "dining", nameEs: "Comer", nameEn: "Dining", icon: "x", color: "#111" })
    .returning();
  const [inst] = await d
    .insert(schema.institutions)
    .values({ gocardlessId: "DEMO_A", name: "Demo", country: "ES" })
    .returning();
  const [req] = await d
    .insert(schema.requisitions)
    .values({
      userId: USER_A,
      institutionId: inst!.id,
      provider: "demo",
      gocardlessRequisitionId: "enc",
      status: "linked",
      reference: "a",
    })
    .returning();
  const [acc] = await d
    .insert(schema.accounts)
    .values({ userId: USER_A, requisitionId: req!.id, gocardlessAccountId: "enc", name: "A" })
    .returning();
  const [manual] = await d
    .insert(schema.accounts)
    .values({
      userId: USER_A,
      requisitionId: req!.id,
      gocardlessAccountId: "enc",
      name: "Cash",
      kind: "cash",
      isManual: true,
      balanceCents: 5_000,
    })
    .returning();
  const [batch] = await d
    .insert(schema.importBatches)
    .values({ userId: USER_A, filename: "a.csv", rowsParsed: 2, rowsInserted: 2 })
    .returning();
  const legs = await d
    .insert(schema.transactions)
    .values([
      {
        userId: USER_A,
        accountId: acc!.id,
        importBatchId: batch!.id,
        gocardlessTransactionId: "a-1",
        bookingDate: new Date(Date.UTC(2026, 9, 1)),
        amountCents: -5_000,
        merchantName: "Mercadona Madrid",
        rawDescription: "Mercadona Madrid",
        categoryId: cat!.id,
        transferGroupId: "grp-a",
      },
      {
        userId: USER_A,
        accountId: acc!.id,
        importBatchId: batch!.id,
        gocardlessTransactionId: "a-2",
        bookingDate: new Date(Date.UTC(2026, 9, 1)),
        amountCents: 5_000,
        rawDescription: "Transfer in",
        transferGroupId: "grp-a",
      },
    ])
    .returning();
  const [goal] = await d
    .insert(schema.goals)
    .values({ userId: USER_A, title: "Trip", targetCents: 100_000, savedCents: 10_000 })
    .returning();
  const [rule] = await d
    .insert(schema.categoryRules)
    .values({
      userId: USER_A,
      createdBy: "user",
      matchPattern: "mercadona",
      matchType: "contains",
      categoryId: cat!.id,
      priority: 5,
    })
    .returning();
  const [conv] = await d
    .insert(schema.advisorConversations)
    .values({ userId: USER_A, title: "Plan" })
    .returning();
  await d
    .insert(schema.advisorMessages)
    .values({ conversationId: conv!.id, role: "user", content: "hello" });
  const [sub] = await d
    .insert(schema.recurringSubscriptions)
    .values({
      userId: USER_A,
      merchantName: "Netflix",
      averageAmountCents: 1_299,
      frequencyDays: 30,
      lastSeenAt: new Date(),
      isActive: true,
    })
    .returning();
  return {
    categoryId: other!.id,
    requisitionId: req!.id,
    accountId: acc!.id,
    manualAccountId: manual!.id,
    txId: legs[0]!.id,
    batchId: batch!.id,
    goalId: goal!.id,
    ruleId: rule!.id,
    conversationId: conv!.id,
    // A's goal: the key user B would try to dismiss.
    insightKey: `goal_near:${goal!.id}`,
    subscriptionId: sub!.id,
  };
}

/** Every row user A owns, across every user-scoped table. */
async function snapshotUserA() {
  const d = fixture.db;
  const byUser = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, USER_A);
  return JSON.stringify({
    transactions: await d.select().from(schema.transactions).where(byUser(schema.transactions)),
    accounts: await d.select().from(schema.accounts).where(byUser(schema.accounts)),
    requisitions: await d.select().from(schema.requisitions).where(byUser(schema.requisitions)),
    importBatches: await d.select().from(schema.importBatches).where(byUser(schema.importBatches)),
    goals: await d.select().from(schema.goals).where(byUser(schema.goals)),
    rules: await d.select().from(schema.categoryRules).where(byUser(schema.categoryRules)),
    conversations: await d
      .select()
      .from(schema.advisorConversations)
      .where(byUser(schema.advisorConversations)),
    messages: await d.select().from(schema.advisorMessages),
    // Every user's: B's attempt must not write a dismissal for anyone.
    dismissals: await d.select().from(schema.insightDismissals),
    subscriptions: await d
      .select()
      .from(schema.recurringSubscriptions)
      .where(byUser(schema.recurringSubscriptions)),
  });
}

/** Each entry: an action called with A's ids. Run as B → no effect on A. */
const attacks: [string, () => Promise<unknown>][] = [
  ["setTransactionCategoryAction", () => setTransactionCategoryAction(a.txId, a.categoryId)],
  ["setTransactionCategoryAction (clear)", () => setTransactionCategoryAction(a.txId, null)],
  ["createRuleFromTransactionAction", () => createRuleFromTransactionAction(a.txId, a.categoryId)],
  ["unlinkTransferAction", () => unlinkTransferAction(a.txId)],
  ["confirmTransferAction", () => confirmTransferAction(a.txId)],
  ["deleteImportBatchAction", () => deleteImportBatchAction(a.batchId)],
  ["deleteAccountAction", () => deleteAccountAction(a.accountId)],
  [
    "updateManualAccountAction",
    () =>
      updateManualAccountAction(a.manualAccountId, {
        name: "pwned",
        kind: "cash",
        balanceCents: 1,
        currency: "EUR",
      }),
  ],
  [
    "updateGoalAction",
    () =>
      updateGoalAction({
        id: a.goalId,
        title: "pwned",
        emoji: "x",
        targetCents: 1,
        savedCents: 1,
      }),
  ],
  ["updateGoalProgressAction", () => updateGoalProgressAction(a.goalId, 99_999)],
  ["deleteGoalAction", () => deleteGoalAction(a.goalId)],
  ["deleteUserRuleAction", () => deleteUserRuleAction(a.ruleId)],
  ["deleteConversationAction", () => deleteConversationAction(a.conversationId)],
  ["dismissInsightAction", () => dismissInsightAction(a.insightKey)],
  ["setSubscriptionActiveAction", () => setSubscriptionActiveAction(a.subscriptionId, false)],
  ["deleteBankConnectionAction", () => deleteBankConnectionAction(a.requisitionId)],
];

describe("cross-user isolation of id-taking server actions", () => {
  beforeEach(async () => {
    await fixture.client.executeMultiple(`
      DELETE FROM advisor_messages; DELETE FROM advisor_conversations; DELETE FROM insight_dismissals;
      DELETE FROM recurring_subscriptions; DELETE FROM category_rules; DELETE FROM goals;
      DELETE FROM transactions; DELETE FROM import_batches; DELETE FROM accounts;
      DELETE FROM requisitions; DELETE FROM institutions; DELETE FROM categories; DELETE FROM users;
    `);
    await fixture.db.insert(schema.users).values([
      { id: USER_A, encryptionSalt: "a" },
      { id: USER_B, encryptionSalt: "b" },
    ]);
    a = await seedUserA();
  });

  for (const [name, attack] of attacks) {
    it(`${name}: user B cannot change user A's data`, async () => {
      const before = await snapshotUserA();
      currentUserId = USER_B;
      await attack();
      expect(await snapshotUserA()).toBe(before);
    });
  }

  it("positive control: the same calls do act for the owner", async () => {
    currentUserId = USER_A;
    const before = await snapshotUserA();
    await setTransactionCategoryAction(a.txId, a.categoryId);
    await deleteGoalAction(a.goalId);
    await deleteConversationAction(a.conversationId);
    await setSubscriptionActiveAction(a.subscriptionId, false);
    const after = await snapshotUserA();
    expect(after).not.toBe(before);

    const tx = await fixture.db
      .select({ categoryId: schema.transactions.categoryId })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, a.txId));
    expect(tx[0]?.categoryId).toBe(a.categoryId);
    expect(await fixture.db.select().from(schema.goals)).toHaveLength(0);
    expect(await fixture.db.select().from(schema.advisorConversations)).toHaveLength(0);
  });
});
