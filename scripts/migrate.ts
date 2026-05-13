import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { seedDefaultCategories } from "../src/db/seed-categories";
import { seedDefaultRules } from "../src/db/seed-rules";

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
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const rawUrl = process.env.DATABASE_URL ?? path.join(dataDir, "financial-coach.db");
  const url = resolveUrl(rawUrl);

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  if (url.startsWith("file:")) {
    await client.executeMultiple("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await seedDefaultCategories(db as unknown as Parameters<typeof seedDefaultCategories>[0]);
  await seedDefaultRules(db as unknown as Parameters<typeof seedDefaultRules>[0]);

  console.info(`✓ migrations applied; database at ${url}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
