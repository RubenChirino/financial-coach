import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/db/client";
import { accountLinkChoices, accounts, institutions, requisitions } from "@/db/schema";
import { blindIndex, decrypt, encrypt } from "@/lib/crypto";

/**
 * Linking a consent's accounts, with re-link continuity.
 *
 * Bank consents expire and the user links the same bank again. Neither
 * GoCardless nor TrueLayer promises that an account keeps its id across
 * consents (TrueLayer documents that ids can change on re-authentication),
 * so a new consent must not blindly create a second account row: the same
 * history would then count twice.
 *
 * For each provider account of a new consent, in this order:
 *  1. already linked, or already waiting for the user, under this consent →
 *     nothing to do (the callback page can be reloaded);
 *  2. same provider account id as one of the user's accounts at the same
 *     bank and provider → adopt that account;
 *  3. same account-number digest (`iban_hash`) as exactly one of them, and no
 *     other account of this consent has that digest → adopt it;
 *  4. otherwise, if one of them might be this account (a digest unknown on
 *     either side, or equal but ambiguous) → ask the user: an
 *     `account_link_choices` row, nothing linked or synced until they answer;
 *  5. otherwise → a new account.
 *
 * Adopting keeps the account row — its id, transactions, budgets and
 * `last_synced_at` — and points it at the new consent, in one batch that also
 * removes the superseded consent once it has no accounts left. It sets
 * `relinked_through`, so the next syncs match the overlap by content (see
 * `ingestTransactions`): transaction ids may change with the consent too.
 */

export type LinkProvider = "gocardless" | "truelayer";

/** A provider account as a consent returns it. */
export interface LinkedAccount {
  providerAccountId: string;
  /** IBAN, or sort code + account number; null when the provider gives none. */
  accountNumber: string | null;
  ibanLast4: string | null;
  name: string;
  ownerName: string | null;
  balanceCents: number;
  currency: string;
}

const ACCOUNT_NUMBER_PURPOSE = "account-number";

/** IBAN / account number without spaces or dashes, upper-cased; null when empty. */
export function normalizeAccountNumber(raw: string | null | undefined): string | null {
  const value = raw?.replace(/[\s-]/g, "").toUpperCase();
  return value ? value : null;
}

/** The `iban_hash` of an account number for this user; null without a number. */
export function accountNumberDigest(raw: string | null, dataKey: Buffer): string | null {
  const value = normalizeAccountNumber(raw);
  return value ? blindIndex(value, dataKey, ACCOUNT_NUMBER_PURPOSE) : null;
}

interface Consent {
  id: number;
  provider: string;
  institutionId: number;
}

async function loadConsent(userId: number, requisitionId: number): Promise<Consent | null> {
  const [row] = await db
    .select({
      id: requisitions.id,
      provider: requisitions.provider,
      institutionId: requisitions.institutionId,
    })
    .from(requisitions)
    .where(and(eq(requisitions.userId, userId), eq(requisitions.id, requisitionId)))
    .limit(1);
  return row ?? null;
}

function tryDecrypt(cipher: string, key: Buffer): string | null {
  try {
    return decrypt(cipher, key);
  } catch {
    return null;
  }
}

function parseLinkedAccount(json: string): LinkedAccount {
  const v = JSON.parse(json) as Partial<LinkedAccount>;
  if (typeof v.providerAccountId !== "string" || typeof v.name !== "string") {
    throw new Error("malformed account link choice");
  }
  return {
    providerAccountId: v.providerAccountId,
    accountNumber: v.accountNumber ?? null,
    ibanLast4: v.ibanLast4 ?? null,
    name: v.name,
    ownerName: v.ownerName ?? null,
    balanceCents: v.balanceCents ?? 0,
    currency: v.currency ?? "EUR",
  };
}

export interface Candidate {
  id: number;
  requisitionId: number;
  name: string;
  ibanLast4: string | null;
  ibanHash: string | null;
  lastSyncedAt: Date | null;
  /** Decrypted provider account id; null if it no longer decrypts. */
  providerAccountId: string | null;
}

/** The user's accounts at the consent's bank and provider, outside this consent. */
async function candidateAccounts(
  userId: number,
  consent: Consent,
  encryptionKey: Buffer,
): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: accounts.id,
      requisitionId: accounts.requisitionId,
      name: accounts.name,
      ibanLast4: accounts.ibanLast4,
      ibanHash: accounts.ibanHash,
      lastSyncedAt: accounts.lastSyncedAt,
      cipher: accounts.providerAccountId,
    })
    .from(accounts)
    .innerJoin(requisitions, eq(accounts.requisitionId, requisitions.id))
    .where(
      and(
        eq(accounts.userId, userId),
        eq(requisitions.userId, userId),
        eq(requisitions.provider, consent.provider as LinkProvider),
        eq(requisitions.institutionId, consent.institutionId),
        ne(accounts.requisitionId, consent.id),
      ),
    );
  return rows.map(({ cipher, ...r }) => ({
    ...r,
    providerAccountId: tryDecrypt(cipher, encryptionKey),
  }));
}

/** Point `target` at the new consent. Guarded so it applies once, to the user's own row. */
function adoptStatement(opts: {
  userId: number;
  requisitionId: number;
  encryptionKey: Buffer;
  account: LinkedAccount;
  digest: string | null;
  target: Candidate;
  guard?: ReturnType<typeof sql>;
}): BatchItem<"sqlite"> {
  const { account, target } = opts;
  return db
    .update(accounts)
    .set({
      requisitionId: opts.requisitionId,
      providerAccountId: encrypt(account.providerAccountId, opts.encryptionKey),
      ibanHash: opts.digest ?? target.ibanHash,
      ibanLast4: account.ibanLast4 ?? target.ibanLast4,
      ownerName: account.ownerName,
      balanceCents: account.balanceCents,
      currency: account.currency,
      relinkedThrough: new Date(),
    })
    .where(
      and(
        eq(accounts.userId, opts.userId),
        eq(accounts.id, target.id),
        ...(opts.guard ? [opts.guard] : []),
      ),
    );
}

/** Remove consents of this user that adoption left with no accounts and no pending choices. */
function dropEmptyConsents(
  userId: number,
  requisitionIds: Iterable<number>,
): BatchItem<"sqlite">[] {
  return [...new Set(requisitionIds)].map((id) =>
    db.run(sql`delete from "requisitions"
      where "requisitions"."id" = ${id} and "requisitions"."user_id" = ${userId}
        and not exists (select 1 from "accounts" where "accounts"."requisition_id" = ${id})
        and not exists (select 1 from "account_link_choices" where "account_link_choices"."requisition_id" = ${id})`),
  );
}

function insertAccountValues(opts: {
  userId: number;
  requisitionId: number;
  encryptionKey: Buffer;
  account: LinkedAccount;
  digest: string | null;
}): typeof accounts.$inferInsert {
  const { account } = opts;
  return {
    userId: opts.userId,
    requisitionId: opts.requisitionId,
    providerAccountId: encrypt(account.providerAccountId, opts.encryptionKey),
    ibanHash: opts.digest,
    ibanLast4: account.ibanLast4,
    name: account.name,
    ownerName: account.ownerName,
    balanceCents: account.balanceCents,
    currency: account.currency,
  };
}

export interface LinkInput {
  userId: number;
  /** The new consent: linked, with its institution resolved. */
  requisitionId: number;
  encryptionKey: Buffer;
  providerAccountIds: readonly string[];
  /** Details of one account; called only for accounts this consent has not seen yet. */
  describe: (providerAccountId: string) => Promise<LinkedAccount>;
}

export interface LinkResult {
  /** Accounts now linked under this consent (new, adopted or already there). */
  accountIds: number[];
  created: number;
  adopted: number;
  /** Accounts waiting for the user to say whether they are an existing one. */
  pendingChoices: number;
}

interface Incoming {
  account: LinkedAccount;
  digest: string | null;
}

export interface LinkPlan {
  adoptions: (Incoming & { target: Candidate })[];
  choices: Incoming[];
  creates: Incoming[];
}

/**
 * Steps 2–5 of the module comment, as a pure function of the consent's new
 * accounts and the user's other accounts at the same bank and provider.
 */
export function planLink(
  incoming: readonly Incoming[],
  candidates: readonly Candidate[],
): LinkPlan {
  const pool = new Map(candidates.map((c) => [c.id, c]));
  const plan: LinkPlan = { adoptions: [], choices: [], creates: [] };
  const adopt = (x: Incoming, target: Candidate) => {
    plan.adoptions.push({ ...x, target });
    pool.delete(target.id);
  };

  // Step 2: the same provider account id.
  const byNumber: Incoming[] = [];
  for (const x of incoming) {
    const target = [...pool.values()].find(
      (c) => c.providerAccountId === x.account.providerAccountId,
    );
    if (target) adopt(x, target);
    else byNumber.push(x);
  }

  // Step 3: the same account number, unambiguous on both sides.
  const digestCount = new Map<string, number>();
  for (const x of byNumber) {
    if (x.digest) digestCount.set(x.digest, (digestCount.get(x.digest) ?? 0) + 1);
  }
  const rest: Incoming[] = [];
  for (const x of byNumber) {
    const matches = x.digest ? [...pool.values()].filter((c) => c.ibanHash === x.digest) : [];
    const [target] = matches;
    const unique = x.digest != null && digestCount.get(x.digest) === 1 && matches.length === 1;
    if (unique && target) adopt(x, target);
    else rest.push(x);
  }

  // Steps 4 and 5: ask when an account at this bank might be this one —
  // anything but two known, different numbers.
  for (const x of rest) {
    const possible = [...pool.values()].some(
      (c) => !(x.digest && c.ibanHash && c.ibanHash !== x.digest),
    );
    (possible ? plan.choices : plan.creates).push(x);
  }
  return plan;
}

/** Provider account ids already linked, or waiting for the user, under this consent. */
async function seenUnderConsent(
  userId: number,
  consentId: number,
  encryptionKey: Buffer,
): Promise<{ seen: Set<string>; waiting: number }> {
  const [linkedHere, waitingHere] = await Promise.all([
    db
      .select({ cipher: accounts.providerAccountId })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.requisitionId, consentId))),
    db
      .select({ payload: accountLinkChoices.payload })
      .from(accountLinkChoices)
      .where(
        and(eq(accountLinkChoices.userId, userId), eq(accountLinkChoices.requisitionId, consentId)),
      ),
  ]);
  const seen = new Set<string>();
  for (const a of linkedHere) {
    const id = tryDecrypt(a.cipher, encryptionKey);
    if (id) seen.add(id);
  }
  for (const c of waitingHere) {
    const json = tryDecrypt(c.payload, encryptionKey);
    if (json) seen.add(parseLinkedAccount(json).providerAccountId);
  }
  return { seen, waiting: waitingHere.length };
}

/** Link a consent's accounts (steps 1–5 of the module comment). */
export async function linkProviderAccounts(input: LinkInput): Promise<LinkResult> {
  const { userId, encryptionKey } = input;
  const consent = await loadConsent(userId, input.requisitionId);
  if (!consent) throw new Error("requisitionNotFound");

  // Step 1: skip what this consent already has.
  const { seen, waiting } = await seenUnderConsent(userId, consent.id, encryptionKey);
  const incoming: Incoming[] = [];
  for (const id of new Set(input.providerAccountIds)) {
    if (seen.has(id)) continue;
    // Sequential on purpose: provider detail endpoints are rate-limited.
    const account = await input.describe(id);
    incoming.push({ account, digest: accountNumberDigest(account.accountNumber, encryptionKey) });
  }

  const candidates =
    incoming.length > 0 ? await candidateAccounts(userId, consent, encryptionKey) : [];
  const { adoptions, choices, creates } = planLink(incoming, candidates);

  const statements: BatchItem<"sqlite">[] = [
    ...adoptions.map((a) =>
      adoptStatement({
        userId,
        requisitionId: consent.id,
        encryptionKey,
        account: a.account,
        digest: a.digest,
        target: a.target,
      }),
    ),
    ...choices.map((c) =>
      db.insert(accountLinkChoices).values({
        userId,
        requisitionId: consent.id,
        payload: encrypt(JSON.stringify(c.account), encryptionKey),
      }),
    ),
    ...(creates.length > 0
      ? [
          db.insert(accounts).values(
            creates.map((c) =>
              insertAccountValues({
                userId,
                requisitionId: consent.id,
                encryptionKey,
                account: c.account,
                digest: c.digest,
              }),
            ),
          ),
        ]
      : []),
    ...dropEmptyConsents(
      userId,
      adoptions.map((a) => a.target.requisitionId),
    ),
  ];
  const [first, ...others] = statements;
  if (first) await db.batch([first, ...others]);

  const linked = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.requisitionId, consent.id)));
  return {
    accountIds: linked.map((a) => a.id),
    created: creates.length,
    adopted: adoptions.length,
    pendingChoices: waiting + choices.length,
  };
}

export interface LinkChoiceView {
  id: number;
  provider: LinkProvider;
  institutionName: string;
  account: Pick<LinkedAccount, "name" | "ibanLast4" | "balanceCents" | "currency">;
  /** Existing accounts this one might continue; the user picks one or "new". */
  candidates: Pick<Candidate, "id" | "name" | "ibanLast4" | "lastSyncedAt">[];
}

/** Accounts waiting for the user's answer, with the accounts each might continue. */
export async function listLinkChoices(
  userId: number,
  encryptionKey: Buffer,
): Promise<LinkChoiceView[]> {
  const rows = await db
    .select({
      id: accountLinkChoices.id,
      payload: accountLinkChoices.payload,
      requisitionId: requisitions.id,
      provider: requisitions.provider,
      institutionId: requisitions.institutionId,
      institutionName: institutions.name,
    })
    .from(accountLinkChoices)
    .innerJoin(requisitions, eq(accountLinkChoices.requisitionId, requisitions.id))
    .innerJoin(institutions, eq(requisitions.institutionId, institutions.id))
    .where(and(eq(accountLinkChoices.userId, userId), eq(requisitions.userId, userId)))
    .orderBy(accountLinkChoices.id);

  const out: LinkChoiceView[] = [];
  for (const r of rows) {
    const json = tryDecrypt(r.payload, encryptionKey);
    if (!json) continue;
    const account = parseLinkedAccount(json);
    const candidates = await candidateAccounts(
      userId,
      { id: r.requisitionId, provider: r.provider, institutionId: r.institutionId },
      encryptionKey,
    );
    out.push({
      id: r.id,
      provider: r.provider as LinkProvider,
      institutionName: r.institutionName,
      account: {
        name: account.name,
        ibanLast4: account.ibanLast4,
        balanceCents: account.balanceCents,
        currency: account.currency,
      },
      candidates: candidates.map(({ id, name, ibanLast4, lastSyncedAt }) => ({
        id,
        name,
        ibanLast4,
        lastSyncedAt,
      })),
    });
  }
  return out;
}

export type ResolveOutcome =
  | { ok: true; provider: LinkProvider; applied: boolean }
  | { ok: false; error: "notFound" | "notACandidate" };

/**
 * Apply the user's answer to a pending choice: continue `targetAccountId`, or
 * (null) create a new account. One batch; every statement is guarded by the
 * choice still existing, so a double submit applies once.
 */
export async function resolveLinkChoice(opts: {
  userId: number;
  encryptionKey: Buffer;
  choiceId: number;
  targetAccountId: number | null;
}): Promise<ResolveOutcome> {
  const { userId, encryptionKey, choiceId } = opts;
  const [row] = await db
    .select({
      payload: accountLinkChoices.payload,
      requisitionId: requisitions.id,
      provider: requisitions.provider,
      institutionId: requisitions.institutionId,
    })
    .from(accountLinkChoices)
    .innerJoin(requisitions, eq(accountLinkChoices.requisitionId, requisitions.id))
    .where(
      and(
        eq(accountLinkChoices.userId, userId),
        eq(accountLinkChoices.id, choiceId),
        eq(requisitions.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "notFound" };

  const account = parseLinkedAccount(decrypt(row.payload, encryptionKey));
  const digest = accountNumberDigest(account.accountNumber, encryptionKey);
  const consent = {
    id: row.requisitionId,
    provider: row.provider,
    institutionId: row.institutionId,
  };
  const pending = sql`exists (select 1 from "account_link_choices" where "account_link_choices"."id" = ${choiceId} and "account_link_choices"."user_id" = ${userId})`;

  let apply: BatchItem<"sqlite">;
  let superseded: number[] = [];
  if (opts.targetAccountId != null) {
    const target = (await candidateAccounts(userId, consent, encryptionKey)).find(
      (c) => c.id === opts.targetAccountId,
    );
    if (!target) return { ok: false, error: "notACandidate" };
    apply = adoptStatement({
      userId,
      requisitionId: consent.id,
      encryptionKey,
      account,
      digest,
      target,
      guard: pending,
    });
    superseded = [target.requisitionId];
  } else {
    const v = insertAccountValues({
      userId,
      requisitionId: consent.id,
      encryptionKey,
      account,
      digest,
    });
    apply = db.run(sql`insert into "accounts"
      ("user_id", "requisition_id", "gocardless_account_id", "iban_hash", "iban_last4", "name", "owner_name", "balance_cents", "currency")
      select ${v.userId}, ${v.requisitionId}, ${v.providerAccountId}, ${v.ibanHash ?? null}, ${v.ibanLast4 ?? null}, ${v.name}, ${v.ownerName ?? null}, ${v.balanceCents ?? 0}, ${v.currency ?? "EUR"}
      where ${pending}`);
  }

  const results = await db.batch([
    apply,
    db
      .delete(accountLinkChoices)
      .where(and(eq(accountLinkChoices.userId, userId), eq(accountLinkChoices.id, choiceId)))
      .returning({ id: accountLinkChoices.id }),
    ...dropEmptyConsents(userId, superseded),
  ]);
  const deleted = results[1] as { id: number }[];
  return { ok: true, provider: consent.provider as LinkProvider, applied: deleted.length > 0 };
}
