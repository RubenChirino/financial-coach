import path from "node:path";
import * as schema from "@/db/schema";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Build a fresh in-memory SQLite instance with the production schema applied.
 * Used by tests that exercise real SQL (Drizzle aggregations, joins, etc.).
 * No seed data — caller decides what to insert.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../db/migrations") });
  return { db, sqlite };
}
