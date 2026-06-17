import { describe, expect, it } from "vitest";
import { isOnlinePayment } from "./online-merchants";

describe("isOnlinePayment", () => {
  it("flags online charges that embed the merchant's billing city", () => {
    const online = [
      "Compra Anthropic, San Francisco, Tarjeta 5489 , Comision 0,00",
      "Compra Anthropic* Claude Sub, San Francisco, Tarjeta 5489 , Comision 0,00",
      "Compra Amazon Prime*d97w40wd3, Seattle, Tarjeta 5489 , Comision 0,00",
      "Devolucion Compra En Amazon Prime Pmts, Seattle",
      "Compra Omio *omio, Berlin, Tarjeta 5489 , Comision 0,00",
      "Compra Apple.com/bill, Cork, Tarjeta 5489 , Comision 0,00",
      "Compra Openai *chatgpt Subscr, Dublin, Tarjeta 5489 , Comision 0,00",
      "Compra Amazon* R856q30a4, Luxembourg, Tarjeta 5489 , Comision 0,00",
    ];
    for (const d of online) {
      expect(isOnlinePayment(d, d), d).toBe(true);
    }
  });

  it("does NOT flag genuine in-person spending abroad", () => {
    const inPerson = [
      "Compra Trattoria Da Mario, Roma, Tarjeta 5489 , Comision 0,00",
      "Pago Movil En Sncf Gare, Hendaye Fr, Tarj. :*1",
      "Compra Pub The Oliver, Cork City, Tarjeta 5489 , Comision 0,00",
    ];
    for (const d of inPerson) {
      expect(isOnlinePayment(d, d), d).toBe(false);
    }
  });

  it("matches whole words only (no substring false positives)", () => {
    // "uber" must not fire inside an unrelated word.
    expect(isOnlinePayment("Compra Cubertura Restaurante, Roma", "x")).toBe(false);
  });
});
