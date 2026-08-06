import { describe, expect, it } from "vitest";
import { escapeCsvCell, neutralizeFormula } from "./csv-escape";

describe("neutralizeFormula", () => {
  it("leaves ordinary text alone", () => {
    expect(neutralizeFormula("Mercadona")).toBe("Mercadona");
    expect(neutralizeFormula("")).toBe("");
    expect(neutralizeFormula("Café & Té")).toBe("Café & Té");
  });

  it("neutralizes every spreadsheet formula lead-in", () => {
    expect(neutralizeFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeFormula("+1+2")).toBe("'+1+2");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("\tcmd")).toBe("'\tcmd");
    expect(neutralizeFormula("\rcmd")).toBe("'\rcmd");
  });

  it("neutralizes the classic command-execution payload", () => {
    expect(neutralizeFormula(`=cmd|'/C calc'!A0`)).toBe(`'=cmd|'/C calc'!A0`);
    expect(neutralizeFormula("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
  });

  it("keeps plain numbers numeric so amount columns still sum", () => {
    expect(neutralizeFormula("-1250")).toBe("-1250");
    expect(neutralizeFormula("-12.50")).toBe("-12.50");
    expect(neutralizeFormula("-12,50")).toBe("-12,50");
    expect(neutralizeFormula("+42")).toBe("+42");
  });
});

describe("escapeCsvCell", () => {
  it("quotes only when a delimiter, quote or newline is present", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("honours extra delimiters", () => {
    expect(escapeCsvCell("a;b")).toBe("a;b");
    expect(escapeCsvCell("a;b", ";")).toBe('"a;b"');
  });

  it("neutralizes before quoting, so the guard survives the quotes", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil","click")')).toBe(
      `"'=HYPERLINK(""http://evil"",""click"")"`,
    );
  });
});
