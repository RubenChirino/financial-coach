import fs from "node:fs";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";

/**
 * Apply migrations to a fresh in-memory database the same way
 * `scripts/migrate.ts` does (statement by statement, split on drizzle-kit's
 * breakpoints), stopping at a given tag. Lets a test seed rows in the shape
 * an OLDER schema produced, then apply the next migration and check that
 * existing data survives and the new constraints hold.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, "../db/migrations");

interface JournalEntry {
  idx: number;
  tag: string;
}

export function migrationTags(): string[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

export function migrationStatements(tag: string): string[] {
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
    .split(/-->\s*statement-breakpoint\s*/g)
    .map((s) => s.trim().replace(/;\s*$/, ""))
    .filter((s) => s.length > 0);
}

export async function applyMigration(client: Client, tag: string): Promise<void> {
  for (const stmt of migrationStatements(tag)) await client.execute(stmt);
}

/** New in-memory DB with every migration applied up to and including `lastTag`. */
export async function createDbAt(lastTag: string): Promise<Client> {
  const tags = migrationTags();
  const end = tags.indexOf(lastTag);
  if (end < 0) throw new Error(`unknown migration ${lastTag}`);
  const client = createClient({ url: ":memory:" });
  for (const tag of tags.slice(0, end + 1)) await applyMigration(client, tag);
  return client;
}

export async function indexNames(client: Client, table: string): Promise<string[]> {
  const res = await client.execute(`PRAGMA index_list(\`${table}\`)`);
  return res.rows.map((r) => String(r.name));
}
