import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { users } = await import("@/db/schema");
const { parseCsvWithSpec } = await import("./ai-mapper");
const { findRememberedMapping, rememberMapping } = await import("./mappings");
type CsvMappingSpec = import("./ai-mapper").CsvMappingSpec;

const USER = 1;
const OTHER = 2;

const SPEC: CsvMappingSpec = {
  delimiter: ";",
  headerLineIndex: 2,
  dateColumn: 0,
  dateFormat: "DD/MM/YYYY",
  amountMode: "single",
  amountColumn: 2,
  debitColumn: null,
  creditColumn: null,
  amountSign: "negative-out",
  decimalSeparator: ",",
  thousandsSeparator: "none",
  currencyColumn: -1,
  defaultCurrency: "EUR",
  merchantColumn: -1,
  descriptionColumn: 1,
  notes: "test bank",
};

// The same bank, two exports: different metadata above the same header row.
const MARCH = [
  "Titular: Maria",
  "Periodo: 01/03/2026 - 31/03/2026",
  "Fecha;Concepto;Importe",
  "02/03/2026;Mercadona;-12,50",
  "05/03/2026;Nomina;1500,00",
].join("\n");
const APRIL = [
  "Periodo: 01/04/2026 - 30/04/2026",
  " FECHA ; Concepto ;Importe",
  "02/04/2026;Lidl;-8,10",
].join("\n");

beforeAll(async () => {
  await fixture.db.insert(users).values([
    { id: USER, encryptionSalt: "a" },
    { id: OTHER, encryptionSalt: "b" },
  ]);
  await rememberMapping(USER, MARCH, { spec: SPEC, provider: "ollama", model: "m" });
});

describe("remembered CSV mappings", () => {
  it("finds the mapping for the next export of the same format, wherever its header sits", async () => {
    const found = await findRememberedMapping(USER, APRIL);
    expect(found).toMatchObject({ provider: "ollama", model: "m" });
    expect(found?.spec.headerLineIndex).toBe(1);
    const parsed = parseCsvWithSpec(APRIL, found!.spec);
    expect(parsed.headerError).toBeNull();
    expect(parsed.rows.map((r) => [r.description, r.amountCents])).toEqual([["Lidl", -810]]);
  });

  it("is per user and per format", async () => {
    expect(await findRememberedMapping(OTHER, APRIL)).toBeNull();
    expect(
      await findRememberedMapping(USER, "Date,Payee,Amount\n2026-04-02,Lidl,-8.10"),
    ).toBeNull();
  });

  it("keeps one mapping per format, replaced by a newer one", async () => {
    await rememberMapping(USER, MARCH, {
      spec: { ...SPEC, notes: "re-detected" },
      provider: "anthropic",
      model: "x",
    });
    const found = await findRememberedMapping(USER, MARCH);
    expect(found).toMatchObject({
      provider: "anthropic",
      spec: { notes: "re-detected", headerLineIndex: 2 },
    });
    const n = await fixture.client.execute("SELECT count(*) AS n FROM import_mappings");
    expect(Number(n.rows[0]?.n)).toBe(1);
  });
});
