import { describe, expect, it } from "vitest";
import { cityKey, explicitCityCountries, parseLocation } from "./parse-location";

describe("parseLocation", () => {
  it("extracts city + country code from the 'City Cc, Tarj' format", () => {
    expect(parseLocation("Pago Movil En Mercadona C/ Fu, Madrid Es, Tarj. :*369261")).toEqual({
      city: "Madrid",
      countryCode: "ES",
    });
    expect(parseLocation("Pago Movil En Pub, London Gb, Tarj. :*1")).toEqual({
      city: "London",
      countryCode: "GB",
    });
  });

  it("extracts city-only from the 'Compra …, City, Tarjeta' format", () => {
    expect(
      parseLocation("Compra Sq *hanso Cafe, Madrid, Tarjeta 5489010555369261 , Comision 0,00"),
    ).toEqual({ city: "Madrid", countryCode: null });
    expect(
      parseLocation("Compra Trattoria, Roma, Tarjeta 5489010555369261 , Comision 0,00"),
    ).toEqual({ city: "Roma", countryCode: null });
  });

  it("returns nothing for transfers and unrecognized text", () => {
    expect(parseLocation("Bizum De Melody Milagros Sanchez Oropesa Concepto Sin Concepto")).toEqual(
      {
        city: null,
        countryCode: null,
      },
    );
    expect(parseLocation("")).toEqual({ city: null, countryCode: null });
  });

  it("rejects truncated Spanish connector words as country codes", () => {
    // "San Miguel De Salinas" truncated → must NOT become Germany (DE).
    expect(parseLocation("Pago Movil En Rest, San Miguel De, Tarj. :*1")).toEqual({
      city: null,
      countryCode: null,
    });
    // A real foreign code is still accepted.
    expect(parseLocation("Pago Movil En Pub, London Gb, Tarj. :*1")).toEqual({
      city: "London",
      countryCode: "GB",
    });
  });

  it("rejects online-store domains as cities", () => {
    expect(parseLocation("Compra Apple, Itunes.com, Tarjeta 5489 , Comision 0,00")).toEqual({
      city: null,
      countryCode: null,
    });
  });

  it("normalizes the cache key", () => {
    expect(cityKey("  San  Francisco ")).toBe("san francisco");
    expect(cityKey("Roma")).toBe("roma");
  });
});

describe("explicitCityCountries", () => {
  it("maps cities seen with an explicit code, taking the most frequent", () => {
    const map = explicitCityCountries([
      { city: "Madrid", countryCode: "ES" },
      { city: "Madrid", countryCode: "ES" },
      { city: "Madrid", countryCode: "XX" },
      { city: "London", countryCode: "GB" },
      { city: "Roma", countryCode: null },
    ]);
    expect(map.get("madrid")).toBe("ES");
    expect(map.get("london")).toBe("GB");
    expect(map.has("roma")).toBe(false);
  });
});
