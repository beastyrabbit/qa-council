import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "qa-council-cancel-"));
process.env.DATA_DIR = dataDir;

const { sqlite } = await import("./db/index.js");
const { cancelRun, enqueueRun } = await import("./orchestrator.js");

function insertRun(id: string, status: string) {
  const documentId = `document-${id}`;
  sqlite
    .prepare(
      `INSERT INTO documents(
        id, name, mime_type, size, sha256, original, extracted_text, status, created_at
      ) VALUES (?, ?, 'text/markdown', 4, ?, ?, '# QA', 'ready', ?)`,
    )
    .run(documentId, `${id}.md`, `sha-${id}`, Buffer.from("# QA"), new Date().toISOString());
  sqlite
    .prepare(
      `INSERT INTO runs(
        id, document_id, provider, model, mode, presentation, status, progress, created_at
      ) VALUES (?, ?, 'aibox', 'test-model', 'quick', 'text', ?, 0, ?)`,
    )
    .run(id, documentId, status, new Date().toISOString());
}

beforeAll(() => {
  insertRun("queued-run", "queued");
  insertRun("running-run", "running");
  insertRun("completed-run", "completed");
});

afterAll(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Laufabbruch", () => {
  it("bricht einen wartenden Lauf atomar ab und verhindert seinen späteren Start", async () => {
    expect(cancelRun("queued-run")).toBe("cancelled");
    expect(
      sqlite.prepare("SELECT status, current_stage FROM runs WHERE id = ?").get("queued-run"),
    ).toMatchObject({ status: "cancelled", current_stage: "Abgebrochen" });
    expect(
      sqlite
        .prepare("SELECT type FROM events WHERE run_id = ? ORDER BY id DESC LIMIT 1")
        .get("queued-run"),
    ).toMatchObject({ type: "run_cancelled" });

    enqueueRun("queued-run");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sqlite.prepare("SELECT status FROM runs WHERE id = ?").get("queued-run")).toMatchObject({
      status: "cancelled",
    });
  });

  it("markiert einen laufenden Stage und eine offene Rückfrage als abgebrochen", () => {
    sqlite
      .prepare(
        `INSERT INTO run_stages(
          id, run_id, name, status, started_at
        ) VALUES ('stage-running', 'running-run', 'Review', 'running', ?)`,
      )
      .run(new Date().toISOString());
    sqlite
      .prepare(
        `INSERT INTO run_questions(
          id, run_id, prompt, status, created_at
        ) VALUES ('question-open', 'running-run', 'Frage?', 'open', ?)`,
      )
      .run(new Date().toISOString());

    expect(cancelRun("running-run")).toBe("cancelled");
    expect(
      sqlite.prepare("SELECT status FROM run_stages WHERE id = 'stage-running'").get(),
    ).toMatchObject({ status: "cancelled" });
    expect(
      sqlite.prepare("SELECT status FROM run_questions WHERE id = 'question-open'").get(),
    ).toMatchObject({ status: "cancelled" });
  });

  it("weist unbekannte und bereits beendete Läufe zurück", () => {
    expect(cancelRun("missing-run")).toBe("not_found");
    expect(cancelRun("completed-run")).toBe("not_active");
  });
});
