import type { CouncilMode } from "../shared/types.js";

type ResolvedMode = Exclude<CouncilMode, "auto">;

export function crossReviewPasses(mode: ResolvedMode, reviewCount: number) {
  void mode;
  return Math.max(3, reviewCount);
}

export function councilRoundCount(mode: ResolvedMode) {
  return mode === "quick" ? 1 : mode === "standard" ? 2 : 3;
}
