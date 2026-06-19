import "server-only";

import { db } from "@/db/client";
import { accounts, categories, institutions, requisitions, transactions } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { and, eq, like } from "drizzle-orm";

/**
 * Deterministic fake-bank seeder used by the Demo provider.
 *
 * Creates one "institution" (BBVA Demo or Santander Demo), one requisition
 * tagged `provider: "demo"`, one account, and ~3 months of transactions
 * spanning a realistic monthly cycle (salary, rent, groceries, dining, coffee,
 * subscriptions, fuel, utilities).
 *
 * Deterministic PRNG so repeated seeds of the same demo feel stable within
 * a single call but every seed produces fresh unique external IDs (prefixed
 * with a timestamp) so dedup doesn't collide with earlier demo runs.
 */

type DemoBankKey = "bbva" | "santander";

interface DemoBankSpec {
  key: DemoBankKey;
  externalId: string; // goes into institutions.gocardless_id (unique)
  name: string;
  country: string;
  logoUrl: string | null;
  accountName: string;
  ibanLast4: string;
  currency: string;
  startingBalanceCents: number;
  salaryCents: number;
}

const BANKS: Record<DemoBankKey, DemoBankSpec> = {
  bbva: {
    key: "bbva",
    externalId: "DEMO_BBVA_ES",
    name: "BBVA (Demo)",
    country: "ES",
    logoUrl: null,
    accountName: "Cuenta Online",
    ibanLast4: "4219",
    currency: "EUR",
    startingBalanceCents: 312_400,
    salaryCents: 235_000,
  },
  santander: {
    key: "santander",
    externalId: "DEMO_SANTANDER_ES",
    name: "Santander (Demo)",
    country: "ES",
    logoUrl: null,
    accountName: "Cuenta 1|2|3",
    ibanLast4: "8871",
    currency: "EUR",
    startingBalanceCents: 512_730,
    salaryCents: 278_000,
  },
};

// Seeded LCG so a single seed call has repeatable jitter.
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

interface TxSeed {
  daysAgo: number;
  amountCents: number; // negative for expenses, positive for income
  merchant: string;
  description: string;
  categorySlug?: string;
  isRecurring?: boolean;
}

function monthlyCycle(monthOffset: number, spec: DemoBankSpec, rng: () => number): TxSeed[] {
  // anchor everything relative to the 1st of the target month.
  const base = 30 * monthOffset;
  const jitter = (max: number) => Math.floor(rng() * max);

  const salary = spec.salaryCents + jitter(5_000);
  const rent = -(85_000 + jitter(2_000));
  const cycle: TxSeed[] = [
    {
      daysAgo: base + 27,
      amountCents: salary,
      merchant: "Payroll",
      description: `Nómina mensual — ${spec.name}`,
      categorySlug: "salary",
      isRecurring: true,
    },
    {
      daysAgo: base + 26,
      amountCents: rent,
      merchant: "Landlord SL",
      description: "Alquiler vivienda",
      categorySlug: "housing",
      isRecurring: true,
    },
    {
      daysAgo: base + 24,
      amountCents: -(4_500 + jitter(1_000)),
      merchant: "Iberdrola",
      description: "Luz",
      categorySlug: "utilities",
      isRecurring: true,
    },
    {
      daysAgo: base + 23,
      amountCents: -(2_500 + jitter(800)),
      merchant: "Movistar",
      description: "Fibra + móvil",
      categorySlug: "telecom",
      isRecurring: true,
    },
    {
      daysAgo: base + 22,
      amountCents: -1_399,
      merchant: "Netflix",
      description: "Netflix subscription",
      categorySlug: "subscriptions",
      isRecurring: true,
    },
    {
      daysAgo: base + 20,
      amountCents: -999,
      merchant: "Spotify",
      description: "Spotify Premium",
      categorySlug: "subscriptions",
      isRecurring: true,
    },
    {
      daysAgo: base + 18,
      amountCents: -(6_800 + jitter(2_000)),
      merchant: "Mercadona",
      description: "Supermercado Mercadona",
      categorySlug: "groceries",
    },
    {
      daysAgo: base + 15,
      amountCents: -(4_200 + jitter(1_500)),
      merchant: "Lidl",
      description: "Supermercado Lidl",
      categorySlug: "groceries",
    },
    {
      daysAgo: base + 14,
      amountCents: -(1_800 + jitter(600)),
      merchant: "La Trastienda",
      description: "Cena con amigos",
      categorySlug: "dining",
    },
    {
      daysAgo: base + 12,
      amountCents: -(280 + jitter(80)),
      merchant: "Starbucks",
      description: "Café Starbucks",
      categorySlug: "coffee",
    },
    {
      daysAgo: base + 10,
      amountCents: -(4_500 + jitter(1_200)),
      merchant: "Repsol",
      description: "Gasolinera Repsol",
      categorySlug: "fuel",
    },
    {
      daysAgo: base + 8,
      amountCents: -(320 + jitter(80)),
      merchant: "Starbucks",
      description: "Café Starbucks",
      categorySlug: "coffee",
    },
    {
      daysAgo: base + 6,
      amountCents: -(3_200 + jitter(1_100)),
      merchant: "Mercadona",
      description: "Supermercado Mercadona",
      categorySlug: "groceries",
    },
    {
      daysAgo: base + 4,
      amountCents: -(2_800 + jitter(900)),
      merchant: "Bar Bellas Artes",
      description: "Comida",
      categorySlug: "dining",
    },
    {
      daysAgo: base + 2,
      amountCents: -(1_500 + jitter(500)),
      merchant: "Amazon",
      description: "Amazon — varios",
      categorySlug: "shopping",
    },
  ];

  return cycle.filter((t) => t.daysAgo >= 0);
}

async function slugToCategoryId(): Promise<Map<string, number>> {
  const rows = await db.select({ id: categories.id, slug: categories.slug }).from(categories);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function upsertDemoInstitution(spec: DemoBankSpec): Promise<number> {
  const existing = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.gocardlessId, spec.externalId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(institutions)
    .values({
      gocardlessId: spec.externalId,
      name: spec.name,
      logoUrl: spec.logoUrl,
      country: spec.country,
    })
    .returning({ id: institutions.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("demo: failed to insert institution");
  return id;
}

export async function seedDemoBank(
  userId: number,
  bank: DemoBankKey,
  encryptionKey: Buffer,
): Promise<{ requisitionRowId: number; accountRowId: number; inserted: number }> {
  const spec = BANKS[bank];
  const now = Date.now();
  const institutionRowId = await upsertDemoInstitution(spec);

  const reference = `demo-${spec.key}-${now}`;
  const gcRequisitionId = `DEMO_REQ_${spec.key.toUpperCase()}_${now}`;

  const reqInsert = await db
    .insert(requisitions)
    .values({
      userId,
      institutionId: institutionRowId,
      provider: "demo",
      gocardlessRequisitionId: encrypt(gcRequisitionId, encryptionKey),
      status: "linked",
      reference,
      link: null,
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: requisitions.id });
  const requisitionRowId = reqInsert[0]?.id;
  if (!requisitionRowId) throw new Error("demo: failed to insert requisition");

  const gcAccountId = `DEMO_ACC_${spec.key.toUpperCase()}_${now}`;
  const accInsert = await db
    .insert(accounts)
    .values({
      userId,
      requisitionId: requisitionRowId,
      gocardlessAccountId: encrypt(gcAccountId, encryptionKey),
      ibanLast4: spec.ibanLast4,
      name: spec.accountName,
      ownerName: null,
      balanceCents: spec.startingBalanceCents,
      currency: spec.currency,
      lastSyncedAt: new Date(now),
    })
    .returning({ id: accounts.id });
  const accountRowId = accInsert[0]?.id;
  if (!accountRowId) throw new Error("demo: failed to insert account");

  // Build 3 months of transactions deterministically.
  const rng = makeRng(now ^ spec.startingBalanceCents);
  const seeds: TxSeed[] = [0, 1, 2].flatMap((m) => monthlyCycle(m, spec, rng));

  const catMap = await slugToCategoryId();

  const rows = seeds.map((s, idx) => {
    const booking = new Date(now - s.daysAgo * 24 * 60 * 60 * 1000);
    return {
      userId,
      accountId: accountRowId,
      gocardlessTransactionId: `DEMO_TX_${spec.key.toUpperCase()}_${now}_${idx}`,
      bookingDate: booking,
      valueDate: booking,
      amountCents: s.amountCents,
      currency: spec.currency,
      merchantName: s.merchant,
      rawDescription: s.description,
      categoryId: (s.categorySlug && catMap.get(s.categorySlug)) || null,
      subcategory: null as string | null,
      confidence: s.categorySlug ? 100 : null,
      isRecurring: Boolean(s.isRecurring),
      needsReview: !s.categorySlug,
    };
  });

  if (rows.length > 0) {
    await db.insert(transactions).values(rows).onConflictDoNothing();
  }

  return { requisitionRowId, accountRowId, inserted: rows.length };
}

/**
 * Wipe ALL demo-provider requisitions (accounts + transactions cascade).
 * Doesn't touch the institutions rows — they stay around so the same demo
 * can be re-seeded without duplicates. Also cleans up orphan demo
 * institutions that no longer have any requisition.
 */
export async function wipeAllDemoData(userId: number): Promise<{ removedRequisitions: number }> {
  const demoReqs = await db
    .select({ id: requisitions.id })
    .from(requisitions)
    .where(and(eq(requisitions.userId, userId), eq(requisitions.provider, "demo")));

  for (const r of demoReqs) {
    await db
      .delete(requisitions)
      .where(and(eq(requisitions.userId, userId), eq(requisitions.id, r.id)));
  }

  // Drop orphan demo institutions (no requisitions pointing at them).
  const orphans = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(like(institutions.gocardlessId, "DEMO_%"));
  for (const o of orphans) {
    const refs = await db
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(and(eq(requisitions.institutionId, o.id)))
      .limit(1);
    if (refs.length === 0) {
      await db.delete(institutions).where(eq(institutions.id, o.id));
    }
  }

  return { removedRequisitions: demoReqs.length };
}

export const DEMO_BANK_KEYS: readonly DemoBankKey[] = ["bbva", "santander"];
export type { DemoBankKey };
