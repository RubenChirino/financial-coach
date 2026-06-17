import { describe, expect, it } from "vitest";
import { countryName, countryOptions, currencyToCountryCode, flagFromCode } from "./countries";

describe("flagFromCode", () => {
  it("builds a flag emoji from a 2-letter code", () => {
    expect(flagFromCode("ES")).toBe("🇪🇸");
    expect(flagFromCode("gb")).toBe("🇬🇧");
  });
  it("falls back to a globe for invalid codes", () => {
    expect(flagFromCode("XYZ")).toBe("🌍");
    expect(flagFromCode("")).toBe("🌍");
  });
});

describe("countryName", () => {
  it("localizes the country name", () => {
    expect(countryName("ES", "en")).toBe("Spain");
    expect(countryName("FR", "es")).toBe("Francia");
  });
  it("falls back to the raw code when invalid", () => {
    expect(countryName("ZZ9", "en")).toBe("ZZ9");
  });
});

describe("currencyToCountryCode", () => {
  it("maps common travel currencies", () => {
    expect(currencyToCountryCode("GBP")).toBe("GB");
    expect(currencyToCountryCode("jpy")).toBe("JP");
  });
  it("returns null for unknown currencies", () => {
    expect(currencyToCountryCode("EUR")).toBeNull();
    expect(currencyToCountryCode("ZZZ")).toBeNull();
  });
});

describe("countryOptions", () => {
  it("returns sorted code+name options", () => {
    const opts = countryOptions("en");
    expect(opts.length).toBeGreaterThan(10);
    expect(opts.every((o) => /^[A-Z]{2}$/.test(o.code) && o.name.length > 0)).toBe(true);
    const names = opts.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });
});
