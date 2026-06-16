import { describe, expect, it } from "vitest";
import { currencyToCountry } from "./currency-country";

describe("currencyToCountry", () => {
  it("maps well-known single-country currencies", () => {
    expect(currencyToCountry("GBP")).toMatchObject({
      country: "United Kingdom",
      isAmbiguous: false,
    });
    expect(currencyToCountry("JPY")).toMatchObject({ country: "Japan", isAmbiguous: false });
    expect(currencyToCountry("THB").flag).toBe("🇹🇭");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(currencyToCountry(" gbp ").country).toBe("United Kingdom");
  });

  it("flags multi-country currencies as ambiguous", () => {
    expect(currencyToCountry("EUR").isAmbiguous).toBe(true);
    expect(currencyToCountry("USD").isAmbiguous).toBe(true);
  });

  it("falls back to a globe + the raw code for unknown currencies", () => {
    const r = currencyToCountry("XYZ");
    expect(r.country).toBe("XYZ");
    expect(r.flag).toBe("🌍");
    expect(r.isAmbiguous).toBe(true);
  });
});
