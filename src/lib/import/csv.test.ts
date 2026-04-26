import { describe, expect, it } from "vitest";
import { amountToCents, parseCsv } from "./csv";

const HEADER = "date,amount,currency,merchant,description";

describe("amountToCents", () => {
  it("parses a plain integer", () => {
    expect(amountToCents("1800")).toBe(180000);
  });

  it("parses two decimals", () => {
    expect(amountToCents("11.99")).toBe(1199);
  });

  it("parses one decimal as cents padded", () => {
    expect(amountToCents("11.9")).toBe(1190);
  });

  it("keeps sign for negatives", () => {
    expect(amountToCents("-45.00")).toBe(-4500);
    expect(amountToCents("-0.01")).toBe(-1);
  });

  it("rejects sub-cent precision", () => {
    expect(() => amountToCents("1.234")).toThrow(/too many decimals/);
  });

  it("rejects non-numeric garbage", () => {
    expect(() => amountToCents("abc")).toThrow(/invalid amount/);
    expect(() => amountToCents("1,99")).toThrow(/invalid amount/);
  });
});

describe("parseCsv - header handling", () => {
  it("reports an empty file", () => {
    const r = parseCsv("");
    expect(r.headerError).toBe("empty file");
  });

  it("rejects a file missing required columns", () => {
    const r = parseCsv("date,amount\n2026-01-05,-11.99");
    expect(r.headerError).toContain("missing required column(s)");
    expect(r.headerError).toContain("currency");
    expect(r.rows).toHaveLength(0);
  });

  it("accepts headers in any order, case-insensitive", () => {
    const text = "Merchant,DESCRIPTION,Currency,Amount,Date\nNetflix,Sub,EUR,-11.99,2026-01-05";
    const r = parseCsv(text);
    expect(r.headerError).toBeNull();
    expect(r.rows[0]?.merchant).toBe("Netflix");
    expect(r.rows[0]?.description).toBe("Sub");
    expect(r.rows[0]?.amountCents).toBe(-1199);
  });

  it("strips a UTF-8 BOM", () => {
    const text = `\uFEFF${HEADER}\n2026-01-05,-11.99,EUR,Netflix,Sub`;
    const r = parseCsv(text);
    expect(r.headerError).toBeNull();
    expect(r.rows).toHaveLength(1);
  });
});

describe("parseCsv - row parsing", () => {
  it("parses a canonical row", () => {
    const text = `${HEADER}\n2026-01-05,-11.99,EUR,Netflix,Netflix Monthly`;
    const r = parseCsv(text);
    expect(r.headerError).toBeNull();
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(row.amountCents).toBe(-1199);
    expect(row.currency).toBe("EUR");
    expect(row.merchant).toBe("Netflix");
    expect(row.description).toBe("Netflix Monthly");
  });

  it("handles CRLF line endings", () => {
    const text = `${HEADER}\r\n2026-01-05,-11.99,EUR,Netflix,Sub\r\n`;
    const r = parseCsv(text);
    expect(r.headerError).toBeNull();
    expect(r.rows).toHaveLength(1);
  });

  it("handles quoted fields with embedded commas", () => {
    const text = `${HEADER}\n2026-01-05,-45.00,EUR,"Mercadona, S.L.","Mercadona, Madrid"`;
    const r = parseCsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]?.merchant).toBe("Mercadona, S.L.");
    expect(r.rows[0]?.description).toBe("Mercadona, Madrid");
  });

  it("handles doubled quotes inside a quoted field", () => {
    const text = `${HEADER}\n2026-01-05,-10.00,EUR,Acme,"He said ""hi"""`;
    const r = parseCsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]?.description).toBe('He said "hi"');
  });

  it("defaults currency to EUR when the column is blank", () => {
    const text = `${HEADER}\n2026-01-05,-11.99,,Netflix,Sub`;
    const r = parseCsv(text);
    expect(r.rows[0]?.currency).toBe("EUR");
  });

  it("reports an invalid date but keeps later rows", () => {
    const text = [
      HEADER,
      "not-a-date,-11.99,EUR,Netflix,Sub",
      "2026-01-06,-9.99,EUR,Spotify,Sub",
    ].join("\n");
    const r = parseCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.merchant).toBe("Spotify");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.lineNumber).toBe(1);
    expect(r.errors[0]?.message).toMatch(/invalid date/);
  });

  it("reports an invalid amount", () => {
    const text = `${HEADER}\n2026-01-05,abc,EUR,Netflix,Sub`;
    const r = parseCsv(text);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/invalid amount/);
  });

  it("rejects currencies that are not 3 letters", () => {
    const text = `${HEADER}\n2026-01-05,-11.99,€€,Netflix,Sub`;
    const r = parseCsv(text);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/invalid currency/);
  });

  it("requires at least one of merchant or description", () => {
    const text = `${HEADER}\n2026-01-05,-11.99,EUR,,`;
    const r = parseCsv(text);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/empty/);
  });

  it("fills description from merchant when only merchant is given", () => {
    const text = `${HEADER}\n2026-01-05,-11.99,EUR,Netflix,`;
    const r = parseCsv(text);
    expect(r.rows[0]?.description).toBe("Netflix");
    expect(r.rows[0]?.merchant).toBe("Netflix");
  });

  it("skips blank lines silently", () => {
    const text = [HEADER, "", "2026-01-05,-11.99,EUR,Netflix,Sub", ""].join("\n");
    const r = parseCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });

  it("parses the 30-row sample without any row errors", () => {
    // Mirrors docs/sample-transactions.csv — inline so the test doesn't depend
    // on the test runner's cwd.
    const text = [
      HEADER,
      "2026-01-05,-11.99,EUR,Netflix,Netflix Monthly Subscription",
      "2026-01-06,-9.99,EUR,Spotify,Spotify Premium",
      "2026-01-15,1800.00,EUR,Acme Corp,Salary January 2026",
      "2026-01-15,-650.00,EUR,Landlord,Rent - January",
      "2026-02-28,-120.00,EUR,Vodafone,Vodafone Fibra 1Gb",
    ].join("\n");
    const r = parseCsv(text);
    expect(r.headerError).toBeNull();
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(5);
    const total = r.rows.reduce((s, row) => s + row.amountCents, 0);
    // 1800 - 11.99 - 9.99 - 650 - 120 = 1008.02 → 100802 cents
    expect(total).toBe(100802);
  });
});
