import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase, withDatabase } from "./db/index.js";
import {
  completeCheckpoint,
  PIPELINE_PHASES,
  type PipelinePhase,
  restartRun,
} from "./orchestrator.js";

let database: SqliteDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function seedCheckpointRun() {
  database = createDatabase(":memory:");
  database.exec(`
    INSERT INTO documents(
      id, name, mime_type, size, sha256, original, status, extracted_text,
      extraction_complete, created_at
    ) VALUES (
      'doc', 'Prüfung.md', 'text/markdown', 4, 'document-sha', X'74657374',
      'ready', 'test', 1, 'now'
    );
    INSERT INTO document_chunks(id, document_id, position, locator, content, sha256)
    VALUES ('chunk', 'doc', 0, 'Prüfung.md · Zeilen 1–1', 'test', 'chunk-sha');
    INSERT INTO runs(
      id, document_id, provider, model, mode, presentation, status, error,
      created_at, completed_at, current_attempt
    ) VALUES (
      'run', 'doc', 'codex', 'gpt-5.5', 'quick', 'text', 'failed', 'kaputt',
      'now', 'now', 1
    );
    INSERT INTO run_attempts(
      run_id, attempt_no, status, started_at, completed_at, error
    ) VALUES ('run', 1, 'failed', 'now', 'now', 'kaputt');
  `);
  const insertOutput = database.prepare(
    `INSERT INTO artifacts(
       id, run_id, attempt_no, kind, title, content_type, content, sha256, created_at
     ) VALUES (?, 'run', 1, 'checkpoint-output', ?, 'application/json', '{}', ?, 'now')`,
  );
  for (const phase of PIPELINE_PHASES) {
    insertOutput.run(`${phase}-output`, phase, `${phase}-sha`);
  }
  return database;
}

function runRow(db: SqliteDatabase) {
  return db
    .prepare(
      `SELECT r.*, d.name AS document_name, d.extracted_text,
              d.status AS document_status, d.mime_type AS document_mime_type,
              d.original AS document_original, d.sha256 AS document_sha256
       FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = 'run'`,
    )
    .get() as Parameters<typeof completeCheckpoint>[0];
}

describe("Checkpoint-Wiedereinstieg", () => {
  for (const [index, phase] of PIPELINE_PHASES.entries()) {
    it(`übernimmt den gültigen Präfix bis ${phase}`, () => {
      const db = seedCheckpointRun();
      const run = runRow(db);
      withDatabase(db, () => {
        for (const completedPhase of PIPELINE_PHASES.slice(0, index + 1)) {
          completeCheckpoint(run, completedPhase, [`${completedPhase}-output`]);
        }
      });

      const restarted = withDatabase(db, () => restartRun("run", false));

      expect(restarted).toEqual({
        attempt: 2,
        resumeFrom: PIPELINE_PHASES[index + 1] ?? "reports",
      });
      expect(
        db
          .prepare(
            `SELECT phase FROM run_checkpoints
             WHERE run_id = 'run' AND attempt_no = 2 ORDER BY rowid`,
          )
          .all()
          .map((row) => (row as { phase: PipelinePhase }).phase),
      ).toEqual(PIPELINE_PHASES.slice(0, index + 1));
    });
  }

  it.each(["checkpoint_version", "input_hash"] as const)(
    "invalidiert %s und alle nachfolgenden Phasen",
    (column) => {
      const db = seedCheckpointRun();
      const run = runRow(db);
      withDatabase(db, () => {
        for (const phase of PIPELINE_PHASES) {
          completeCheckpoint(run, phase, [`${phase}-output`]);
        }
      });
      db.prepare(
        `UPDATE run_checkpoints
         SET ${column} = ?
         WHERE run_id = 'run' AND attempt_no = 1 AND phase = 'joint-review'`,
      ).run(column === "checkpoint_version" ? 999 : "invalid");

      const restarted = withDatabase(db, () => restartRun("run", false));

      expect(restarted).toEqual({ attempt: 2, resumeFrom: "joint-review" });
      expect(
        db
          .prepare(
            "SELECT count(*) AS count FROM run_checkpoints WHERE run_id = 'run' AND attempt_no = 2",
          )
          .get(),
      ).toEqual({ count: PIPELINE_PHASES.indexOf("joint-review") });
    },
  );

  it("verwirft einen Checkpoint mit fehlender Statusreferenz", () => {
    const db = seedCheckpointRun();
    const run = runRow(db);
    withDatabase(db, () => {
      completeCheckpoint(run, "extraction", ["extraction-output"]);
      completeCheckpoint(run, "evidence", ["missing-output"]);
    });

    const restarted = withDatabase(db, () => restartRun("run", false));

    expect(restarted).toEqual({ attempt: 2, resumeFrom: "evidence" });
  });
});
