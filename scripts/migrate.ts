import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { seedDefaultCategories } from "../src/db/seed-categories";
import { seedDefaultRules } from "../src/db/seed-rules";

async function main() {
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, "financial-coach.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  await seedDefaultCategories(db as unknown as Parameters<typeof seedDefaultCategories>[0]);
  await seedDefaultRules(db as unknown as Parameters<typeof seedDefaultRules>[0]);

  console.info(`✓ migrations applied; database at ${dbPath}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
