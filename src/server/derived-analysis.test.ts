import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDerivedAnalysisService,
  TOP10_ANALYSIS_KIND,
  validateTop10Output,
} from "./derived-analysis.js";
import type { PiStageResult } from "./providers.js";

function schema(database: Database.Database) {
  database.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      current_attempt INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE run_stages (
      id TEXT PRIMARY KEY,
      role TEXT
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      stage_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE derived_analyses (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      source_artifact_id TEXT NOT NULL,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      thinking_text TEXT NOT NULL DEFAULT '',
      output_text TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
  `);
}

function addRunSources(database: Database.Database) {
  database
    .prepare("INSERT INTO runs(id, provider, model) VALUES ('run-1', 'codex', 'gpt-test')")
    .run();
  database.prepare("INSERT INTO run_stages(id, role) VALUES ('stage-a', 'Test-Manager')").run();
  database.prepare("INSERT INTO run_stages(id, role) VALUES ('stage-b', 'QA-Architekt')").run();
  const insert = database.prepare(
    `INSERT INTO artifacts(
       id, run_id, stage_id, kind, title, content, sha256, created_at
     ) VALUES (?, 'run-1', ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    "final-a",
    null,
    "final",
    "Finales Ergebnis",
    "# Final\nRisiko R-1 wurde bestätigt.",
    "sha-final",
    "2026-01-01T00:00:03.000Z",
  );
  insert.run(
    "review-a",
    "stage-a",
    "role-review",
    "Einzelreview · Test-Manager",
    "# Review\nGAP-1 bei Abschnitt 4.2.",
    "sha-review-a",
    "2026-01-01T00:00:01.000Z",
  );
  insert.run(
    "review-b",
    "stage-b",
    "role-review",
    "Einzelreview · QA-Architekt",
    "# Review\nR-1 bei Seite 7.",
    "sha-review-b",
    "2026-01-01T00:00:02.000Z",
  );
}

function validTop10(reviewId = "review-a") {
  return Array.from(
    { length: 10 },
    (_, index) => `## ${index + 1}. Schritt ${index + 1}
- **Aktion:** Befund ${index + 1} bearbeiten
- **Evidenz:** ${reviewId} @ Abschnitt 4.2 – GAP-1
- **Owner:** Test-Manager
- **Konkretes Beispiel/Lieferobjekt:** vorgeschlagene Checkliste ${index + 1}
- **Abhängigkeiten:** keine belegt
- **Akzeptanzsignal:** Review dokumentiert die geschlossene Lücke
- **Annahmen:** keine`,
  ).join("\n\n");
}

const databases: Database.Database[] = [];

function testDatabase() {
  const database = new Database(":memory:");
  schema(database);
  addRunSources(database);
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("abgeleitete Top-10-Analyse", () => {
  it("verwendet das finale Artefakt und alle Einzelreviews und persistiert Streams", async () => {
    const database = testDatabase();
    let capturedPrompt = "";
    const runStage = vi.fn(async (options) => {
      capturedPrompt = options.prompt;
      options.onStream?.("thinking", "abwägen ");
      options.onStream?.("text", "Zwischenstand");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        content: validTop10(),
        usage: { input: 100, output: 200, cost: 0 },
        events: [],
        toolCalls: [],
      } satisfies PiStageResult;
    });
    const service = createDerivedAnalysisService({
      database,
      runStage,
      createId: () => "analysis-1",
      streamFlushIntervalMs: 1,
    });

    const started = service.start({ runId: "run-1" });
    expect(started).toMatchObject({
      reused: false,
      job: { id: "analysis-1", status: "queued", kind: TOP10_ANALYSIS_KIND },
    });
    const completed = await service.waitFor(started.job.id);

    expect(completed).toMatchObject({
      status: "ready",
      sourceArtifactId: "final-a",
      thinkingText: "abwägen ",
      outputText: validTop10(),
    });
    expect(completed?.outputHtml).toContain("<h2");
    expect(capturedPrompt).toContain("QUELLE final-a");
    expect(capturedPrompt).toContain("QUELLE review-a");
    expect(capturedPrompt).toContain("QUELLE review-b");
    expect(capturedPrompt).toContain("SHA256 sha-review-b");
    expect(runStage).toHaveBeenCalledTimes(1);
  });

  it("gibt einen bereits aktiven Job idempotent zurück", async () => {
    const database = testDatabase();
    const runStage = vi.fn(
      (options) =>
        new Promise<PiStageResult>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("abgebrochen", "AbortError")),
            { once: true },
          );
        }),
    );
    const service = createDerivedAnalysisService({
      database,
      runStage,
      createId: () => "analysis-active",
    });

    const first = service.start({ runId: "run-1" });
    const second = service.start({ runId: "run-1" });
    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(database.prepare("SELECT COUNT(*) AS count FROM derived_analyses").get()).toEqual({
      count: 1,
    });
    expect(service.cancel(first.job.id)).toBe("cancelled");
    await service.waitFor(first.job.id);
    expect(runStage.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("bricht nur die abgeleitete Analyse ab und ignoriert späte Stream-Deltas", async () => {
    const database = testDatabase();
    const runStage = vi.fn(
      (options) =>
        new Promise<PiStageResult>((_resolve, reject) => {
          options.onStream?.("text", "vor Abbruch");
          options.signal?.addEventListener(
            "abort",
            () => {
              options.onStream?.("text", " DARF NICHT PERSISTIERT WERDEN");
              reject(new DOMException("abgebrochen", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const service = createDerivedAnalysisService({
      database,
      runStage,
      createId: () => "analysis-cancel",
      streamFlushIntervalMs: 1,
    });
    const started = service.start({ runId: "run-1" });
    await new Promise((resolve) => setTimeout(resolve, 2));

    expect(service.cancel(started.job.id)).toBe("cancelled");
    const cancelled = await service.waitFor(started.job.id);

    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.outputText).not.toContain("DARF NICHT");
    expect(
      database.prepare("SELECT id, provider, model FROM runs WHERE id = 'run-1'").get(),
    ).toEqual({ id: "run-1", provider: "codex", model: "gpt-test" });
  });

  it("markiert eine formal unvollständige Modellantwort als fehlgeschlagen", async () => {
    const database = testDatabase();
    const service = createDerivedAnalysisService({
      database,
      runStage: async () => ({
        content: validTop10().replace("## 10.", "### 10."),
        usage: { input: 1, output: 1, cost: 0 },
        events: [],
        toolCalls: [],
      }),
      createId: () => "analysis-invalid",
    });

    const started = service.start({ runId: "run-1" });
    const failed = await service.waitFor(started.job.id);

    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("genau die Überschriften ## 1 bis ## 10");
  });

  it("liest standardmäßig nur die aktuelle Analyse und kann ältere Attempts gezielt öffnen", () => {
    const database = testDatabase();
    database.prepare("UPDATE runs SET current_attempt = 2 WHERE id = 'run-1'").run();
    const insert = database.prepare(
      `INSERT INTO derived_analyses(
         id, run_id, attempt_no, kind, status, provider, model, source_artifact_id,
         source_refs_json, output_text, created_at
       ) VALUES (?, 'run-1', ?, ?, 'ready', 'codex', 'gpt-test', 'final-a', '[]', ?, ?)`,
    );
    insert.run("analysis-old", 1, TOP10_ANALYSIS_KIND, "Alter Versuch", "2026-01-01T00:00:01.000Z");
    insert.run(
      "analysis-current",
      2,
      TOP10_ANALYSIS_KIND,
      "Aktueller Versuch",
      "2026-01-01T00:00:02.000Z",
    );
    const service = createDerivedAnalysisService({ database });

    expect(service.getLatest("run-1")?.id).toBe("analysis-current");
    expect(service.getLatest("run-1", TOP10_ANALYSIS_KIND, 1)?.id).toBe("analysis-old");
  });
});

describe("Top-10-Ausgabevertrag", () => {
  it("akzeptiert exakt zehn vollständig belegte Schritte", () => {
    expect(validateTop10Output(validTop10(), ["review-a"])).toEqual([]);
  });

  it("weist fehlende Einzelreview-IDs und Pflichtfelder zurück", () => {
    const invalid = validTop10("unbekannt").replace(
      "- **Akzeptanzsignal:** Review dokumentiert die geschlossene Lücke",
      "- **Signal:** erledigt",
    );
    expect(validateTop10Output(invalid, ["review-a"])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Pflichtfeld "Akzeptanzsignal" fehlt'),
        expect.stringContaining("keine Einzelreview-ID"),
      ]),
    );
  });
});
