import type { CouncilMode } from "../shared/types.js";

type ResolvedMode = Exclude<CouncilMode, "auto">;

export function crossReviewPasses(mode: ResolvedMode, reviewCount: number) {
  void mode;
  return reviewCount < 2 ? 0 : reviewCount;
}

export function councilRoundCount(mode: ResolvedMode) {
  return mode === "quick" ? 1 : mode === "standard" ? 2 : 3;
}

export interface PeerRanking {
  reviewerId: string;
  ranking: string[];
  consensus: number;
}

export function aggregatePeerRankings(reviewIds: string[], submissions: PeerRanking[]) {
  if (reviewIds.length === 1) {
    return {
      ranking: [...reviewIds],
      averageRanks: Object.fromEntries(reviewIds.map((id) => [id, 1])),
      averageConsensus: 3,
      confidence: "low" as const,
    };
  }
  const ranks = new Map(reviewIds.map((id) => [id, [] as number[]]));
  for (const submission of submissions) {
    submission.ranking.forEach((id, index) => {
      ranks.get(id)?.push(index + 1);
    });
  }
  const averageRanks = Object.fromEntries(
    reviewIds.map((id) => {
      const values = ranks.get(id) ?? [];
      return [id, values.length ? values.reduce((sum, rank) => sum + rank, 0) / values.length : 0];
    }),
  );
  return {
    ranking: [...reviewIds].sort(
      (left, right) => averageRanks[left] - averageRanks[right] || left.localeCompare(right),
    ),
    averageRanks,
    averageConsensus:
      submissions.length > 0
        ? submissions.reduce((sum, item) => sum + item.consensus, 0) / submissions.length
        : 3,
    confidence: reviewIds.length === 2 ? ("low" as const) : ("normal" as const),
  };
}
