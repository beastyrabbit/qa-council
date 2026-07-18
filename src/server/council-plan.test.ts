import { describe, expect, it } from "vitest";
import { aggregatePeerRankings, councilRoundCount, crossReviewPasses } from "./council-plan.js";

describe("kanonischer Council-Plan", () => {
  it("führt genau ein Peer-Review pro eingeladener Rolle aus", () => {
    expect(crossReviewPasses("quick", 1)).toBe(0);
    expect(crossReviewPasses("quick", 2)).toBe(2);
    expect(crossReviewPasses("standard", 4)).toBe(4);
    expect(crossReviewPasses("deep", 5)).toBe(5);
  });

  it("unterscheidet die Modi ausschließlich durch eine, zwei oder drei Abschlussrunden", () => {
    expect(councilRoundCount("quick")).toBe(1);
    expect(councilRoundCount("standard")).toBe(2);
    expect(councilRoundCount("deep")).toBe(3);
  });

  it("behandelt eine Rolle deterministisch und neutral", () => {
    expect(aggregatePeerRankings(["R-a"], [])).toEqual({
      ranking: ["R-a"],
      averageRanks: { "R-a": 1 },
      averageConsensus: 3,
      confidence: "low",
    });
  });

  it("löst den wechselseitigen Gleichstand zweier Rollen über die stabile ID", () => {
    expect(
      aggregatePeerRankings(
        ["R-b", "R-a"],
        [
          { reviewerId: "R-b", ranking: ["R-a"], consensus: 2 },
          { reviewerId: "R-a", ranking: ["R-b"], consensus: 4 },
        ],
      ),
    ).toMatchObject({
      ranking: ["R-a", "R-b"],
      averageRanks: { "R-a": 1, "R-b": 1 },
      averageConsensus: 3,
      confidence: "low",
    });
  });

  it("mittelt erhaltene Ränge und Consensus ab drei Rollen arithmetisch", () => {
    const result = aggregatePeerRankings(
      ["R-a", "R-b", "R-c"],
      [
        { reviewerId: "R-a", ranking: ["R-c", "R-b"], consensus: 5 },
        { reviewerId: "R-b", ranking: ["R-c", "R-a"], consensus: 3 },
        { reviewerId: "R-c", ranking: ["R-a", "R-b"], consensus: 4 },
      ],
    );
    expect(result.ranking).toEqual(["R-c", "R-a", "R-b"]);
    expect(result.averageConsensus).toBe(4);
    expect(result.confidence).toBe("normal");
  });
});
