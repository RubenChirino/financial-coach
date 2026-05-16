import { describe, expect, it } from "vitest";
import {
  type CsvMappingSpec,
  applyMapping,
  parseAmountWithSpec,
  parseDateWithSpec,
  sniffDelimiter,
  splitRow,
} from "./ai-mapper";

const baseSpec: CsvMappingSpec = {
  delimiter: ",",
  headerLineIndex: 0,
  dateColumn: 0,
  dateFormat: "YYYY-MM-DD",
  amountMode: "single",
  amountColumn: 1,
  debitColumn: null,
  creditColumn: null,
  amountSign: "negative-out",
  decimalSeparator: ".",
  thousandsSeparator: "none",
  currencyColumn: 2,
  defaultCurrency: "EUR",
  merchantColumn: 3,
  descriptionColumn: 4,
  notes: "test fixture",
};

describe("sniffDelimiter", () => {
  it("picks comma for a typical export", () => {
    const t = "a,b,c\n1,2,3\n4,5,6";
    expect(sniffDelimiter(t)).toBe(",");
  });

  it("picks semicolon when European banks use it", () => {
    const t = "fecha;importe;divisa\n2026-01-05;-11,99;EUR";
    expect(sniffDelimiter(t)).toBe(";");
  });

  it("picks tab over comma when both are present but tab is more stable", () => {
    const t = "a\tb\tc\td\n1\t2\t3\t4\n5\t6\t7\t8";
    expect(sniffDelimiter(t)).toBe("\t");
  });

  it("falls back to comma on empty input", () => {
    expect(sniffDelimiter("")).toBe(",");
  });
});

describe("splitRow", () => {
  it("respects quoted fields with embedded delimiters", () => {
    const cells = splitRow('a;"b;c";d', ";");
    expect(cells).toEqual(["a", "b;c", "d"]);
  });

  it("handles doubled quotes inside a quoted cell", () => {
    const cells = splitRow('a,"He said ""hi""",c', ",");
    expect(cells).toEqual(["a", 'He said "hi"', "c"]);
  });
});

describe("parseAmountWithSpec", () => {
  it("parses US-style 1,234.56 with comma thousands and dot decimal", () => {
    expect(parseAmountWithSpec("1,234.56", ".", ",")).toBe(123456);
  });

  it("parses EU-style 1.234,56 with dot thousands and comma decimal", () => {
    expect(parseAmountWithSpec("1.234,56", ",", ".")).toBe(123456);
  });

  it("parses leading minus", () => {
    expect(parseAmountWithSpec("-11,99", ",", "")).toBe(-1199);
  });

  it("parses trailing minus (Spanish bank quirk)", () => {
    expect(parseAmountWithSpec("11,99-", ",", "")).toBe(-1199);
  });

  it("parses parenthesized negatives", () => {
    expect(parseAmountWithSpec("(11.99)", ".", "")).toBe(-1199);
  });

  it("strips trailing currency tokens", () => {
    expect(parseAmountWithSpec("11.99 EUR", ".", "")).toBe(1199);
    expect(parseAmountWithSpec("€11,99", ",", "")).toBe(1199);
  });

  it("returns NaN on garbage", () => {
    expect(Number.isNaN(parseAmountWithSpec("abc", ".", ""))).toBe(true);
    expect(Number.isNaN(parseAmountWithSpec("", ".", ""))).toBe(true);
  });

  it("rounds 4-decimal exports to 2 decimals", () => {
    // "1.2345" with dot decimal → 123 cents (truncated to 2dp).
    expect(parseAmountWithSpec("1.2345", ".", "")).toBe(123);
  });
});

describe("parseDateWithSpec", () => {
  it("parses ISO YYYY-MM-DD", () => {
    const d = parseDateWithSpec("2026-01-05", "YYYY-MM-DD");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("parses Spanish DD/MM/YYYY", () => {
    const d = parseDateWithSpec("05/01/2026", "DD/MM/YYYY");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("parses US MM/DD/YYYY differently from DD/MM/YYYY", () => {
    const d = parseDateWithSpec("01/05/2026", "MM/DD/YYYY");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("rejects out-of-range months", () => {
    expect(parseDateWithSpec("32/13/2026", "DD/MM/YYYY")).toBeNull();
  });

  it("expands two-digit years to 20xx", () => {
    const d = parseDateWithSpec("05/01/26", "DD/MM/YY");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-01-05");
  });
});

describe("applyMapping — single signed amount column", () => {
  it("parses a canonical-shaped file using the spec", () => {
    const text = [
      "date,amount,currency,merchant,description",
      "2026-01-05,-11.99,EUR,Netflix,Sub",
    ].join("\n");
    const r = applyMapping(text, baseSpec);
    expect(r.headerError).toBeNull();
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.amountCents).toBe(-1199);
  });

  it("flips signs when amountSign='positive-out'", () => {
    const text = [
      "date,amount,currency,merchant,description",
      "2026-01-05,11.99,EUR,Netflix,Sub",
    ].join("\n");
    const spec: CsvMappingSpec = { ...baseSpec, amountSign: "positive-out" };
    const r = applyMapping(text, spec);
    expect(r.rows[0]?.amountCents).toBe(-1199);
  });

  it("falls back to defaultCurrency when the cell is blank", () => {
    const text = [
      "date,amount,currency,merchant,description",
      "2026-01-05,-11.99,,Netflix,Sub",
    ].join("\n");
    const r = applyMapping(text, baseSpec);
    expect(r.rows[0]?.currency).toBe("EUR");
  });
});

describe("applyMapping — debit/credit columns", () => {
  it("treats debit as outflow and credit as inflow", () => {
    const text = [
      "fecha;cargo;abono;concepto",
      "05/01/2026;11,99;;Netflix",
      "15/01/2026;;1800,00;Nómina",
    ].join("\n");
    const spec: CsvMappingSpec = {
      delimiter: ";",
      headerLineIndex: 0,
      dateColumn: 0,
      dateFormat: "DD/MM/YYYY",
      amountMode: "debit-credit",
      amountColumn: null,
      debitColumn: 1,
      creditColumn: 2,
      amountSign: "negative-out",
      decimalSeparator: ",",
      thousandsSeparator: ".",
      currencyColumn: -1,
      defaultCurrency: "EUR",
      merchantColumn: -1,
      descriptionColumn: 3,
      notes: "santander-style",
    };
    const r = applyMapping(text, spec);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.amountCents).toBe(-1199);
    expect(r.rows[1]?.amountCents).toBe(180000);
  });
});

describe("applyMapping — header offset", () => {
  it("skips junk metadata lines above the header", () => {
    const text = [
      "Account holder: ACME",
      "Period: 2026-01-01 to 2026-01-31",
      "",
      "date,amount,currency,merchant,description",
      "2026-01-05,-11.99,EUR,Netflix,Sub",
    ].join("\n");
    const r = applyMapping(text, { ...baseSpec, headerLineIndex: 3 });
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
  });
});
