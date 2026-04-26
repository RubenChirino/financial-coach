import { describe, expect, it } from "vitest";
import { redactPII, redactTransaction } from "./redact";

describe("redactPII", () => {
  it("strips Spanish IBANs", () => {
    expect(redactPII("My IBAN is ES91 2100 0418 4502 0005 1332")).toContain("[IBAN]");
    expect(redactPII("ES9121000418450200051332")).toContain("[IBAN]");
  });

  it("strips card numbers", () => {
    expect(redactPII("4111 1111 1111 1111 expires soon")).toContain("[CARD]");
    expect(redactPII("5500-0000-0000-0004")).toContain("[CARD]");
  });

  it("strips emails", () => {
    expect(redactPII("contact user@example.com now")).toContain("[EMAIL]");
  });

  it("strips Spanish DNI / NIE", () => {
    expect(redactPII("DNI 12345678Z")).toContain("[ID]");
    expect(redactPII("NIE X1234567L")).toContain("[ID]");
  });

  it("strips postal codes", () => {
    expect(redactPII("Madrid 28001")).toContain("[POSTAL]");
  });

  it("strips phone numbers", () => {
    expect(redactPII("call +34 612 345 678")).toContain("[PHONE]");
  });

  it("preserves non-PII text", () => {
    expect(redactPII("Mercadona 23.45")).toBe("Mercadona 23.45");
  });

  it("handles empty input", () => {
    expect(redactPII("")).toBe("");
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
