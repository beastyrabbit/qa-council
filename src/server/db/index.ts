import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const dataDir = process.env.DATA_DIR ?? path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const sqlite = new Database(path.join(dataDir, "qa-council.sqlite"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, original BLOB NOT NULL, extracted_text TEXT, status TEXT NOT NULL,
  error TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_sha256_idx ON documents(sha256);
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, locator TEXT NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON document_chunks(document_id, position);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL, resolved_mode TEXT,
  presentation TEXT NOT NULL, image_provider TEXT, focus TEXT, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT, error TEXT, created_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT,
  comparison_id TEXT
);
CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, presentation TEXT NOT NULL, focus TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_stages (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT, status TEXT NOT NULL, prompt_hash TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0, thinking_text TEXT NOT NULL DEFAULT '',
  output_text TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS run_questions (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL, answer TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, answered_at TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, stage_id TEXT,
  kind TEXT NOT NULL, title TEXT NOT NULL, content_type TEXT NOT NULL, content TEXT NOT NULL,
  sha256 TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage_id TEXT, type TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run_idx ON events(run_id, id);
CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL, source_artifact_id TEXT NOT NULL,
  pages_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, UNIQUE(run_id, kind)
);
CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, prompt TEXT NOT NULL, remote_prompt_id TEXT,
  mime_type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generated_images_run_idx ON generated_images(run_id, created_at);
CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY, model TEXT NOT NULL, base_url TEXT, encrypted_api_key TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("runs", "archived_at", "TEXT");
addColumnIfMissing("runs", "image_provider", "TEXT");
addColumnIfMissing("runs", "comparison_id", "TEXT");
addColumnIfMissing("presentations", "pages_json", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("run_stages", "thinking_text", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("run_stages", "output_text", "TEXT NOT NULL DEFAULT ''");
sqlite.exec("CREATE INDEX IF NOT EXISTS runs_comparison_idx ON runs(comparison_id, created_at)");

const now = new Date().toISOString();
const insertProvider = sqlite.prepare(`
  INSERT OR IGNORE INTO provider_settings(provider, model, base_url, updated_at)
  VALUES (?, ?, ?, ?)
`);
insertProvider.run("codex", "gpt-5.5", null, now);
insertProvider.run("openrouter", "openai/gpt-5.4", "https://openrouter.ai/api/v1", now);
insertProvider.run(
  "aibox",
  "qwen3-coder-next:q4km",
  process.env.AIBOX_URL ?? "http://192.168.10.120:11434",
  now,
);
sqlite
  .prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('automaticLanguage', 'true')")
  .run();
sqlite
  .prepare(
    "INSERT OR IGNORE INTO app_settings(key, value) VALUES ('openRouterRouting', 'balanced')",
  )
  .run();
sqlite.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('comfyUiConfig', ?)").run(
  JSON.stringify({
    enabled: false,
    baseUrl: process.env.COMFYUI_URL ?? "http://192.168.10.120:8188",
    checkpoint: process.env.COMFYUI_CHECKPOINT ?? "anima-base-v1.0.safetensors",
  }),
);

export const db = drizzle(sqlite, { schema });
