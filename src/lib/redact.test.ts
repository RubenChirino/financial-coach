import { describe, expect, it } from "vitest";
import { redact, redactTransaction } from "./redact";

describe("redact", () => {
  it("strips Spanish IBANs", () => {
    expect(redact("My IBAN is ES91 2100 0418 4502 0005 1332")).toContain("[IBAN]");
    expect(redact("ES9121000418450200051332")).toContain("[IBAN]");
  });

  it("strips card numbers", () => {
    expect(redact("4111 1111 1111 1111 expires soon")).toContain("[CARD]");
    expect(redact("5500-0000-0000-0004")).toContain("[CARD]");
  });

  it("strips emails", () => {
    expect(redact("contact user@example.com now")).toContain("[EMAIL]");
  });

  it("strips Spanish DNI / NIE", () => {
    expect(redact("DNI 12345678Z")).toContain("[ID]");
    expect(redact("NIE X1234567L")).toContain("[ID]");
  });

  it("strips postal codes", () => {
    expect(redact("Madrid 28001")).toContain("[POSTAL]");
  });

  it("strips phone numbers", () => {
    expect(redact("call +34 612 345 678")).toContain("[PHONE]");
  });

  it("preserves non-PII text", () => {
    expect(redact("Mercadona 23.45")).toBe("Mercadona 23.45");
  });

  it("handles empty input", () => {
    expect(redact("")).toBe("");
  });
});

describe("redactTransaction", () => {
  it("converts cents to whole units", () => {
    const r = redactTransaction({
      bookingDate: new Date("2024-03-14"),
      amountCents: -2345,
      currency: "EUR",
      merchantName: "Mercadona",
      rawDescription: "Compra supermercado",
      category: "groceries",
    });
    expect(r.amount).toBe(-23.45);
    expect(r.date).toBe("2024-03-14");
    expect(r.merchant).toBe("Mercadona");
    expect(r.category).toBe("groceries");
  });

  it("redacts IBANs from raw description when merchant name is missing", () => {
    const r = redactTransaction({
      bookingDate: "2024-03-14",
      amountCents: 100000,
      currency: "EUR",
      merchantName: null,
      rawDescription: "Transfer from ES91 2100 0418 4502 0005 1332",
      category: null,
    });
    expect(r.merchant).toContain("[IBAN]");
  });
});

describe("redact with maxLength", () => {
  it("cuts after redacting, so a cut never leaves part of an identifier unmatched", () => {
    // Cutting first would leave "ES76 0049 ", which no pattern matches.
    expect(redact("ES76 0049 1500 0512 3456 7892", 10)).toBe("[IBAN]");
  });

  it("re-redacts after the cut, which can turn a non-match into a match", () => {
    // "12345678ZA" is not a DNI; its 9-character prefix is.
    expect(redact("12345678ZA tail")).toBe("12345678ZA tail");
    expect(redact("12345678ZA tail", 9)).toBe("[ID]");
  });
});
