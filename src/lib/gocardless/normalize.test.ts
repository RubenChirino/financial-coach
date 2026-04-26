import { describe, expect, it } from "vitest";
import { normalizeTransaction, pickPrimaryBalance, toCents } from "./normalize";
import type { GoCardlessTransaction } from "./types";

describe("toCents", () => {
  it("parses positive integers", () => {
    expect(toCents("42")).toBe(4200);
  });
  it("parses negatives", () => {
    expect(toCents("-12.34")).toBe(-1234);
  });
  it("preserves sub-cent rounding toward truncation", () => {
    expect(toCents("1.999")).toBe(199);
  });
  it("handles missing fractional part", () => {
    expect(toCents("7")).toBe(700);
    expect(toCents("-7")).toBe(-700);
  });
  it("rejects malformed input", () => {
    expect(() => toCents("foo")).toThrow();
    expect(() => toCents("1,23")).toThrow();
    expect(() => toCents("")).toThrow();
  });
});

describe("normalizeTransaction", () => {
  const baseTx: GoCardlessTransaction = {
    transactionId: "TX-001",
    bookingDate: "2025-03-15",
    valueDate: "2025-03-16",
    transactionAmount: { amount: "-25.40", currency: "EUR" },
    creditorName: "Mercadona",
    remittanceInformationUnstructured: "Compra tarjeta ****0000",
  };

  it("returns null without a booking date", () => {
    expect(normalizeTransaction({ ...baseTx, bookingDate: undefined }, "acc")).toBeNull();
  });

  it("uses transactionId for externalId when present", () => {
    const n = normalizeTransaction(baseTx, "acc")!;
    expect(n.externalId).toBe("TX-001");
    expect(n.amountCents).toBe(-2540);
    expect(n.currency).toBe("EUR");
    expect(n.merchantName).toBe("Mercadona");
    expect(n.rawDescription).toContain("Mercadona");
    expect(n.rawDescription).toContain("Compra tarjeta");
  });

  it("falls back to internalTransactionId then to synthetic id", () => {
    const withInternal = normalizeTransaction(
      { ...baseTx, transactionId: undefined, internalTransactionId: "I-42" },
      "acc",
    )!;
    expect(withInternal.externalId).toBe("I-42");

    const synthetic = normalizeTransaction(
      { ...baseTx, transactionId: undefined, internalTransactionId: undefined },
      "acc-123",
    )!;
    expect(synthetic.externalId.startsWith("acc-123:2025-03-15:-25.40")).toBe(true);
  });

  it("for inflows uses debtorName as merchant", () => {
    const inflow = normalizeTransaction(
      {
        ...baseTx,
        creditorName: undefined,
        debtorName: "Empresa S.L.",
        transactionAmount: { amount: "1800.00", currency: "EUR" },
      },
      "acc",
    )!;
    expect(inflow.amountCents).toBe(180000);
    expect(inflow.merchantName).toBe("Empresa S.L.");
  });

  it("joins array remittance info", () => {
    const n = normalizeTransaction(
      {
        ...baseTx,
        remittanceInformationUnstructured: undefined,
        remittanceInformationUnstructuredArray: ["Línea 1", "Línea 2"],
      },
      "acc",
    )!;
    expect(n.rawDescription).toContain("Línea 1");
    expect(n.rawDescription).toContain("Línea 2");
  });
});

describe("pickPrimaryBalance", () => {
  it("prefers closingBooked", () => {
    const picked = pickPrimaryBalance([
      { balanceType: "expected" },
      { balanceType: "closingBooked" },
      { balanceType: "interimBooked" },
    ]);
    expect(picked?.balanceType).toBe("closingBooked");
  });
  it("falls back to first when no priority type matches", () => {
    const picked = pickPrimaryBalance([{ balanceType: "weird" }]);
    expect(picked?.balanceType).toBe("weird");
  });
  it("returns null on empty", () => {
    expect(pickPrimaryBalance([])).toBeNull();
  });
});
