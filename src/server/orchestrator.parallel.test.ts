import { describe, expect, it } from "vitest";
import { buildLargeDocumentRoleReviewWorkItems, settleParallel } from "./orchestrator.js";
import type { CompiledRoleAssignment } from "./raci.js";
import type { RetrievalDossier } from "./retrieval.js";

describe("settleParallel", () => {
  it("bricht Geschwisteraufrufe nach dem ersten endgültigen Fehler ab", async () => {
    let siblingAborted = false;

    await expect(
      settleParallel([
        async () => {
          throw new Error("fatal");
        },
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                siblingAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      ]),
    ).rejects.toThrow("fatal");

    expect(siblingAborted).toBe(true);
  });
});

describe("dokumentweite Rollenreviews", () => {
  it("erzeugt genau einen angereicherten Review-Auftrag je RACI-Rolle", () => {
    const assignments: CompiledRoleAssignment[] = [
      {
        role: "Test-Manager",
        participation: "full",
        mandates: [
          {
            activityId: "2.1",
            activity: "Teststrategie",
            responsibility: "A",
            trigger: "Konzept liegt vor",
            triggerStatus: "satisfied",
            missingInputs: [],
            expectedArtifact: "Review",
            evidence: ["Kapitel 1"],
            rationale: "Management-Verantwortung",
          },
        ],
      },
      {
        role: "Tester",
        participation: "consulted",
        mandates: [
          {
            activityId: "2.1",
            activity: "Teststrategie",
            responsibility: "C",
            trigger: "Konzept liegt vor",
            triggerStatus: "satisfied",
            missingInputs: [],
            expectedArtifact: "Review",
            evidence: ["Kapitel 1"],
            rationale: "Umsetzbarkeit",
          },
        ],
      },
    ];
    const dossier: RetrievalDossier = {
      version: 1,
      documentId: "doc",
      embedding: {
        status: "ready",
        model: "test-embedding",
        dimensions: 2,
      },
      chunks: [
        {
          chunkId: "chunk-1",
          position: 0,
          locator: "Kapitel 1 · Zeilen 1–20",
          sha256: "hash-1",
          activities: [
            {
              activityId: "2.1",
              activity: "Teststrategie",
              score: 1,
              coreRoles: ["Test-Manager"],
              consultantRoles: ["Tester"],
            },
          ],
          neighbors: [],
          excerpts: ["Priorität 1 ist hoch."],
          exactTerms: ["priorität"],
        },
        {
          chunkId: "chunk-2",
          position: 1,
          locator: "Kapitel 20 · Zeilen 400–420",
          sha256: "hash-20",
          activities: [],
          neighbors: [
            {
              chunkId: "chunk-1",
              locator: "Kapitel 1 · Zeilen 1–20",
              score: 0.9,
              reasons: ["exakter Begriff: priorität"],
            },
          ],
          excerpts: ["Priorität 20 ist ebenfalls hoch."],
          exactTerms: ["priorität"],
        },
      ],
      cards: [],
      markdown: "",
      relationshipManifest: "",
    };

    const workItems = buildLargeDocumentRoleReviewWorkItems(
      assignments,
      dossier,
      "1. Kapitel 1\n2. Kapitel 20",
    );

    expect(workItems).toHaveLength(assignments.length);
    expect(workItems.map((item) => item.name)).toEqual([
      "Einzelreview · Test-Manager",
      "Einzelreview · Tester",
    ]);
    for (const item of workItems) {
      expect(item.prompt).toContain("genau ein zusammenhängendes Review");
      expect(item.prompt).toContain("keine separaten Chunk-Reviews");
      expect(item.prompt).toContain("Kapitel 1 · Zeilen 1–20");
      expect(item.prompt).toContain("Kapitel 20 · Zeilen 400–420");
      expect(item.prompt).not.toContain("Einzelreview · Test-Manager · Teil");
    }
  });
});
