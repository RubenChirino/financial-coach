import { describe, expect, it } from "vitest";
import { type RuleRow, deriveRulePattern, matchRule } from "./rules";

const r = (
  id: number,
  matchType: RuleRow["matchType"],
  pattern: string,
  categoryId: number,
  priority = 100,
): RuleRow => ({ id, matchType, matchPattern: pattern, categoryId, priority });

describe("matchRule", () => {
  it("matches merchant_exact case-insensitively", () => {
    const rules = [r(1, "merchant_exact", "MERCADONA", 10, 10)];
    const hit = matchRule({ merchantName: "Mercadona", rawDescription: "" }, rules);
    expect(hit?.id).toBe(1);
  });

  it("does not match merchant_exact on partial merchant", () => {
    const rules = [r(1, "merchant_exact", "lidl", 10)];
    const hit = matchRule({ merchantName: "Lidl Supermercado", rawDescription: "" }, rules);
    expect(hit).toBeNull();
  });

  it("matches contains in description when merchant is null", () => {
    const rules = [r(1, "contains", "netflix", 10)];
    const hit = matchRule(
      { merchantName: null, rawDescription: "PAGO TARJETA NETFLIX.COM" },
      rules,
    );
    expect(hit?.id).toBe(1);
  });

  it("matches regex against full haystack", () => {
    const rules = [r(1, "regex", "^pago\\s+(visa|mastercard)", 10)];
    const hit = matchRule(
      { merchantName: null, rawDescription: "PAGO Visa transaccion 1234" },
      rules,
    );
    expect(hit?.id).toBe(1);
  });

  it("ignores malformed regex without throwing", () => {
    const rules = [r(1, "regex", "[unclosed", 10), r(2, "contains", "amazon", 20, 200)];
    const hit = matchRule({ merchantName: "AMAZON ES", rawDescription: "" }, rules);
    expect(hit?.id).toBe(2);
  });

  it("respects priority — lower wins", () => {
    const rules = [r(1, "contains", "shop", 99, 500), r(2, "merchant_exact", "primark", 88, 10)];
    const hit = matchRule(
      { merchantName: "Primark", rawDescription: "Primark shop barcelona" },
      rules,
    );
    expect(hit?.id).toBe(2);
  });

  it("returns null when nothing matches", () => {
    const rules = [r(1, "contains", "ikea", 10)];
    const hit = matchRule({ merchantName: "Random Cafe", rawDescription: "café" }, rules);
    expect(hit).toBeNull();
  });

  it("does not let the zero-commission footer trigger the 'comision' fee rule", () => {
    const rules = [r(1, "contains", "comision", 22, 30)];
    // Every card payment ends with ", Comision 0,00" — it must NOT match fees.
    const hit = matchRule(
      {
        merchantName: "Compra Anthropic Claude Sub, San Francisco",
        rawDescription: "Compra Anthropic Claude Sub, San Francisco, Tarjeta 5489 , Comision 0,00",
      },
      rules,
    );
    expect(hit).toBeNull();
  });

  it("still matches a real, non-zero commission", () => {
    const rules = [r(1, "contains", "comision", 22, 30)];
    const hit = matchRule(
      { merchantName: null, rawDescription: "Comision Mantenimiento Cuenta" },
      rules,
    );
    expect(hit?.id).toBe(1);
  });

  it("handles null merchant for merchant_exact safely", () => {
    const rules = [r(1, "merchant_exact", "anything", 10)];
    const hit = matchRule({ merchantName: null, rawDescription: "anything" }, rules);
    expect(hit).toBeNull();
  });
});

describe("deriveRulePattern", () => {
  it("reduces a noisy description to a lowercase merchant token", () => {
    expect(deriveRulePattern("Compra Mercadona, Madrid", "x")).toBe("mercadona");
  });

  it("falls back to the raw description when no merchant name", () => {
    expect(deriveRulePattern(null, "Compra Netflix.com, Tarjeta 5489")).toBe("netflix.com");
  });

  it("returns null when nothing usable (too short) remains", () => {
    expect(deriveRulePattern("AB", "AB")).toBeNull();
    expect(deriveRulePattern(null, "")).toBeNull();
  });

  it("produces a pattern that matches future transactions via a contains rule", () => {
    const pattern = deriveRulePattern("Compra Mercadona, Madrid", "x");
    expect(pattern).not.toBeNull();
    const rules = [r(1, "contains", pattern as string, 10, 5)];
    const hit = matchRule(
      { merchantName: null, rawDescription: "PAGO TARJETA MERCADONA VALENCIA" },
      rules,
    );
    expect(hit?.id).toBe(1);
  });
});
