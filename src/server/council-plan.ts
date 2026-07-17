import type { CouncilMode } from "../shared/types.js";

type ResolvedMode = Exclude<CouncilMode, "auto">;

export function crossReviewPasses(mode: ResolvedMode, reviewCount: number) {
  return mode === "quick" ? 0 : Math.max(3, reviewCount);
}

export function councilResolutionPlan(mode: ResolvedMode, averageConsensus: number) {
  return {
    debate: mode === "deep" || (mode === "standard" && averageConsensus >= 4),
    prosecutorAndDefender: mode === "deep" || (mode === "standard" && averageConsensus >= 4),
    dissentPass: mode !== "quick",
    dualChairmen: mode === "deep",
  };
}
