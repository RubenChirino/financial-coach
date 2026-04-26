import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { accounts, institutions, requisitions, transactions } from "../src/db/schema";

const MERCHANTS = [
  { name: "Mercadona", category: "groceries", amount: () => -(2000 + Math.random() * 8000) },
  { name: "Lidl", category: "groceries", amount: () => -(1500 + Math.random() * 6000) },
  { name: "Bar Pepe", category: "dining", amount: () => -(800 + Math.random() * 4000) },
  { name: "Netflix", category: "subscriptions", amount: () => -1299 },
  { name: "Spotify", category: "subscriptions", amount: () => -999 },
  { name: "Renfe", category: "transport", amount: () => -(1500 + Math.random() * 5000) },
  { name: "Repsol", category: "fuel", amount: () => -(4000 + Math.random() * 4000) },
  { name: "Iberdrola", category: "utilities", amount: () => -(5000 + Math.random() * 4000) },
  { name: "Nómina", category: "income", amount: () => 180000 + Math.random() * 50000 },
];

async function main() {
  const dbPath = process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "financial-coach.db");
  if (!fs.existsSync(dbPath)) {
    console.error("Database does not exist. Run `pnpm db:migrate` first.");
    process.exit(1);
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);

  console.info(
    "⚠️  seeding synthetic data — this will add a fake institution & account to your db.",
  );

  const [inst] = await db
    .insert(institutions)
    .values({ gocardlessId: "DEV_SANDBOX", name: "Dev Sandbox", country: "ES", logoUrl: null })
    .onConflictDoNothing()
    .returning();
  if (!inst) throw new Error("failed to insert institution");

  const [req] = await db
    .insert(requisitions)
    .values({
      institutionId: inst.id,
      gocardlessRequisitionId: "dev-req-ciphertext-placeholder",
      status: "linked",
      reference: "dev-seed",
    })
    .returning();
  if (!req) throw new Error("failed to insert requisition");

  const [acc] = await db
    .insert(accounts)
    .values({
      requisitionId: req.id,
      gocardlessAccountId: "dev-acc-ciphertext-placeholder",
      ibanLast4: "0000",
      name: "Cuenta corriente",
      ownerName: "Dev User",
      balanceCents: 350000,
      currency: "EUR",
    })
    .returning();
  if (!acc) throw new Error("failed to insert account");

  const now = Date.now();
  const txs = [];
  for (let i = 0; i < 120; i++) {
    const m = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)]!;
    txs.push({
      accountId: acc.id,
      gocardlessTransactionId: `dev-${now}-${i}`,
      bookingDate: new Date(now - i * 6 * 60 * 60 * 1000),
      amountCents: Math.round(m.amount()),
      currency: "EUR",
      merchantName: m.name,
      rawDescription: `${m.name} — tarjeta ****0000`,
      isRecurring: false,
      needsReview: false,
    });
  }
  await db.insert(transactions).values(txs).onConflictDoNothing();
  console.info(`✓ seeded ${txs.length} transactions`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
