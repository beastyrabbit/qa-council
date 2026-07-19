import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type SqliteDatabase, withDatabase } from "./db/index.js";
import { buildApp } from "./index.js";
import {
  completeCheckpoint,
  executeRun,
  PIPELINE_PHASES,
  persistPresentation,
  validCheckpoints,
} from "./orchestrator.js";

let database: SqliteDatabase | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  database?.close();
});

function seed() {
  database = createDatabase(":memory:");
  database.exec(`
    INSERT INTO documents(
      id, name, mime_type, size, sha256, original, status, created_at
    ) VALUES ('doc', 'Prüfung.md', 'text/markdown', 4, 'hash', X'74657374', 'ready', 'now');
    INSERT INTO runs(
      id, document_id, provider, model, mode, presentation, status, error,
      created_at, completed_at, current_attempt
    ) VALUES ('run', 'doc', 'codex', 'gpt-5.5', 'quick', 'text', 'failed', 'kaputt',
              'now', 'now', 1);
    INSERT INTO run_attempts(
      run_id, attempt_no, status, started_at, completed_at, error
    ) VALUES ('run', 1, 'failed', 'now', 'now', 'kaputt');
    INSERT INTO artifacts(
      id, run_id, attempt_no, kind, title, content_type, content, sha256, created_at
    ) VALUES ('artifact', 'run', 1, 'final', 'Final', 'text/markdown',
              '# Geheim\\n\\n<script>alert(1)</script>', 'sha', 'now');
    INSERT INTO presentations(
      id, run_id, attempt_no, kind, title, html, source_artifact_id, pages_json, created_at
    ) VALUES ('presentation', 'run', 1, 'text', 'Text', '<p>groß</p>', 'artifact',
              '[{"slug":"x","title":"X","html":"<p>x</p>"}]', 'now');
  `);
  return database;
}

describe("buildApp", () => {
  it("liefert Health 0.4.3 und hält große Inhalte aus der Summary fern", async () => {
    const db = seed();
    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true) },
    });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toEqual({ ok: true, version: "0.4.3", schemaVersion: 4 });

    const summary = await app.inject({ method: "GET", url: "/api/runs/run?attempt=1" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().run.hasResult).toBe(true);
    expect(summary.body).not.toContain("# Geheim");
    expect(summary.body).not.toContain("<p>groß</p>");

    const file = await app.inject({
      method: "GET",
      url: "/api/runs/run/files/artifact",
    });
    expect(file.statusCode).toBe(200);
    expect(file.json().content).toContain("# Geheim");
    expect(file.json().contentHtml).not.toContain("<script");

    const presentation = await app.inject({
      method: "GET",
      url: "/api/presentations/presentation",
    });
    expect(presentation.statusCode).toBe(200);
    expect(presentation.json().html).toContain("Geheim");
    expect(presentation.json().html).not.toContain("<script");
    expect(presentation.json().html).not.toContain("<p>groß</p>");
  });

  it("liefert kompatible lokale Embedding-Modelle über den Metadaten-Endpunkt", async () => {
    const db = seed();
    const listAiBoxEmbeddingModels = vi.fn(async () => [
      {
        id: "qwen3-embedding:8b",
        name: "qwen3-embedding:8b",
        dimensions: 4096,
      },
    ]);
    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true), listAiBoxEmbeddingModels },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/providers/aibox/embedding-models",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: "qwen3-embedding:8b",
        name: "qwen3-embedding:8b",
        dimensions: 4096,
      },
    ]);
    expect(listAiBoxEmbeddingModels).toHaveBeenCalledOnce();
  });

  it("aktualisiert Presentations bei einem Reports-Wiedereinstieg attemptlokal mit stabiler ID", () => {
    const db = seed();
    const firstId = withDatabase(db, () =>
      persistPresentation({
        runId: "run",
        attemptNo: 1,
        kind: "text",
        title: "Neu",
        sourceArtifactId: "artifact",
        render: (id) => ({ html: `<p>${id}</p>`, pagesJson: "[]" }),
      }),
    );
    const secondId = withDatabase(db, () =>
      persistPresentation({
        runId: "run",
        attemptNo: 1,
        kind: "text",
        title: "Noch neuer",
        sourceArtifactId: "artifact",
        render: (id) => ({ html: `<p>${id}-aktualisiert</p>`, pagesJson: "[]" }),
      }),
    );

    expect(firstId).toBe("presentation");
    expect(secondId).toBe("presentation");
    expect(
      db
        .prepare(
          "SELECT id, title, html FROM presentations WHERE run_id = 'run' AND attempt_no = 1",
        )
        .all(),
    ).toEqual([
      {
        id: "presentation",
        title: "Noch neuer",
        html: "<p>presentation-aktualisiert</p>",
      },
    ]);
  });

  it("beansprucht einen Doppel-Restart atomar und lehnt archivierte Läufe ab", async () => {
    const db = seed();
    const enqueueRun = vi.fn(() => true);
    app = await buildApp({ db, webRoot: false, services: { enqueueRun } });
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/api/runs/run/restart" }),
      app.inject({ method: "POST", url: "/api/runs/run/restart" }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([202, 409]);
    expect(db.prepare("SELECT current_attempt FROM runs WHERE id = 'run'").get()).toEqual({
      current_attempt: 2,
    });
    expect(enqueueRun).toHaveBeenCalledTimes(1);

    db.prepare(
      `UPDATE runs SET status = 'failed', archived_at = 'now', error = 'wieder kaputt'
         WHERE id = 'run'`,
    ).run();
    const archived = await app.inject({ method: "POST", url: "/api/runs/run/restart" });
    expect(archived.statusCode).toBe(409);
  });

  it("fängt beschädigtes JSON und nicht entschlüsselbare Secrets ohne HTTP 500 ab", async () => {
    const db = seed();
    db.exec(`
      UPDATE artifacts SET metadata = '{kaputt' WHERE id = 'artifact';
      UPDATE presentations SET pages_json = '[kaputt' WHERE id = 'presentation';
      UPDATE provider_settings SET encrypted_api_key = 'kein.gueltiges.secret'
      WHERE provider = 'openrouter';
    `);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true) },
    });

    const [summary, file, presentation, settings] = await Promise.all([
      app.inject({ method: "GET", url: "/api/runs/run" }),
      app.inject({ method: "GET", url: "/api/runs/run/files/artifact" }),
      app.inject({ method: "GET", url: "/api/presentations/presentation" }),
      app.inject({ method: "GET", url: "/api/settings" }),
    ]);

    expect([
      summary.statusCode,
      file.statusCode,
      presentation.statusCode,
      settings.statusCode,
    ]).toEqual([200, 200, 200, 200]);
    expect(summary.json().artifacts[0].metadata).toBeUndefined();
    expect(summary.json().presentations[0].pageCount).toBe(0);
    expect(file.json().metadata).toBeUndefined();
    expect(presentation.json().pages).toEqual([]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Environment-Fallbacks"));
    expect(warning.mock.calls.flat().join(" ")).not.toContain("kein.gueltiges.secret");
    warning.mockRestore();
  });

  it("akzeptiert leere optionale URLs und meldet aktiviertes ComfyUI verständlich", async () => {
    const db = seed();
    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true) },
    });
    const payload = {
      automaticLanguage: true,
      openRouterRouting: "balanced",
      embedding: {
        enabled: true,
        model: "qwen3-embedding:8b",
        dimensions: 4096,
      },
      providers: {
        codex: { model: "gpt-5.5" },
        openrouter: { model: "openai/gpt-5.4" },
        aibox: { model: "local-model", baseUrl: "" },
      },
      comfyui: { enabled: false, baseUrl: "", checkpoint: "" },
    };

    const disabled = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload,
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().providers.aibox.configured).toBe(false);
    expect(disabled.json().comfyui).toMatchObject({
      enabled: false,
      configured: false,
      baseUrl: "",
      checkpoint: "",
    });

    const invalidEnabled = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { ...payload, comfyui: { ...payload.comfyui, enabled: true } },
    });
    expect(invalidEnabled.statusCode).toBe(400);
    expect(invalidEnabled.body).toContain("Serveradresse");
    expect(invalidEnabled.body).toContain("Checkpoint");
  });

  it("liest abgeleitete Analysen attemptgebunden und standardmäßig aus dem aktuellen Versuch", async () => {
    const db = seed();
    db.exec(`
      INSERT INTO run_attempts(run_id, attempt_no, status, started_at, completed_at)
      VALUES ('run', 2, 'completed', 'later', 'later');
      UPDATE runs SET current_attempt = 2, status = 'completed' WHERE id = 'run';
      INSERT INTO derived_analyses(
        id, run_id, attempt_no, kind, status, provider, model, source_artifact_id,
        source_refs_json, output_text, created_at
      ) VALUES
        ('analysis-1', 'run', 1, 'top10_next_steps', 'ready', 'codex', 'gpt-5.5',
         'artifact', '[]', 'Alt', 'now'),
        ('analysis-2', 'run', 2, 'top10_next_steps', 'ready', 'codex', 'gpt-5.5',
         'artifact', '[]', 'Neu', 'later');
    `);
    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true) },
    });

    const [current, old, missing] = await Promise.all([
      app.inject({ method: "GET", url: "/api/runs/run/derived-analyses/top10" }),
      app.inject({ method: "GET", url: "/api/runs/run/derived-analyses/top10?attempt=1" }),
      app.inject({ method: "GET", url: "/api/runs/run/derived-analyses/top10?attempt=3" }),
    ]);

    expect(current.json()).toMatchObject({ id: "analysis-2", attemptNo: 2 });
    expect(old.json()).toMatchObject({ id: "analysis-1", attemptNo: 1 });
    expect(missing.statusCode).toBe(404);
  });

  it("vererbt gültige Extraction-/Evidence-Checkpoints und zeigt ihre Dateien effektiv an", async () => {
    const db = seed();
    const run = db
      .prepare(
        `SELECT r.*, d.name AS document_name, d.extracted_text,
                d.status AS document_status, d.mime_type AS document_mime_type,
                d.original AS document_original, d.sha256 AS document_sha256
         FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = 'run'`,
      )
      .get() as Parameters<typeof completeCheckpoint>[0];
    db.prepare(
      `UPDATE documents SET extracted_text = 'test', extraction_complete = 1 WHERE id = 'doc'`,
    ).run();
    db.prepare(
      `INSERT INTO artifacts(
         id, run_id, attempt_no, kind, title, content_type, content, sha256, created_at
       ) VALUES ('coverage', 'run', 1, 'coverage-manifest', 'Coverage',
                 'text/markdown', 'belegt', 'coverage-sha', 'now')`,
    ).run();
    db.exec(`
      INSERT INTO run_stages(
        id, run_id, attempt_no, name, status, started_at, completed_at
      ) VALUES (
        'evidence-stage', 'run', 1, 'Dokumentweite Voranalyse', 'completed', 'now', 'now'
      );
      INSERT INTO events(
        run_id, attempt_no, stage_id, type, level, message, created_at
      ) VALUES (
        'run', 1, 'evidence-stage', 'stage_completed', 'info',
        'Dokumentweite Voranalyse abgeschlossen', 'now'
      );
    `);
    withDatabase(db, () => {
      completeCheckpoint(run, "extraction");
      completeCheckpoint(run, "evidence", ["coverage"]);
    });
    db.prepare("UPDATE runs SET focus = 'Antwort auf Rückfrage: geklärt' WHERE id = 'run'").run();

    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true) },
    });
    const restarted = await app.inject({ method: "POST", url: "/api/runs/run/restart" });
    expect(restarted.statusCode).toBe(202);
    expect(restarted.json()).toMatchObject({ attempt: 2, resumeFrom: "routing-raci" });
    expect(
      db
        .prepare(
          `SELECT phase, inherited_from_attempt FROM run_checkpoints
           WHERE run_id = 'run' AND attempt_no = 2 ORDER BY rowid`,
        )
        .all(),
    ).toEqual([
      { phase: "extraction", inherited_from_attempt: 1 },
      { phase: "evidence", inherited_from_attempt: 1 },
    ]);

    const files = await app.inject({
      method: "GET",
      url: "/api/runs/run/files?attempt=2",
    });
    expect(files.json()).toContainEqual(
      expect.objectContaining({
        id: "coverage",
        attemptNo: 2,
        originAttempt: 1,
      }),
    );
    const summary = await app.inject({
      method: "GET",
      url: "/api/runs/run?attempt=2",
    });
    expect(summary.json().stages).toContainEqual(
      expect.objectContaining({
        id: "evidence-stage",
        name: "Dokumentweite Voranalyse",
        originAttempt: 1,
      }),
    );
    const activity = await app.inject({
      method: "GET",
      url: "/api/runs/run/activity?attempt=2&afterEventId=0",
    });
    expect(activity.json()).toContainEqual(
      expect.objectContaining({
        stageId: "evidence-stage",
        message: "Dokumentweite Voranalyse abgeschlossen",
        originAttempt: 1,
      }),
    );
  });

  it("führt Answer-Resume über dieselbe injizierte Queue fort", async () => {
    const db = seed();
    db.exec(`
      UPDATE runs SET status = 'waiting_for_input' WHERE id = 'run';
      UPDATE run_attempts SET status = 'waiting_for_input' WHERE run_id = 'run' AND attempt_no = 1;
      INSERT INTO run_questions(
        id, run_id, attempt_no, prompt, status, created_at
      ) VALUES ('question', 'run', 1, 'Welche Freigabe?', 'open', 'now');
    `);
    const enqueueRun = vi.fn(() => true);
    app = await buildApp({ db, webRoot: false, services: { enqueueRun } });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run/answer",
      payload: { questionId: "question", answer: "Freigabe erteilt." },
    });

    expect(response.statusCode).toBe(202);
    expect(enqueueRun).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT status FROM runs WHERE id = 'run'").get()).toEqual({
      status: "queued",
    });
    expect(
      db
        .prepare(
          "SELECT status, resume_phase FROM run_attempts WHERE run_id = 'run' AND attempt_no = 1",
        )
        .get(),
    ).toEqual({ status: "queued", resume_phase: "routing-raci" });
  });

  it("beansprucht nach einer vollständig gecheckten Pipeline nur noch den Reports-Abschluss", async () => {
    const db = seed();
    db.exec(`
      UPDATE documents
      SET extracted_text = 'test', extraction_complete = 1
      WHERE id = 'doc';
      INSERT INTO document_chunks(id, document_id, position, locator, content, sha256)
      VALUES ('chunk', 'doc', 0, 'Prüfung.md · Zeilen 1–1', 'test', 'chunk-sha');
    `);
    const insertCheckpointOutput = db.prepare(
      `INSERT INTO artifacts(
         id, run_id, attempt_no, kind, title, content_type, content, sha256, created_at
       ) VALUES (?, 'run', 1, 'checkpoint-state', ?, 'application/json', '{}', ?, 'now')`,
    );
    for (const phase of PIPELINE_PHASES) {
      insertCheckpointOutput.run(`${phase}-output`, phase, `${phase}-sha`);
    }
    db.exec(`
      INSERT INTO run_stages(
        id, run_id, attempt_no, name, role, status, output_text, started_at, completed_at
      ) VALUES (
        'inherited-review', 'run', 1, 'Einzelreview · Security', 'Security',
        'completed', 'Geerbtes Review', 'now', 'now'
      );
      INSERT INTO events(
        run_id, attempt_no, stage_id, type, level, message, data, created_at
      ) VALUES (
        'run', 1, 'inherited-review', 'assistant_message', 'info', 'Geerbtes Review',
        '{"markdown":"# Geerbt<script>alert(1)</script>"}', 'now'
      );
    `);
    const run = db
      .prepare(
        `SELECT r.*, d.name AS document_name, d.extracted_text,
                d.status AS document_status, d.mime_type AS document_mime_type,
                d.original AS document_original, d.sha256 AS document_sha256
         FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = 'run'`,
      )
      .get() as Parameters<typeof completeCheckpoint>[0];
    withDatabase(db, () => {
      for (const phase of PIPELINE_PHASES) completeCheckpoint(run, phase, [`${phase}-output`]);
    });
    app = await buildApp({
      db,
      webRoot: false,
      services: { enqueueRun: vi.fn(() => true) },
    });

    const restarted = await app.inject({ method: "POST", url: "/api/runs/run/restart" });

    expect(restarted.statusCode).toBe(202);
    expect(restarted.json()).toMatchObject({ attempt: 2, resumeFrom: "reports" });
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM run_checkpoints WHERE run_id = 'run' AND attempt_no = 2",
        )
        .get(),
    ).toEqual({ count: PIPELINE_PHASES.length });

    const effective = await app.inject({
      method: "GET",
      url: "/api/runs/run?attempt=2",
    });
    expect(effective.json().artifacts).toContainEqual(
      expect.objectContaining({ id: "artifact", attemptNo: 2, originAttempt: 1 }),
    );
    expect(effective.json().presentations).toContainEqual(
      expect.objectContaining({ id: "presentation", attemptNo: 2, originAttempt: 1 }),
    );
    expect(effective.json().events).toContainEqual(
      expect.objectContaining({
        stageId: "inherited-review",
        attemptNo: 2,
        originAttempt: 1,
      }),
    );
    const activity = await app.inject({
      method: "GET",
      url: "/api/runs/run/activity?attempt=2&afterEventId=0",
    });
    expect(activity.json()).toContainEqual(
      expect.objectContaining({
        stageId: "inherited-review",
        attemptNo: 2,
        originAttempt: 1,
        data: expect.objectContaining({ markdownHtml: expect.stringContaining("<h1>Geerbt") }),
      }),
    );
    expect(activity.body).not.toContain("<script");

    db.prepare(
      `INSERT INTO tool_capability_probes(
         provider, model, endpoint, schema_version, supported, checked_at
       ) VALUES ('codex', 'gpt-5.5', 'openai-codex', 1, 1, ?)`,
    ).run(new Date().toISOString());
    const resumedRun = db
      .prepare(
        `SELECT r.*, d.name AS document_name, d.extracted_text,
                d.status AS document_status, d.mime_type AS document_mime_type,
                d.original AS document_original, d.sha256 AS document_sha256
         FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = 'run'`,
      )
      .get() as Parameters<typeof validCheckpoints>[0];
    expect(withDatabase(db, () => [...validCheckpoints(resumedRun).keys()])).toEqual([
      ...PIPELINE_PHASES,
    ]);
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        withDatabase(db, () => executeRun("run")),
        new Promise<never>((_resolve, reject) => {
          resumeTimer = setTimeout(() => {
            const state = db
              .prepare("SELECT status, current_stage, error FROM runs WHERE id = 'run'")
              .get();
            reject(new Error(`Checkpoint-Resume blieb hängen: ${JSON.stringify(state)}`));
          }, 2_000);
        }),
      ]);
    } finally {
      if (resumeTimer) clearTimeout(resumeTimer);
    }

    expect(db.prepare("SELECT status FROM runs WHERE id = 'run'").get()).toEqual({
      status: "completed",
    });
    expect(
      db
        .prepare("SELECT count(*) AS count FROM run_stages WHERE run_id = 'run' AND attempt_no = 2")
        .get(),
    ).toEqual({ count: 0 });
  });
});
