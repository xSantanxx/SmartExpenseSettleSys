import { describe, expect, it } from "vitest";
import {
  centsToDollars,
  dollarsToCents,
  MoneyError,
  splitEvenly,
} from "./money.js";

describe("dollarsToCents", () => {
  it("converts common amounts", () => {
    expect(dollarsToCents("12.34")).toBe(1234);
    expect(dollarsToCents(12.34)).toBe(1234);
    expect(dollarsToCents("0.01")).toBe(1);
    expect(dollarsToCents("100")).toBe(10000);
  });

  it("handles the classic floating-point traps via string path", () => {
    // 0.1 + 0.2 in JS is not 0.3, but parsing "0.30" is exact.
    expect(dollarsToCents("0.30")).toBe(30);
    expect(dollarsToCents("0.1") + dollarsToCents("0.2")).toBe(30);
  });

  it("rejects more than 2 decimal places", () => {
    expect(() => dollarsToCents("1.234")).toThrow(MoneyError);
  });
});

describe("centsToDollars", () => {
  it("formats with two decimals", () => {
    expect(centsToDollars(1234)).toBe("12.34");
    expect(centsToDollars(100)).toBe("1.00");
    expect(centsToDollars(5)).toBe("0.05");
    expect(centsToDollars(-4550)).toBe("-45.50");
  });
});

describe("splitEvenly", () => {
  it("distributes remainder cents so the sum is exact", () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(100, 4)).toEqual([25, 25, 25, 25]);
    expect(splitEvenly(1, 3)).toEqual([1, 0, 0]);
  });
});
