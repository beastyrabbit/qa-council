import { describe, expect, it, vi } from "vitest";
import { createDatabase, withDatabase } from "./db/index.js";
import { recoverInterruptedRuns } from "./orchestrator.js";

describe("Startup-Recovery", () => {
  it("setzt denselben unterbrochenen Attempt über die zentrale Queue fort", () => {
    const database = createDatabase(":memory:");
    const schedule = vi.fn(() => true);
    try {
      database.exec(`
        INSERT INTO documents(
          id, name, mime_type, size, sha256, original, status, created_at
        ) VALUES ('doc', 'test.md', 'text/markdown', 4, 'sha', X'74657374', 'ready', 'now');
        INSERT INTO runs(
          id, document_id, provider, model, mode, presentation, status,
          current_stage, created_at, current_attempt
        ) VALUES (
          'run', 'doc', 'codex', 'gpt-5.5', 'quick', 'text', 'running',
          'Council · gemeinsames Review', 'now', 1
        );
        INSERT INTO run_attempts(
          run_id, attempt_no, status, started_at
        ) VALUES ('run', 1, 'running', 'now');
        INSERT INTO run_stages(
          id, run_id, attempt_no, name, status, started_at
        ) VALUES ('stage', 'run', 1, 'Council · gemeinsames Review', 'running', 'now');
      `);

      const recovered = withDatabase(database, () => recoverInterruptedRuns(schedule));

      expect(recovered).toEqual({ interrupted: 1, cancelled: 0, resumedQueued: 1 });
      expect(schedule).toHaveBeenCalledOnce();
      expect(schedule).toHaveBeenCalledWith("run");
      expect(
        database
          .prepare("SELECT status, current_attempt, current_stage FROM runs WHERE id = 'run'")
          .get(),
      ).toEqual({
        status: "queued",
        current_attempt: 1,
        current_stage: "Lauf wird fortgesetzt",
      });
      expect(
        database
          .prepare("SELECT status, resume_phase FROM run_attempts WHERE run_id = 'run'")
          .get(),
      ).toEqual({ status: "queued", resume_phase: null });
      expect(database.prepare("SELECT status FROM run_stages WHERE id = 'stage'").get()).toEqual({
        status: "cancelled",
      });
    } finally {
      database.close();
    }
  });
});
