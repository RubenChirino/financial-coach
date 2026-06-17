import { describe, expect, it } from "vitest";
import { cleanMerchant, keywordCategory } from "./heuristics";

describe("cleanMerchant", () => {
  it("strips the Spanish-bank boilerplate down to the merchant", () => {
    expect(
      cleanMerchant(
        "Compra Sq *hanso Cafe, Madrid, Tarjeta 5489010555369261 , Comision 0,00",
        "Compra Sq *hanso Cafe, Madrid, Tarjeta 5489010555369261 , Comision 0,00",
      ),
    ).toBe("hanso Cafe");

    expect(
      cleanMerchant(
        "Compra Anthropic* Claude Sub, San Francisco, Tarjeta 5489010555369261 , Comision 0,00",
        "x",
      ),
    ).toBe("Anthropic Claude Sub");

    expect(cleanMerchant("Pago Movil En Mercadona C/ Fu, Madrid Es, Tarj. :*369261", "x")).toBe(
      "Mercadona C/ Fu",
    );
  });

  it("never leaves the commission/card noise that skews toward bank fees", () => {
    const out = cleanMerchant("Compra Foo, Madrid, Tarjeta 123456 , Comision 0,00", "x");
    expect(out.toLowerCase()).not.toContain("comision");
    expect(out.toLowerCase()).not.toContain("tarjeta");
  });
});

describe("keywordCategory", () => {
  it("maps known subscriptions (the Claude/Anthropic mis-categorization)", () => {
    expect(keywordCategory("Anthropic Claude Sub", -2178)).toBe("subscriptions");
    expect(keywordCategory("Netflix", -1199)).toBe("subscriptions");
    expect(keywordCategory("Spotify AB", -999)).toBe("subscriptions");
  });

  it("maps cafés to coffee, not fees", () => {
    expect(keywordCategory("hanso Cafe", -1580)).toBe("coffee");
    expect(keywordCategory("Starbucks", -450)).toBe("coffee");
  });

  it("maps common Spanish merchants", () => {
    expect(keywordCategory("Mercadona C/ Fu", -2593)).toBe("groceries");
    expect(keywordCategory("Uber Trip", -1200)).toBe("transport");
    expect(keywordCategory("Repsol", -6000)).toBe("fuel");
  });

  it("returns null for unknown merchants (falls back to the LLM)", () => {
    expect(keywordCategory("Random Local Shop", -1000)).toBeNull();
  });

  it("matches whole words only — no substring false positives", () => {
    // "consum" must not fire inside "Consumer".
    expect(keywordCategory("Caixabank Payments Consumer", -500)).toBeNull();
    // …but the real Consum supermarket still matches.
    expect(keywordCategory("Consum Soc Coop", -3200)).toBe("groceries");
    // "Dia" supermarket matches, "media"/"guardia" do not.
    expect(keywordCategory("Dia 18210", -2593)).toBe("groceries");
    expect(keywordCategory("Media Markt", -9900)).toBeNull();
  });

  it("end-to-end: a noisy Claude charge resolves to subscriptions", () => {
    const cleaned = cleanMerchant(
      "Compra Anthropic* Claude Sub, San Francisco, Tarjeta 5489010555369261 , Comision 0,00",
      "x",
    );
    expect(keywordCategory(cleaned, -2178)).toBe("subscriptions");
  });
});
