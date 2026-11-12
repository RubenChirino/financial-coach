import { describe, expect, it } from "vitest";
import { monthRange } from "./dates";
import { splitRow } from "./import/split-row";
import { normalizeMerchant } from "./merchant";
import { mean, median, stdDev } from "./stats";

describe("shared helpers", () => {
  it("monthRange crosses year boundaries in UTC", () => {
    const now = new Date(Date.UTC(2026, 0, 15, 23, 30));
    expect(monthRange(-1, now)).toEqual({
      start: new Date(Date.UTC(2025, 11, 1)),
      end: new Date(Date.UTC(2026, 0, 1)),
      label: "2025-12",
    });
    expect(monthRange(0, now).label).toBe("2026-01");
  });

  it("stats", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(mean([])).toBe(0);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(stdDev([1])).toBe(0);
  });

  it("normalizeMerchant groups the same merchant", () => {
    expect(normalizeMerchant("NETFLIX  SL 20260105")).toBe(normalizeMerchant("Netflix"));
  });

  it("splitRow keeps quoted delimiters and doubled quotes; comma by default", () => {
    expect(splitRow('a,"b,c","say ""hi"""')).toEqual(["a", "b,c", 'say "hi"']);
    expect(splitRow("a;b", ";")).toEqual(["a", "b"]);
  });
});
