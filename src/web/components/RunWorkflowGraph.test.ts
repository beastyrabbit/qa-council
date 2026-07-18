import { describe, expect, it } from "vitest";
import { workflowPhaseForStage } from "./RunWorkflowGraph.js";

describe("Ablaufgrafik", () => {
  it.each([
    ["Dokumentextraktion", "extraction"],
    ["Dokumentweite Voranalyse", "evidence"],
    ["QA-Architekt · RACI-Routing", "routing"],
    ["Einzelreview · Tester", "role-reviews"],
    ["Cross-Review · Tester", "peer-reviews"],
    ["Council · gemeinsames Review", "joint-review"],
    ["Council-Debatte · Ankläger", "debate"],
    ["Council-Runde 1 · Tester", "council-rounds"],
    ["Dissens-Audit", "synthesis"],
    ["Report-Build · Visual Report", "reports"],
  ])("ordnet %s der Phase %s zu", (stageName, phase) => {
    expect(workflowPhaseForStage(stageName)).toBe(phase);
  });

  it("ordnet unbekannte Stufen keiner falschen Phase zu", () => {
    expect(workflowPhaseForStage("Unbekannte Stufe")).toBeNull();
  });
});
