import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { excelToCsv } from "./excel";

const serial = (y: number, m: number, d: number) =>
  (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;

/** A bank-export-shaped sheet with every cell kind the converter handles. */
function workbook(bookType: "xlsx" | "biff8"): Uint8Array {
  const ws: XLSX.WorkSheet = {
    "!ref": "A1:E5",
    A1: { t: "s", v: "Fecha" },
    B1: { t: "s", v: "Concepto" },
    C1: { t: "s", v: "Importe" },
    D1: { t: "s", v: "Hora" },
    // A date cell with a Spanish display format: written as ISO, not as shown.
    A2: { t: "n", v: serial(2026, 1, 5), z: "dd/mm/yyyy" },
    B2: { t: "s", v: 'Compra "Mercadona", Madrid' },
    C2: { t: "n", v: -1234.5, z: "#,##0.00 €" },
    D2: { t: "n", v: 0.5, z: "hh:mm:ss" },
    // Row 3 is empty and must not produce a line.
    A4: { t: "n", v: serial(2026, 12, 31) + 0.75, z: "yyyy-mm-dd hh:mm" },
    B4: { t: "s", v: "Nómina" },
    C4: { t: "n", v: 2500, f: "2000+500" },
    E4: { t: "b", v: true },
    A5: { t: "e", v: 42, w: "#N/A" },
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
}

describe("excelToCsv", () => {
  for (const bookType of ["xlsx", "biff8"] as const) {
    it(`writes underlying values the CSV parsers accept (${bookType === "biff8" ? ".xls" : ".xlsx"})`, async () => {
      const res = await excelToCsv(workbook(bookType));
      expect(res).toEqual({
        ok: true,
        csv: [
          "Fecha,Concepto,Importe,Hora",
          '2026-01-05,"Compra ""Mercadona"", Madrid",-1234.5,12:00:00',
          "2026-12-31,Nómina,2500,,true",
          "#N/A",
        ].join("\n"),
      });
    });
  }

  it("does not shift dates in a timezone east of UTC", async () => {
    const tz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    try {
      const res = await excelToCsv(workbook("xlsx"));
      expect(res.ok && res.csv.split("\n")[1]?.startsWith("2026-01-05,")).toBe(true);
    } finally {
      process.env.TZ = tz;
    }
  });

  it("reports a corrupt workbook", async () => {
    const good = workbook("xlsx");
    const corrupt = good.slice(0, Math.floor(good.length / 2));
    const res = await excelToCsv(corrupt);
    expect(res).toEqual({ ok: false, error: "parseFailed" });
  });
});
