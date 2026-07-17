import { describe, expect, it } from "vitest";
import { councilResolutionPlan, crossReviewPasses } from "./council-plan.js";

describe("kanonischer Council-Plan", () => {
  it("führt Quick mit mindestens zwei Reviews, aber ohne Peer- oder Dissens-Pass", () => {
    expect(crossReviewPasses("quick", 2)).toBe(0);
    expect(councilResolutionPlan("quick", 5)).toEqual({
      debate: false,
      prosecutorAndDefender: false,
      dissentPass: false,
      dualChairmen: false,
    });
  });

  it("erzwingt in Standard mindestens drei anonymisierte Cross-Review-Pässe", () => {
    expect(crossReviewPasses("standard", 2)).toBe(3);
    expect(councilResolutionPlan("standard", 3.9).debate).toBe(false);
    expect(councilResolutionPlan("standard", 4).prosecutorAndDefender).toBe(true);
    expect(councilResolutionPlan("standard", 3).dissentPass).toBe(true);
  });

  it("plant Deep mit fünf Cross-Reviews, Pro/Contra, Dual-Chairman und Dissens-Pass", () => {
    expect(crossReviewPasses("deep", 5)).toBe(5);
    expect(councilResolutionPlan("deep", 1)).toEqual({
      debate: true,
      prosecutorAndDefender: true,
      dissentPass: true,
      dualChairmen: true,
    });
  });
});
