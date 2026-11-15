import path from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { applyMigrations } from "@/db/migrator";
import * as schema from "@/db/schema";

export type TestDb = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  client: Client;
};

/**
 * Build a fresh in-memory libSQL instance with the production schema applied.
 * Used by tests that exercise real SQL (Drizzle aggregations, joins, etc.).
 * No seed data — caller decides what to insert.
 *
 * NOTE: libSQL's `:memory:` is per-connection, so this fixture is isolated
 * per call. Most tests want to call this once at module scope so all queries
 * share the same connection.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  // The production runner, so every test run exercises it.
  await applyMigrations(client, path.resolve(__dirname, "../db/migrations"));
  return { db, client };
}
