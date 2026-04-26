import { describe, expect, it } from "vitest";
import { type RuleRow, matchRule } from "./rules";

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

  it("handles null merchant for merchant_exact safely", () => {
    const rules = [r(1, "merchant_exact", "anything", 10)];
    const hit = matchRule({ merchantName: null, rawDescription: "anything" }, rules);
    expect(hit).toBeNull();
  });
});
