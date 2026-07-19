import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase, type SqliteDatabase } from "./index.js";

let database: SqliteDatabase | undefined;

afterEach(() => database?.close());

describe("0.3.0-Datenbankmigration", () => {
  it("übernimmt realistisch befüllte 0.2.1-Läufe unverändert als Versuch 1", () => {
    database = new Database(":memory:");
    database.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, original BLOB NOT NULL, extracted_text TEXT, status TEXT NOT NULL,
        extraction_complete INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        mode TEXT NOT NULL, resolved_mode TEXT, presentation TEXT NOT NULL, focus TEXT,
        status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, current_stage TEXT,
        error TEXT, created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE presentations (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
        html TEXT NOT NULL, source_artifact_id TEXT NOT NULL, pages_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, UNIQUE(run_id, kind)
      );
      CREATE TABLE run_stages (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT,
        status TEXT NOT NULL, prompt_hash TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE run_questions (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT,
        status TEXT NOT NULL, created_at TEXT NOT NULL, answered_at TEXT
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, stage_id TEXT, kind TEXT NOT NULL,
        title TEXT NOT NULL, content_type TEXT NOT NULL, content TEXT NOT NULL,
        sha256 TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, stage_id TEXT,
        type TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, data TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE generated_images (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, provider TEXT NOT NULL, prompt TEXT NOT NULL,
        remote_prompt_id TEXT, mime_type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE derived_analyses (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, source_artifact_id TEXT NOT NULL,
        source_refs_json TEXT NOT NULL DEFAULT '[]', thinking_text TEXT NOT NULL DEFAULT '',
        output_text TEXT NOT NULL DEFAULT '', error TEXT, created_at TEXT NOT NULL,
        started_at TEXT, completed_at TEXT
      );
      INSERT INTO documents VALUES (
        'doc-1', 'Alt.md', 'text/markdown', 4, 'hash', X'74657374', 'test', 'ready',
        1, NULL, '2025-01-01T00:00:00.000Z'
      );
      INSERT INTO runs(
        id, document_id, provider, model, mode, presentation, status, progress, created_at
      ) VALUES ('run-1', 'doc-1', 'codex', 'gpt', 'quick', 'text', 'completed', 100,
                '2025-01-01T00:00:00.000Z');
      INSERT INTO presentations VALUES (
        'p-1', 'run-1', 'text', 'Alt', '<p>alt</p>', 'a-1', '[]',
        '2025-01-01T00:00:00.000Z'
      );
      INSERT INTO run_stages VALUES (
        's-1', 'run-1', 'Einzelreview · Tester', 'Tester', 'completed', 'prompt-hash',
        10, 20, 30, '2025-01-01T00:00:00.000Z', '2025-01-01T00:01:00.000Z'
      );
      INSERT INTO run_questions VALUES (
        'q-1', 'run-1', 'Freigabe?', 'Ja', 'answered', '2025-01-01T00:00:00.000Z',
        '2025-01-01T00:00:30.000Z'
      );
      INSERT INTO artifacts VALUES (
        'a-1', 'run-1', 's-1', 'final', 'Alt', 'text/markdown', '# Alt', 'artifact-hash',
        '{"legacy":true}', '2025-01-01T00:01:00.000Z'
      );
      INSERT INTO events(run_id, stage_id, type, level, message, data, created_at) VALUES (
        'run-1', 's-1', 'assistant_message', 'info', 'Alt', '{"markdown":"# Alt"}',
        '2025-01-01T00:01:00.000Z'
      );
      INSERT INTO generated_images VALUES (
        'i-1', 'run-1', 'comfyui', 'Alt', NULL, 'image/png', X'00',
        '2025-01-01T00:01:00.000Z'
      );
      INSERT INTO derived_analyses VALUES (
        'd-1', 'run-1', 'top10_next_steps', 'ready', 'codex', 'gpt', 'a-1', '[]', '',
        'Alt', NULL, '2025-01-01T00:01:00.000Z', '2025-01-01T00:01:00.000Z',
        '2025-01-01T00:02:00.000Z'
      );
    `);

    migrateDatabase(database);

    expect(database.prepare("SELECT current_attempt FROM runs WHERE id = 'run-1'").get()).toEqual({
      current_attempt: 1,
    });
    expect(
      database.prepare("SELECT * FROM run_attempts WHERE run_id = 'run-1'").get(),
    ).toMatchObject({ attempt_no: 1, status: "completed" });
    expect(
      database.prepare("SELECT attempt_no, html FROM presentations WHERE id = 'p-1'").get(),
    ).toEqual({ attempt_no: 1, html: "<p>alt</p>" });
    for (const [table, id] of [
      ["run_stages", "s-1"],
      ["run_questions", "q-1"],
      ["artifacts", "a-1"],
      ["generated_images", "i-1"],
      ["derived_analyses", "d-1"],
    ] as const) {
      expect(database.prepare(`SELECT attempt_no FROM ${table} WHERE id = ?`).get(id)).toEqual({
        attempt_no: 1,
      });
    }
    expect(database.prepare("SELECT attempt_no FROM events WHERE run_id = 'run-1'").get()).toEqual({
      attempt_no: 1,
    });
  });

  it("erlaubt dieselbe Presentation-Art in verschiedenen Attempts", () => {
    database = migrateDatabase(new Database(":memory:"));
    database.exec(`
      INSERT INTO documents(
        id, name, mime_type, size, sha256, original, status, created_at
      ) VALUES ('d', 'd', 'text/plain', 1, 'h', X'78', 'ready', 'now');
      INSERT INTO runs(
        id, document_id, provider, model, mode, presentation, status, created_at
      ) VALUES ('r', 'd', 'codex', 'm', 'quick', 'text', 'completed', 'now');
      INSERT INTO presentations VALUES ('p1', 'r', 1, 'text', '1', '', 'a', '[]', 'now');
      INSERT INTO presentations VALUES ('p2', 'r', 2, 'text', '2', '', 'a', '[]', 'now');
    `);
    expect(
      database.prepare("SELECT count(*) AS count FROM presentations WHERE run_id = 'r'").get(),
    ).toEqual({ count: 2 });
  });

  it("richtet den rekonstruierbaren Hybrid-Retrieval-Index ein", () => {
    database = migrateDatabase(new Database(":memory:"));
    expect(database.pragma("user_version", { simple: true })).toBe(5);
    expect(database.prepare("SELECT vec_version() AS version").get()).toMatchObject({
      version: expect.stringMatching(/^v0\.1\./),
    });
    expect(
      database.prepare("SELECT value FROM app_settings WHERE key = 'embeddingConfig'").get(),
    ).toMatchObject({ value: expect.stringContaining("qwen3-embedding:8b") });
    expect(
      database
        .prepare(
          "SELECT dflt_value FROM pragma_table_info('run_checkpoints') WHERE name = 'analysis_version'",
        )
        .get(),
    ).toEqual({ dflt_value: "'legacy'" });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE name IN (
             'document_retrieval_passages',
             'document_retrieval_fts',
             'embedding_cache_entries',
             'embedding_vectors'
           )`,
        )
        .get(),
    ).toEqual({ count: 4 });
  });
});
