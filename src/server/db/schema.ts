import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  original: blob("original", { mode: "buffer" }).notNull(),
  extractedText: text("extracted_text"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const documentChunks = sqliteTable("document_chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  position: integer("position").notNull(),
  locator: text("locator").notNull(),
  content: text("content").notNull(),
  sha256: text("sha256").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  mode: text("mode").notNull(),
  resolvedMode: text("resolved_mode"),
  presentation: text("presentation").notNull(),
  imageProvider: text("image_provider"),
  focus: text("focus"),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  currentStage: text("current_stage"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  archivedAt: text("archived_at"),
  comparisonId: text("comparison_id"),
});

export const comparisons = sqliteTable("comparisons", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  mode: text("mode").notNull(),
  presentation: text("presentation").notNull(),
  focus: text("focus"),
  createdAt: text("created_at").notNull(),
});

export const runStages = sqliteTable("run_stages", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  status: text("status").notNull(),
  promptHash: text("prompt_hash"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cost: integer("cost_micros").notNull().default(0),
  thinkingText: text("thinking_text").notNull().default(""),
  outputText: text("output_text").notNull().default(""),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const runQuestions = sqliteTable("run_questions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  prompt: text("prompt").notNull(),
  answer: text("answer"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  answeredAt: text("answered_at"),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  stageId: text("stage_id"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  contentType: text("content_type").notNull(),
  content: text("content").notNull(),
  sha256: text("sha256").notNull(),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  stageId: text("stage_id"),
  type: text("type").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  data: text("data"),
  createdAt: text("created_at").notNull(),
});

export const presentations = sqliteTable("presentations", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  html: text("html").notNull(),
  sourceArtifactId: text("source_artifact_id").notNull(),
  pagesJson: text("pages_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const generatedImages = sqliteTable("generated_images", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  provider: text("provider").notNull(),
  prompt: text("prompt").notNull(),
  remotePromptId: text("remote_prompt_id"),
  mimeType: text("mime_type").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const providerSettings = sqliteTable("provider_settings", {
  provider: text("provider").primaryKey(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  encryptedApiKey: text("encrypted_api_key"),
  updatedAt: text("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
