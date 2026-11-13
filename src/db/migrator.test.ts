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
});
