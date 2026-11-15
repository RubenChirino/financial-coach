import { describe, expect, it } from "vitest";
import { applyMigration, createDbAt, indexNames, migrationStatements } from "@/test/migrations";
import { withOccurrenceOrdinals } from "./identity";

describe("withOccurrenceOrdinals", () => {
  it("keeps the first occurrence and numbers later identical derived ids", () => {
    const out = withOccurrenceOrdinals([
      { externalId: "a", externalIdDerived: true },
      { externalId: "b", externalIdDerived: true },
      { externalId: "a", externalIdDerived: true },
      { externalId: "a", externalIdDerived: true },
    ]);
    expect(out.map((r) => r.externalId)).toEqual(["a", "b", "a#2", "a#3"]);
  });

  it("leaves provider-issued ids alone, even when repeated", () => {
    const out = withOccurrenceOrdinals([
      { externalId: "tx-1", externalIdDerived: false },
      { externalId: "tx-1", externalIdDerived: false },
      { externalId: "tx-1" },
    ]);
    expect(out.map((r) => r.externalId)).toEqual(["tx-1", "tx-1", "tx-1"]);
  });

  it("is deterministic, so replaying the same input yields the same ids", () => {
    const input = ["x", "y", "x", "x", "y"].map((externalId) => ({
      externalId,
      externalIdDerived: true,
    }));
    expect(withOccurrenceOrdinals(input)).toEqual(withOccurrenceOrdinals(input));
  });
});

describe("migration 0019 (per-account transaction identity)", () => {
  async function legacyDb() {
    const client = await createDbAt("0018_short_rumiko_fujikawa");
    // Rows shaped by the old schema: globally-unique external ids, two accounts.
    await client.executeMultiple(`
      INSERT INTO users (id, encryption_salt) VALUES (1, 's1'), (2, 's2');
      INSERT INTO institutions (id, gocardless_id, name, country) VALUES (1, 'I', 'Bank', 'ES');
      INSERT INTO requisitions (id, user_id, institution_id, gocardless_requisition_id, reference)
        VALUES (1, 1, 1, 'enc', 'r1'), (2, 2, 1, 'enc', 'r2');
      INSERT INTO accounts (id, user_id, requisition_id, gocardless_account_id, name)
        VALUES (1, 1, 1, 'enc', 'A'), (2, 2, 2, 'enc', 'B');
      INSERT INTO transactions (user_id, account_id, gocardless_transaction_id, booking_date, amount_cents, raw_description)
        VALUES (1, 1, 'importCsv:aaa', 0, -100, 'x'), (1, 1, 'tx-1', 0, -200, 'y'), (2, 2, 'importCsv:bbb', 0, -300, 'z');
    `);
    return client;
  }

  it("keeps existing rows and swaps the global unique index for a per-account one", async () => {
    const client = await legacyDb();
    expect(await indexNames(client, "transactions")).toContain(
      "transactions_gocardless_transaction_id_unique",
    );

    await applyMigration(client, "0019_transactions_account_identity");

    const names = await indexNames(client, "transactions");
    expect(names).toContain("transactions_account_external_uniq");
    expect(names).not.toContain("transactions_gocardless_transaction_id_unique");
    const count = await client.execute("SELECT count(*) AS n FROM transactions");
    expect(Number(count.rows[0]?.n)).toBe(3);

    // The same external id may now exist in two accounts…
    await client.execute(
      "INSERT INTO transactions (user_id, account_id, gocardless_transaction_id, booking_date, amount_cents, raw_description) VALUES (2, 2, 'importCsv:aaa', 0, -100, 'x')",
    );
    // …but never twice in one account.
    await expect(
      client.execute(
        "INSERT INTO transactions (user_id, account_id, gocardless_transaction_id, booking_date, amount_cents, raw_description) VALUES (1, 1, 'tx-1', 0, -200, 'y')",
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("is re-entrant: a partial or repeated apply succeeds", async () => {
    const client = await legacyDb();
    const [createStmt] = migrationStatements("0019_transactions_account_identity");
    await client.execute(createStmt!); // crash after the first statement…
    await applyMigration(client, "0019_transactions_account_identity"); // …then a full re-run
    await applyMigration(client, "0019_transactions_account_identity"); // and once more
    const names = await indexNames(client, "transactions");
    expect(names).toContain("transactions_account_external_uniq");
    expect(names).not.toContain("transactions_gocardless_transaction_id_unique");
  });
});
