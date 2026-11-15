import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, splitStatements } from "./migrator";

const dirs: string[] = [];

/** A throwaway migrations folder: `files` maps tag → SQL, in journal order. */
function migrationsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-migrator-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "meta"));
  const entries = Object.keys(files).map((tag, idx) => ({
    idx,
    tag,
    when: 1_700_000_000_000 + idx,
  }));
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ entries }));
  for (const [tag, sql] of Object.entries(files))
    fs.writeFileSync(path.join(dir, `${tag}.sql`), sql);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const columns = async (client: ReturnType<typeof createClient>, table: string) =>
  (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));

describe("applyMigrations", () => {
  it("applies each migration atomically: a failing statement leaves nothing behind", async () => {
    const client = createClient({ url: ":memory:" });
    const files = {
      "0000_init": "CREATE TABLE `t` (`id` integer PRIMARY KEY);",
      // The second statement fails after the first succeeded.
      "0001_two": ["ALTER TABLE `t` ADD `a` text;", "INSERT INTO `missing` VALUES (1);"].join(
        "\n--> statement-breakpoint\n",
      ),
    };
    const dir = migrationsDir(files);

    await expect(applyMigrations(client, dir)).rejects.toThrow(/missing/);
    // 0000 committed; 0001 rolled back whole: no column, no hash row.
    expect(await columns(client, "t")).toEqual(["id"]);
    const hashes = await client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
    expect(Number(hashes.rows[0]?.n)).toBe(1);

    // Fixed, the next run applies it — no "duplicate column" from a half-apply.
    fs.writeFileSync(
      path.join(dir, "0001_two.sql"),
      "ALTER TABLE `t` ADD `a` text;\n--> statement-breakpoint\nCREATE INDEX `t_a` ON `t` (`a`);",
    );
    expect(await applyMigrations(client, dir)).toEqual(["0001_two"]);
    expect(await columns(client, "t")).toEqual(["id", "a"]);
    expect(await applyMigrations(client, dir)).toEqual([]);
    client.close();
  });

  it("splits drizzle-kit statements and drops trailing semicolons", () => {
    expect(
      splitStatements("A;\n--> statement-breakpoint\n  B;  \n--> statement-breakpoint\n"),
    ).toEqual(["A", "B"]);
  });

  it("migrates legacy insights whose user is gone, with foreign keys enforced as on Turso", async () => {
    const real = path.resolve(__dirname, "migrations");
    const journal = JSON.parse(fs.readFileSync(path.join(real, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    // The schema as it was before the dismissals backfill (0029).
    const before = fs.mkdtempSync(path.join(os.tmpdir(), "fc-migrator-"));
    dirs.push(before);
    fs.mkdirSync(path.join(before, "meta"));
    const entries = journal.entries.filter((e) => e.idx < 29);
    fs.writeFileSync(path.join(before, "meta/_journal.json"), JSON.stringify({ entries }));
    for (const e of entries)
      fs.copyFileSync(path.join(real, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));

    const client = createClient({ url: ":memory:" });
    await client.execute("PRAGMA foreign_keys = ON");
    await applyMigrations(client, before);

    // `insights.user_id` has no foreign key: rows survive their user (a purged
    // guest, 7) and rows from before user scoping keep the default 0.
    await client.execute("INSERT INTO users (id, encryption_salt) VALUES (1, 's')");
    const insight = (userId: number, kind: string) =>
      client.execute({
        sql: "INSERT INTO insights (user_id, kind, title, body, action_label, action_href, dismissed_at, created_at) VALUES (?, ?, 't', 'b', 'a', '/', 1, 1)",
        args: [userId, kind],
      });
    await insight(1, "needs_review");
    await insight(7, "needs_review");
    await insight(0, "needs_review");

    expect(await applyMigrations(client, real)).toContain("0029_insight_dismissals_backfill");
    const rows = await client.execute("SELECT user_id, insight_key FROM insight_dismissals");
    expect(rows.rows.map((r) => [Number(r.user_id), String(r.insight_key)])).toEqual([
      [1, "needs_review"],
    ]);
  });
});
