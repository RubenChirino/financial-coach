import { describe, expect, it } from "vitest";
import { decimalToCents, normalizeTrueLayerTransaction } from "./normalize";
import type { TrueLayerTransaction } from "./types";

describe("decimalToCents", () => {
  it("parses positive decimals", () => {
    expect(decimalToCents("12.34")).toBe(1234);
    expect(decimalToCents(12.34)).toBe(1234);
  });
  it("parses negative decimals", () => {
    expect(decimalToCents("-7.05")).toBe(-705);
  });
  it("handles missing fraction", () => {
    expect(decimalToCents("50")).toBe(5000);
  });
  it("handles single decimal digit", () => {
    expect(decimalToCents("3.5")).toBe(350);
  });
  it("rejects junk input", () => {
    expect(() => decimalToCents("abc")).toThrow();
  });
});

function makeTx(overrides: Partial<TrueLayerTransaction> = {}): TrueLayerTransaction {
  return {
    transaction_id: "tx-1",
    timestamp: "2026-04-01T09:30:00Z",
    description: "TESCO STORES",
    amount: -12.34,
    currency: "GBP",
    transaction_type: "DEBIT",
    merchant_name: "Tesco",
    ...overrides,
  };
}

describe("normalizeTrueLayerTransaction", () => {
  it("normalizes a standard debit", () => {
    const n = normalizeTrueLayerTransaction(makeTx(), "acc-1");
    expect(n).not.toBeNull();
    expect(n?.amountCents).toBe(-1234);
    expect(n?.currency).toBe("GBP");
    expect(n?.merchantName).toBe("Tesco");
    expect(n?.rawDescription).toBe("TESCO STORES");
    expect(n?.externalId).toBe("tl_tx-1");
  });

  it("flips sign when transaction_type=DEBIT but amount is positive", () => {
    const n = normalizeTrueLayerTransaction(
      makeTx({ amount: 12.34, transaction_type: "DEBIT" }),
      "acc-1",
    );
    expect(n?.amountCents).toBe(-1234);
  });

  it("treats CREDIT as positive regardless of input sign", () => {
    const n = normalizeTrueLayerTransaction(
      makeTx({ amount: -50, transaction_type: "CREDIT" }),
      "acc-1",
    );
    expect(n?.amountCents).toBe(5000);
  });

  it("falls back to a synthetic external id when no id fields are present", () => {
    const n = normalizeTrueLayerTransaction(
      makeTx({ transaction_id: undefined, provider_transaction_id: undefined }),
      "acc-1",
    );
    expect(n?.externalId).toContain("tl_acc-1");
  });

  it("returns null when timestamp or amount is missing", () => {
    expect(normalizeTrueLayerTransaction(makeTx({ timestamp: "" }), "a")).toBeNull();
    // @ts-expect-error — forcing invalid shape for the guard
    expect(normalizeTrueLayerTransaction({ ...makeTx(), amount: undefined }, "a")).toBeNull();
  });
});
