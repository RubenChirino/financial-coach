import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { accounts, institutions, requisitions, transactions, users } from "../src/db/schema";

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

function resolveUrl(url: string): string {
  if (
    url.startsWith("libsql:") ||
    url.startsWith("file:") ||
    url.startsWith("http:") ||
    url.startsWith("https:")
  ) {
    return url;
  }
  return `file:${url}`;
}

async function main() {
  const rawUrl = process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "financial-coach.db");
  const url = resolveUrl(rawUrl);

  // For local files, require they already exist (created by migrate).
  if (url.startsWith("file:")) {
    const filePath = url.replace(/^file:/, "");
    if (!fs.existsSync(filePath)) {
      console.error("Database does not exist. Run `pnpm db:migrate` first.");
      process.exit(1);
    }
  }

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  if (url.startsWith("file:")) {
    await client.execute("PRAGMA foreign_keys = ON");
  }
  const db = drizzle(client);

  console.info(
    "⚠️  seeding synthetic data — this will add a fake institution & account to your db.",
  );

  // Synthetic data is owned by a real user so the per-user scoped queries can
  // see it. Reuse the first existing user, or create a throwaway dev one.
  const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
  let userId = existingUser?.id;
  if (!userId) {
    const [u] = await db
      .insert(users)
      .values({ encryptionSalt: "dev-seed-salt", name: "Dev User" })
      .returning({ id: users.id });
    if (!u) throw new Error("failed to insert dev user");
    userId = u.id;
  }

  const [inst] = await db
    .insert(institutions)
    .values({ gocardlessId: "DEV_SANDBOX", name: "Dev Sandbox", country: "ES", logoUrl: null })
    .onConflictDoNothing()
    .returning();
  if (!inst) throw new Error("failed to insert institution");

  const [req] = await db
    .insert(requisitions)
    .values({
      userId,
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
      userId,
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
      userId,
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
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
