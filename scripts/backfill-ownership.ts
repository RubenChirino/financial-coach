import "dotenv/config";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";

/**
 * One-off ownership backfill for the per-user data isolation change (migration
 * 0013). Migration 0013 adds `user_id` columns defaulting to `0` (a non-existent
 * user → invisible to everyone). This script claims all of that pre-existing
 * data for the instance owner, exactly once.
 *
 * Owner resolution:
 *   1. `OWNER_EMAIL` env → the matching `users.email` row.
 *   2. Fallback: the oldest non-guest user (`is_guest = 0`, lowest id).
 *
 * The email is read from the environment so it never lands in git. Run once per
 * environment AFTER migrating:
 *
 *   # local
 *   pnpm tsx scripts/backfill-ownership.ts
 *   # production (Turso)
 *   DATABASE_URL=… TURSO_AUTH_TOKEN=… OWNER_EMAIL=you@example.com \
 *     pnpm tsx scripts/backfill-ownership.ts
 *
 * Idempotent: every UPDATE is gated on `user_id = 0`, and the budgets backfill
 * uses ON CONFLICT DO NOTHING — re-running is a no-op.
 */

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

async function resolveOwnerId(client: Client): Promise<number | null> {
  const email = process.env.OWNER_EMAIL?.trim();
  if (email) {
    const r = await client.execute({
      sql: "SELECT id FROM users WHERE email = ? LIMIT 1",
      args: [email],
    });
    const id = r.rows[0]?.id;
    if (typeof id === "number" || typeof id === "bigint") {
      console.info(`  owner resolved by OWNER_EMAIL=${email} → user ${id}`);
      return Number(id);
    }
    console.warn(`  OWNER_EMAIL=${email} not found; falling back to oldest non-guest user`);
  }

  const r = await client.execute("SELECT id FROM users WHERE is_guest = 0 ORDER BY id ASC LIMIT 1");
  const id = r.rows[0]?.id;
  if (typeof id === "number" || typeof id === "bigint") {
    console.info(`  owner resolved as oldest non-guest → user ${id}`);
    return Number(id);
  }
  return null;
}

/** Tables with a flat `user_id` column that all belong to the single owner. */
const OWNER_TABLES = [
  "requisitions",
  "accounts",
  "import_batches",
  "recurring_subscriptions",
  "goals",
  "insights",
  "advisor_conversations",
  "travel_city_labels",
] as const;

async function main() {
  const dataDir = path.resolve(process.cwd(), "data");
  const rawUrl = process.env.DATABASE_URL ?? path.join(dataDir, "financial-coach.db");
  const url = resolveUrl(rawUrl);

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  if (url.startsWith("file:")) {
    await client.executeMultiple("PRAGMA foreign_keys = ON;");
  }

  const owner = await resolveOwnerId(client);
  if (owner == null) {
    console.error("✗ no owner user found (empty users table?). Nothing to backfill.");
    client.close();
    process.exit(1);
  }

  // Claim the flat owner tables.
  for (const table of OWNER_TABLES) {
    const res = await client.execute({
      sql: `UPDATE ${table} SET user_id = ? WHERE user_id = 0`,
      args: [owner],
    });
    if (res.rowsAffected > 0) console.info(`  ${table}: claimed ${res.rowsAffected} row(s)`);
  }

  // Transactions inherit their account's owner (general case if data ever spans
  // multiple accounts/users; here it all resolves to `owner`).
  const tx = await client.execute(
    "UPDATE transactions SET user_id = (SELECT a.user_id FROM accounts a WHERE a.id = transactions.account_id) WHERE user_id = 0",
  );
  if (tx.rowsAffected > 0) console.info(`  transactions: claimed ${tx.rowsAffected} row(s)`);

  // Move per-user budgets out of the deprecated categories.budget_monthly_cents.
  const budgets = await client.execute({
    sql: `INSERT INTO budgets (user_id, category_id, monthly_cents)
          SELECT ?, id, budget_monthly_cents FROM categories
          WHERE budget_monthly_cents IS NOT NULL
          ON CONFLICT (user_id, category_id) DO NOTHING`,
    args: [owner],
  });
  if (budgets.rowsAffected > 0) console.info(`  budgets: migrated ${budgets.rowsAffected} row(s)`);

  console.info(`✓ ownership backfill complete (owner = user ${owner}); database at ${url}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
