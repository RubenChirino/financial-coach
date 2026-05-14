import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { seedDefaultCategories } from "../src/db/seed-categories";
import { seedDefaultRules } from "../src/db/seed-rules";

/**
 * Standalone migrator. We do NOT use drizzle-orm/libsql/migrator because
 * drizzle-orm@0.45.2 has two bugs that bite when migrating against a remote
 * Turso instance over HTTP:
 *
 *   1. It emits `CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, …)`
 *      — Postgres syntax. Local SQLite ignores the unknown type, Turso's
 *      strict parser returns HTTP 400.
 *   2. Even with a pre-created tracking table, its `migrate()` issues
 *      multi-statement requests that the libsql HTTP transport rejects.
 *
 * The journal in `src/db/migrations/meta/_journal.json` is the source of
 * truth for what to apply, in what order. For each entry we:
 *   - read the SQL file
 *   - split on `--> statement-breakpoint` (drizzle-kit's own convention)
 *   - apply each statement individually
 *   - record the hash + timestamp in `__drizzle_migrations`
 *
 * The hash format matches drizzle's own (sha256 over the raw migration SQL)
 * so a DB previously migrated by drizzle's migrator remains compatible.
 */

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

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

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
}

async function getAppliedHashes(client: Client): Promise<Set<string>> {
  const result = await client.execute("SELECT hash FROM __drizzle_migrations");
  return new Set(result.rows.map((r) => String(r.hash)));
}

function readMigrationFile(migrationsDir: string, tag: string): string {
  const file = path.join(migrationsDir, `${tag}.sql`);
  return fs.readFileSync(file, "utf8");
}

function splitStatements(sql: string): string[] {
  // drizzle-kit emits `--> statement-breakpoint` between logical statements.
  return sql
    .split(/-->\s*statement-breakpoint\s*/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function hashMigration(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

async function applyMigration(
  client: Client,
  entry: JournalEntry,
  applied: Set<string>,
  migrationsDir: string,
): Promise<void> {
  const sql = readMigrationFile(migrationsDir, entry.tag);
  const hash = hashMigration(sql);
  if (applied.has(hash)) return;

  const statements = splitStatements(sql);
  for (const stmt of statements) {
    // Strip trailing semicolons that libsql's single-statement execute()
    // sometimes rejects when followed by whitespace.
    const cleaned = stmt.replace(/;\s*$/, "");
    if (!cleaned) continue;
    await client.execute(cleaned);
  }

  await client.execute({
    sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    args: [hash, entry.when],
  });
  console.info(`  → applied ${entry.tag}`);
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

  const migrationsDir = path.resolve(process.cwd(), "src/db/migrations");
  const journalPath = path.join(migrationsDir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  await ensureMigrationsTable(client);
  const applied = await getAppliedHashes(client);

  for (const entry of ordered) {
    await applyMigration(client, entry, applied, migrationsDir);
  }

  const db = drizzle(client);
  await seedDefaultCategories(db as unknown as Parameters<typeof seedDefaultCategories>[0]);
  await seedDefaultRules(db as unknown as Parameters<typeof seedDefaultRules>[0]);

  console.info(`✓ migrations applied; database at ${url}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
