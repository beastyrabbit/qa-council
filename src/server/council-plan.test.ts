import { describe, expect, it } from "vitest";
import { councilRoundCount, crossReviewPasses } from "./council-plan.js";

describe("kanonischer Council-Plan", () => {
  it("führt in jedem Modus mindestens drei unabhängige Cross-Reviews aus", () => {
    expect(crossReviewPasses("quick", 2)).toBe(3);
    expect(crossReviewPasses("standard", 4)).toBe(4);
    expect(crossReviewPasses("deep", 5)).toBe(5);
  });

  it("unterscheidet die Modi ausschließlich durch eine, zwei oder drei Abschlussrunden", () => {
    expect(councilRoundCount("quick")).toBe(1);
    expect(councilRoundCount("standard")).toBe(2);
    expect(councilRoundCount("deep")).toBe(3);
  });
});
