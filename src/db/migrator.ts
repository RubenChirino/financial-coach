import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Client, InStatement } from "@libsql/client";

/**
 * The migration runner, shared by `scripts/migrate.ts` and the test fixture
 * (so every test run exercises it).
 *
 * We do NOT use drizzle-orm/libsql/migrator: against Turso over HTTP it emits
 * `id SERIAL PRIMARY KEY` (Postgres syntax, rejected by Turso's parser) and
 * sends multi-statement requests the HTTP transport rejects.
 *
 * The journal in `migrations/meta/_journal.json` is the source of truth for
 * what to apply, in what order. Each migration is applied as ONE
 * `client.batch(…, "write")` — its statements (split on drizzle-kit's
 * `--> statement-breakpoint`) plus the `__drizzle_migrations` row — so it is
 * atomic on local SQLite and on Turso alike: a crash or a failing statement
 * leaves no half-applied migration, and the next run starts it again.
 *
 * The hash is drizzle's own (sha256 of the raw SQL file), so databases
 * migrated by drizzle's migrator stay compatible.
 */

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export function splitStatements(sql: string): string[] {
  return (
    sql
      .split(/-->\s*statement-breakpoint\s*/g)
      // libSQL rejects a trailing semicolon followed by whitespace.
      .map((s) => s.trim().replace(/;\s*$/, ""))
      .filter((s) => s.length > 0)
  );
}

function hashMigration(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Apply every journal entry not applied yet. Returns the tags applied, in order. */
export async function applyMigrations(client: Client, migrationsDir: string): Promise<string[]> {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  await client.execute(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  const applied = new Set(
    (await client.execute("SELECT hash FROM __drizzle_migrations")).rows.map((r) => String(r.hash)),
  );

  const done: string[] = [];
  for (const entry of ordered) {
    const sql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    const hash = hashMigration(sql);
    if (applied.has(hash)) continue;
    const statements: InStatement[] = [
      ...splitStatements(sql),
      {
        sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        args: [hash, entry.when],
      },
    ];
    await client.batch(statements, "write");
    applied.add(hash);
    done.push(entry.tag);
  }
  return done;
}
