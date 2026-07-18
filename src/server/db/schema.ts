import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  original: blob("original", { mode: "buffer" }).notNull(),
  extractedText: text("extracted_text"),
  extractionFingerprint: text("extraction_fingerprint"),
  extractionComplete: integer("extraction_complete").notNull().default(0),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
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
  currentAttempt: integer("current_attempt").notNull().default(1),
});

export const runAttempts = sqliteTable(
  "run_attempts",
  {
    runId: text("run_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    error: text("error"),
    predecessorAttempt: integer("predecessor_attempt"),
    resumePhase: text("resume_phase"),
  },
  (table) => [primaryKey({ columns: [table.runId, table.attemptNo] })],
);

export const runCheckpoints = sqliteTable(
  "run_checkpoints",
  {
    runId: text("run_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    phase: text("phase").notNull(),
    checkpointVersion: integer("checkpoint_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputRefsJson: text("output_refs_json").notNull().default("[]"),
    inheritedFromAttempt: integer("inherited_from_attempt"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.attemptNo, table.phase] }),
    index("run_checkpoints_lookup_idx").on(
      table.runId,
      table.phase,
      table.checkpointVersion,
      table.inputHash,
    ),
  ],
);

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
  attemptNo: integer("attempt_no").notNull().default(1),
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
  attemptNo: integer("attempt_no").notNull().default(1),
  prompt: text("prompt").notNull(),
  answer: text("answer"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  answeredAt: text("answered_at"),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  attemptNo: integer("attempt_no").notNull().default(1),
  stageId: text("stage_id"),
  kind: text("kind").notNull(),
  logicalKey: text("logical_key"),
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
  attemptNo: integer("attempt_no").notNull().default(1),
  stageId: text("stage_id"),
  type: text("type").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  data: text("data"),
  createdAt: text("created_at").notNull(),
});

export const presentations = sqliteTable(
  "presentations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    attemptNo: integer("attempt_no").notNull().default(1),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    html: text("html").notNull(),
    sourceArtifactId: text("source_artifact_id").notNull(),
    pagesJson: text("pages_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("presentations_run_attempt_kind_idx").on(table.runId, table.attemptNo, table.kind),
  ],
);

export const generatedImages = sqliteTable("generated_images", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  attemptNo: integer("attempt_no").notNull().default(1),
  provider: text("provider").notNull(),
  prompt: text("prompt").notNull(),
  remotePromptId: text("remote_prompt_id"),
  slot: text("slot").notNull().default("hero"),
  mimeType: text("mime_type").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const derivedAnalyses = sqliteTable("derived_analyses", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  attemptNo: integer("attempt_no").notNull().default(1),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  sourceArtifactId: text("source_artifact_id").notNull(),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  thinkingText: text("thinking_text").notNull().default(""),
  outputText: text("output_text").notNull().default(""),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
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

export const toolCapabilityProbes = sqliteTable(
  "tool_capability_probes",
  {
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    endpoint: text("endpoint").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    supported: integer("supported").notNull(),
    error: text("error"),
    checkedAt: text("checked_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.model, table.endpoint, table.schemaVersion],
    }),
  ],
);
