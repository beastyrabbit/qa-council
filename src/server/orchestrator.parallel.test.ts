import { describe, expect, it } from "vitest";
import { createDatabase, withDatabase } from "./db/index.js";
import {
  attachToolCallsToStage,
  buildLargeDocumentRoleReviewWorkItems,
  settleParallel,
} from "./orchestrator.js";
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
      appVersion: "test",
      analysisVersion: "test/retrieval@1",
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

describe("getrennte Cross-Review-Ausgaben", () => {
  it("verknüpft den tool-only Ranking-Submit mit der Markdown-Kritik", () => {
    const database = createDatabase(":memory:");
    try {
      database.exec(`
        INSERT INTO documents(
          id, name, mime_type, size, sha256, original, status, created_at
        ) VALUES ('doc', 'x.md', 'text/markdown', 1, 'hash', X'78', 'ready', 'now');
        INSERT INTO runs(
          id, document_id, provider, model, mode, presentation, status, created_at, current_attempt
        ) VALUES ('run', 'doc', 'codex', 'model', 'quick', 'text', 'running', 'now', 1);
        INSERT INTO run_attempts(run_id, attempt_no, status, started_at)
        VALUES ('run', 1, 'running', 'now');
        INSERT INTO run_stages(
          id, run_id, attempt_no, name, role, status, output_text, started_at, completed_at
        ) VALUES (
          'critique', 'run', 1, 'Cross-Review · Tester', 'Tester', 'completed',
          '## Kritik', 'now', 'now'
        );
        INSERT INTO artifacts(
          id, run_id, attempt_no, stage_id, kind, logical_key, title,
          content_type, content, sha256, metadata, created_at
        ) VALUES (
          'artifact', 'run', 1, 'critique', 'cross-review', 'cross-review:Tester',
          'Cross-Review · Tester', 'text/markdown', '## Kritik', 'sha',
          '{"promptHash":"prompt"}', 'now'
        );
      `);
      const toolCalls = [
        {
          name: "submit_peer_review",
          callId: "call-1",
          args: { ranking: ["R-1"], consensus: 4 },
        },
      ];

      withDatabase(database, () =>
        attachToolCallsToStage("run", 1, "critique", toolCalls, "ranking-stage"),
      );

      const row = database
        .prepare("SELECT content, metadata FROM artifacts WHERE id = 'artifact'")
        .get() as { content: string; metadata: string };
      expect(row.content).toBe("## Kritik");
      expect(JSON.parse(row.metadata)).toMatchObject({
        promptHash: "prompt",
        toolCalls,
        rankingStageId: "ranking-stage",
      });
    } finally {
      database.close();
    }
  });
});
