import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export const SCHEMA_VERSION = 3;
export type SqliteDatabase = Database.Database;

const databaseContext = new AsyncLocalStorage<SqliteDatabase>();
let defaultDatabase: SqliteDatabase | undefined;

export function withDatabase<T>(database: SqliteDatabase, callback: () => T): T {
  return databaseContext.run(database, callback);
}

export function setDefaultDatabase(database: SqliteDatabase | undefined) {
  defaultDatabase = database;
}

export function currentDatabase(): SqliteDatabase {
  const database = databaseContext.getStore() ?? defaultDatabase;
  if (!database) {
    throw new Error(
      "Keine Datenbank gebunden. Verwende buildApp({ db }) oder initialisiere den Production-Entrypoint.",
    );
  }
  return database;
}

/**
 * Compatibility proxy for server modules. It resolves the database from the
 * current request/queue async context and therefore keeps app.inject() instances
 * isolated without opening a database as an import side effect.
 */
export const sqlite = new Proxy({} as SqliteDatabase, {
  get(_target, property) {
    const database = currentDatabase();
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

function addColumnIfMissing(
  database: SqliteDatabase,
  table: string,
  column: string,
  definition: string,
) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migratePresentations(database: SqliteDatabase) {
  const table = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'presentations'")
    .get() as { sql: string } | undefined;
  if (!table || /UNIQUE\s*\(\s*run_id\s*,\s*attempt_no\s*,\s*kind\s*\)/i.test(table.sql)) {
    return;
  }

  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE presentations_v030 (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          attempt_no INTEGER NOT NULL DEFAULT 1,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          html TEXT NOT NULL,
          source_artifact_id TEXT NOT NULL,
          pages_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          UNIQUE(run_id, attempt_no, kind)
        );
        INSERT INTO presentations_v030(
          id, run_id, attempt_no, kind, title, html, source_artifact_id, pages_json, created_at
        )
        SELECT id, run_id, COALESCE(attempt_no, 1), kind, title, html,
               source_artifact_id, COALESCE(pages_json, '[]'), created_at
        FROM presentations;
        DROP TABLE presentations;
        ALTER TABLE presentations_v030 RENAME TO presentations;
      `);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

export function migrateDatabase(database: SqliteDatabase) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, original BLOB NOT NULL, extracted_text TEXT, status TEXT NOT NULL,
      extraction_complete INTEGER NOT NULL DEFAULT 0, extraction_fingerprint TEXT,
      error TEXT, created_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS documents_sha256_idx ON documents(sha256);
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, locator TEXT NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_document_idx ON document_chunks(document_id, position);
    CREATE TABLE IF NOT EXISTS document_extraction_pages (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page INTEGER NOT NULL, total_pages INTEGER NOT NULL, unit TEXT NOT NULL,
      content TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(document_id, page)
    );
    CREATE INDEX IF NOT EXISTS extraction_pages_document_idx
      ON document_extraction_pages(document_id, page);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL, resolved_mode TEXT,
      presentation TEXT NOT NULL, image_provider TEXT, focus TEXT, status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0, current_stage TEXT, error TEXT,
      created_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT, comparison_id TEXT,
      current_attempt INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS comparisons (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      mode TEXT NOT NULL, presentation TEXT NOT NULL, focus TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_attempts (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      predecessor_attempt INTEGER,
      resume_phase TEXT,
      PRIMARY KEY(run_id, attempt_no)
    );
    CREATE TABLE IF NOT EXISTS run_checkpoints (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL,
      phase TEXT NOT NULL,
      checkpoint_version INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      output_refs_json TEXT NOT NULL DEFAULT '[]',
      inherited_from_attempt INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY(run_id, attempt_no, phase)
    );
    CREATE INDEX IF NOT EXISTS run_checkpoints_lookup_idx
      ON run_checkpoints(run_id, phase, checkpoint_version, input_hash);
    CREATE TABLE IF NOT EXISTS run_stages (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, role TEXT, status TEXT NOT NULL,
      prompt_hash TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0,
      thinking_text TEXT NOT NULL DEFAULT '', output_text TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_questions (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, prompt TEXT NOT NULL, answer TEXT,
      status TEXT NOT NULL, created_at TEXT NOT NULL, answered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, stage_id TEXT, kind TEXT NOT NULL,
      logical_key TEXT, title TEXT NOT NULL, content_type TEXT NOT NULL, content TEXT NOT NULL,
      sha256 TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, stage_id TEXT, type TEXT NOT NULL,
      level TEXT NOT NULL, message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presentations (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL, title TEXT NOT NULL,
      html TEXT NOT NULL, source_artifact_id TEXT NOT NULL,
      pages_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
      UNIQUE(run_id, attempt_no, kind)
    );
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, provider TEXT NOT NULL, prompt TEXT NOT NULL,
      remote_prompt_id TEXT, slot TEXT NOT NULL DEFAULT 'hero', mime_type TEXT NOT NULL,
      data BLOB NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS derived_analyses (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL, status TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, source_artifact_id TEXT NOT NULL,
      source_refs_json TEXT NOT NULL DEFAULT '[]', thinking_text TEXT NOT NULL DEFAULT '',
      output_text TEXT NOT NULL DEFAULT '', error TEXT, created_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS provider_settings (
      provider TEXT PRIMARY KEY, model TEXT NOT NULL, base_url TEXT,
      encrypted_api_key TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tool_capability_probes (
      provider TEXT NOT NULL, model TEXT NOT NULL, endpoint TEXT NOT NULL,
      schema_version INTEGER NOT NULL, supported INTEGER NOT NULL,
      error TEXT, checked_at TEXT NOT NULL,
      PRIMARY KEY(provider, model, endpoint, schema_version)
    );
  `);

  addColumnIfMissing(database, "runs", "archived_at", "TEXT");
  addColumnIfMissing(database, "documents", "deleted_at", "TEXT");
  addColumnIfMissing(database, "documents", "extraction_fingerprint", "TEXT");
  addColumnIfMissing(database, "documents", "extraction_complete", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "runs", "image_provider", "TEXT");
  addColumnIfMissing(database, "runs", "comparison_id", "TEXT");
  addColumnIfMissing(database, "runs", "current_attempt", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(database, "presentations", "pages_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(database, "run_stages", "thinking_text", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "run_stages", "output_text", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "generated_images", "slot", "TEXT NOT NULL DEFAULT 'hero'");
  for (const table of [
    "run_stages",
    "run_questions",
    "artifacts",
    "events",
    "presentations",
    "generated_images",
    "derived_analyses",
  ]) {
    addColumnIfMissing(database, table, "attempt_no", "INTEGER NOT NULL DEFAULT 1");
  }
  addColumnIfMissing(database, "artifacts", "logical_key", "TEXT");
  migratePresentations(database);

  database.exec(`
    CREATE INDEX IF NOT EXISTS runs_comparison_idx ON runs(comparison_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS artifacts_attempt_content_idx
      ON artifacts(run_id, attempt_no, kind, logical_key, sha256)
      WHERE logical_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS events_run_idx ON events(run_id, attempt_no, id);
    CREATE INDEX IF NOT EXISTS generated_images_run_idx
      ON generated_images(run_id, attempt_no, created_at);
    CREATE INDEX IF NOT EXISTS derived_analyses_run_idx
      ON derived_analyses(run_id, attempt_no, kind, created_at);
    CREATE INDEX IF NOT EXISTS generated_images_run_slot_idx
      ON generated_images(run_id, attempt_no, slot, created_at);
  `);

  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT OR IGNORE INTO run_attempts(
        run_id, attempt_no, status, started_at, completed_at, error
      )
      SELECT id, 1, status, created_at, completed_at, error FROM runs`,
    )
    .run();
  database
    .prepare(`UPDATE documents SET status = 'uploaded', error = NULL WHERE status = 'extracting'`)
    .run();

  const insertProvider = database.prepare(`
    INSERT OR IGNORE INTO provider_settings(provider, model, base_url, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  insertProvider.run("codex", "gpt-5.5", null, now);
  insertProvider.run("openrouter", "openai/gpt-5.4", "https://openrouter.ai/api/v1", now);
  insertProvider.run("aibox", "qwen3-coder-next:q4km", process.env.AIBOX_URL || null, now);
  database
    .prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('automaticLanguage', 'true')")
    .run();
  database
    .prepare(
      "INSERT OR IGNORE INTO app_settings(key, value) VALUES ('openRouterRouting', 'balanced')",
    )
    .run();
  database
    .prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('comfyUiConfig', ?)")
    .run(
      JSON.stringify({
        enabled: false,
        baseUrl: process.env.COMFYUI_URL ?? "",
        checkpoint: process.env.COMFYUI_CHECKPOINT ?? "",
      }),
    );
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
  return database;
}

export function createDatabase(filename?: string) {
  const target =
    filename ?? path.join(process.env.DATA_DIR ?? path.resolve("data"), "qa-council.sqlite");
  if (target !== ":memory:") fs.mkdirSync(path.dirname(target), { recursive: true });
  return migrateDatabase(new Database(target));
}

export function createDrizzle(database: SqliteDatabase) {
  return drizzle(database, { schema });
}
