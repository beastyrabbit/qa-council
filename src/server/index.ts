import fs from "node:fs";
import path from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  AppSettings,
  ArtifactRecord,
  ComparisonRecord,
  DocumentDetails,
  DocumentRecord,
  PresentationKind,
  PresentationRecord,
  ProviderId,
  RunAttemptRecord,
  RunDetails,
  RunEvent,
  RunRecord,
  RunStageRecord,
} from "../shared/types.js";
import { workflowPhaseForArtifact } from "./artifact-taxonomy.js";
import {
  discoverComfyUi,
  getComfyUiConfig,
  hydratePresentationImages,
  saveComfyUiConfig,
} from "./comfyui.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { SCHEMA_VERSION, type SqliteDatabase, sqlite, withDatabase } from "./db/index.js";
import {
  cancelDerivedAnalysis,
  getDerivedAnalysis,
  getLatestDerivedAnalysis,
  startDerivedAnalysis,
} from "./derived-analysis.js";
import {
  cancelRun,
  enqueueRun,
  generateAdditionalPresentation,
  isRunExecuting,
  restartRun,
  resumeRunWithAnswer,
} from "./orchestrator.js";
import { createPresentationPdf } from "./pdf.js";
import { markdownHtml } from "./presentation.js";
import { codexAuthStatus, getAuthStorage, listModels } from "./providers.js";
import { EMBEDDING_DIMENSIONS, embeddingConfig, listAiBoxEmbeddingModels } from "./retrieval.js";
import { safeParse } from "./safe-json.js";
import type { RunScheduler } from "./scheduler.js";
import { sha256 } from "./skills.js";

export interface AppServices {
  enqueueRun: typeof enqueueRun;
  cancelRun: typeof cancelRun;
  resumeRunWithAnswer: typeof resumeRunWithAnswer;
  listModels: typeof listModels;
  listAiBoxEmbeddingModels: typeof listAiBoxEmbeddingModels;
  codexAuthStatus: typeof codexAuthStatus;
  getAuthStorage: typeof getAuthStorage;
}

export interface BuildAppOptions {
  db: SqliteDatabase;
  services?: Partial<AppServices>;
  queue?: RunScheduler;
  logger?: boolean | FastifyBaseLogger;
  webRoot?: string | false;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 52_428_800,
  });
  await app.register(multipart, { limits: { fileSize: 52_428_800, files: 1 } });
  app.addHook("onRequest", (_request, _reply, done) => {
    withDatabase(options.db, done);
  });
  const services: AppServices = {
    enqueueRun: options.services?.enqueueRun ?? enqueueRun,
    cancelRun: options.services?.cancelRun ?? cancelRun,
    resumeRunWithAnswer: options.services?.resumeRunWithAnswer ?? resumeRunWithAnswer,
    listModels: options.services?.listModels ?? listModels,
    listAiBoxEmbeddingModels:
      options.services?.listAiBoxEmbeddingModels ?? listAiBoxEmbeddingModels,
    codexAuthStatus: options.services?.codexAuthStatus ?? codexAuthStatus,
    getAuthStorage: options.services?.getAuthStorage ?? getAuthStorage,
  };
  const queueRun = (runId: string) => {
    if (!options.queue) return services.enqueueRun(runId);
    const row = options.db.prepare("SELECT provider FROM runs WHERE id = ?").get(runId) as
      | { provider: ProviderId }
      | undefined;
    return row ? options.queue.enqueue({ runId, provider: row.provider }) : false;
  };

  const markdownCache = new Map<string, string>();
  function cachedMarkdownHtml(markdown: string) {
    const key = sha256(markdown);
    const existing = markdownCache.get(key);
    if (existing !== undefined) return existing;
    const html = markdownHtml(markdown);
    markdownCache.set(key, html);
    if (markdownCache.size > 250) {
      const oldest = markdownCache.keys().next().value;
      if (oldest) markdownCache.delete(oldest);
    }
    return html;
  }

  function documentDto(row: Record<string, unknown>): DocumentRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      mimeType: String(row.mime_type),
      size: Number(row.size),
      sha256: String(row.sha256),
      status: row.status as DocumentRecord["status"],
      createdAt: String(row.created_at),
      error: row.error as string | null,
    };
  }

  function documentDetailsDto(row: Record<string, unknown>): DocumentDetails {
    return {
      ...documentDto(row),
      extractedText: String(row.extracted_text ?? ""),
    };
  }

  function runDto(row: Record<string, unknown>): RunRecord {
    return {
      id: String(row.id),
      documentId: String(row.document_id),
      documentName: String(row.document_name ?? "Dokument"),
      comparisonId: row.comparison_id as string | null,
      provider: row.provider as ProviderId,
      model: String(row.model),
      mode: row.mode as RunRecord["mode"],
      resolvedMode: row.resolved_mode as RunRecord["resolvedMode"],
      presentation: row.presentation as PresentationKind,
      imageProvider: row.image_provider as RunRecord["imageProvider"],
      focus: row.focus as string | null,
      status: row.status as RunRecord["status"],
      progress: Number(row.progress),
      currentStage: row.current_stage as string | null,
      error: row.error as string | null,
      hasResult: Boolean(row.has_result),
      createdAt: String(row.created_at),
      completedAt: row.completed_at as string | null,
      archivedAt: row.archived_at as string | null,
      currentAttempt: Number(row.current_attempt ?? 1),
    };
  }

  app.get("/api/health", async () => ({
    ok: true,
    version: "0.3.1",
    schemaVersion: SCHEMA_VERSION,
  }));

  app.get("/api/documents", async () => {
    const rows = sqlite
      .prepare(
        `SELECT id, name, mime_type, size, sha256, status, error, created_at
       FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(documentDto);
  });

  app.post("/api/documents", async (request, reply) => {
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: "Keine Datei übertragen." });
    const buffer = await upload.toBuffer();
    const hash = sha256(buffer);
    const existing = sqlite
      .prepare(
        `SELECT id, name, mime_type, size, sha256, status, error, created_at, deleted_at
       FROM documents WHERE sha256 = ?`,
      )
      .get(hash) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.status !== "extracting") {
        sqlite
          .prepare(
            `UPDATE documents
           SET name = ?, mime_type = ?, size = ?, original = ?, status = 'uploaded',
               error = NULL, deleted_at = NULL, created_at = ?
           WHERE id = ?`,
          )
          .run(
            upload.filename,
            upload.mimetype,
            buffer.length,
            buffer,
            new Date().toISOString(),
            existing.id,
          );
      } else if (existing.deleted_at) {
        sqlite.prepare("UPDATE documents SET deleted_at = NULL WHERE id = ?").run(existing.id);
      }
      const row = sqlite
        .prepare(
          `SELECT id, name, mime_type, size, sha256, status, error, created_at
         FROM documents WHERE id = ?`,
        )
        .get(existing.id) as Record<string, unknown>;
      return reply.code(200).send(documentDto(row));
    }

    const id = nanoid();
    const createdAt = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO documents(id, name, mime_type, size, sha256, original, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?)`,
      )
      .run(id, upload.filename, upload.mimetype, buffer.length, hash, buffer, createdAt);
    const row = sqlite
      .prepare(
        "SELECT id, name, mime_type, size, sha256, status, error, created_at FROM documents WHERE id = ?",
      )
      .get(id) as Record<string, unknown>;
    return reply.code(201).send(documentDto(row));
  });

  app.get("/api/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare(
        `SELECT id, name, mime_type, size, sha256, status, error, extracted_text, created_at
       FROM documents WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row
      ? documentDetailsDto(row)
      : reply.code(404).send({ error: "Dokument nicht gefunden." });
  });

  app.get("/api/documents/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare(
        "SELECT name, mime_type, original FROM documents WHERE id = ? AND deleted_at IS NULL",
      )
      .get(id) as { name: string; mime_type: string; original: Buffer } | undefined;
    if (!row) return reply.code(404).send({ error: "Dokument nicht gefunden." });
    const safeName = row.name.replace(/[\r\n"]/g, "_");
    return reply
      .header("Content-Type", row.mime_type || "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${safeName}"`)
      .send(row.original);
  });

  app.delete("/api/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = sqlite
      .prepare("UPDATE documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(new Date().toISOString(), id);
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: "Nicht gefunden." });
  });

  app.get("/api/runs", async () => {
    const rows = sqlite
      .prepare(
        `SELECT r.*, d.name AS document_name,
              EXISTS(
                SELECT 1 FROM presentations p
                WHERE p.run_id = r.id AND p.attempt_no = r.current_attempt
              ) AS has_result
       FROM runs r JOIN documents d ON d.id = r.document_id
       WHERE r.comparison_id IS NULL
       ORDER BY r.created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(runDto);
  });

  const createRunSchema = z.object({
    documentId: z.string().min(1),
    provider: z.enum(["codex", "openrouter", "aibox"]),
    model: z.string().min(1),
    mode: z.enum(["auto", "quick", "standard", "deep"]),
    presentation: z.enum(["text", "newspaper", "onepaper"]),
    imageProvider: z.enum(["comfyui", "openai", "openrouter"]).nullable().optional(),
    focus: z.string().max(4_000).optional(),
  });

  app.post("/api/runs", async (request, reply) => {
    const parsed = createRunSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const document = sqlite
      .prepare("SELECT status FROM documents WHERE id = ? AND deleted_at IS NULL")
      .get(parsed.data.documentId) as { status: string } | undefined;
    if (!document) return reply.code(404).send({ error: "Dokument nicht gefunden." });
    if (parsed.data.imageProvider) {
      const comfyui = getComfyUiConfig();
      const expectedImageProvider =
        parsed.data.provider === "codex"
          ? "openai"
          : parsed.data.provider === "openrouter"
            ? "openrouter"
            : "comfyui";
      if (parsed.data.imageProvider !== expectedImageProvider) {
        return reply.code(409).send({
          error: `Für ${parsed.data.provider} wird die Bildquelle ${expectedImageProvider} verwendet.`,
        });
      }
      if (
        parsed.data.imageProvider === "comfyui" &&
        (!comfyui.enabled || !comfyui.baseUrl || !comfyui.checkpoint)
      ) {
        return reply
          .code(409)
          .send({ error: "ComfyUI ist in den Einstellungen noch nicht vollständig aktiviert." });
      }
    }
    const id = nanoid();
    const createdAt = new Date().toISOString();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO runs(id, document_id, provider, model, mode, presentation, image_provider,
         focus, status, progress, created_at, current_attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, 1)`,
        )
        .run(
          id,
          parsed.data.documentId,
          parsed.data.provider,
          parsed.data.model,
          parsed.data.mode,
          parsed.data.presentation,
          parsed.data.imageProvider ?? null,
          parsed.data.focus ?? null,
          createdAt,
        );
      sqlite
        .prepare(
          `INSERT INTO run_attempts(run_id, attempt_no, status, started_at)
         VALUES (?, 1, 'queued', ?)`,
        )
        .run(id, createdAt);
    })();
    queueRun(id);
    return reply.code(202).send({ id });
  });

  const createComparisonSchema = z.object({
    documentId: z.string().min(1),
    mode: z.enum(["auto", "quick", "standard", "deep"]),
    presentation: z.enum(["text", "newspaper", "onepaper"]),
    focus: z.string().max(4_000).optional(),
    providers: z
      .array(
        z.object({
          provider: z.enum(["codex", "openrouter", "aibox"]),
          model: z.string().min(1),
        }),
      )
      .min(1)
      .max(3)
      .refine(
        (items) => new Set(items.map((item) => item.provider)).size === items.length,
        "Jeder Anbieter darf nur einmal ausgewählt werden.",
      ),
  });

  function comparisonDto(row: Record<string, unknown>): ComparisonRecord {
    const runRows = sqlite
      .prepare(
        `SELECT r.*, d.name AS document_name,
              EXISTS(
                SELECT 1 FROM presentations p
                WHERE p.run_id = r.id AND p.attempt_no = r.current_attempt
              ) AS has_result
       FROM runs r
       JOIN documents d ON d.id = r.document_id
       WHERE r.comparison_id = ? ORDER BY r.created_at, r.provider`,
      )
      .all(String(row.id)) as Array<Record<string, unknown>>;
    return {
      id: String(row.id),
      documentId: String(row.document_id),
      documentName: String(row.document_name ?? "Dokument"),
      mode: row.mode as ComparisonRecord["mode"],
      presentation: row.presentation as PresentationKind,
      focus: row.focus as string | null,
      createdAt: String(row.created_at),
      runs: runRows.map(runDto),
    };
  }

  app.get("/api/comparisons", async () => {
    const rows = sqlite
      .prepare(
        `SELECT c.*, d.name AS document_name FROM comparisons c
       JOIN documents d ON d.id = c.document_id ORDER BY c.created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(comparisonDto);
  });

  app.get("/api/comparisons/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare(
        `SELECT c.*, d.name AS document_name FROM comparisons c
       JOIN documents d ON d.id = c.document_id WHERE c.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? comparisonDto(row) : reply.code(404).send({ error: "Vergleich nicht gefunden." });
  });

  app.post("/api/comparisons", async (request, reply) => {
    const parsed = createComparisonSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const document = sqlite
      .prepare("SELECT status FROM documents WHERE id = ? AND deleted_at IS NULL")
      .get(parsed.data.documentId) as { status: string } | undefined;
    if (!document) return reply.code(404).send({ error: "Dokument nicht gefunden." });

    const configuredProviders = settingsDto().providers;
    const checks = await Promise.all(
      parsed.data.providers.map(async (selection) => {
        if (!configuredProviders[selection.provider].configured) {
          return { selection, reason: "Zugang nicht konfiguriert" };
        }
        try {
          const models = await services.listModels(selection.provider);
          const model = models.find((candidate) => candidate.id === selection.model);
          return model && model.available !== false
            ? { selection }
            : { selection, reason: "Modell oder Anbieter nicht erreichbar" };
        } catch (error) {
          return {
            selection,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const reachable = checks.filter(
      (check): check is { selection: (typeof parsed.data.providers)[number]; reason?: undefined } =>
        !check.reason,
    );
    const skipped = checks
      .filter((check) => check.reason)
      .map((check) => ({
        provider: check.selection.provider,
        reason: check.reason ?? "Unbekannt",
      }));
    if (!reachable.length) {
      return reply.code(409).send({
        error: "Keiner der ausgewählten Anbieter ist mit dem gewählten Modell erreichbar.",
        skipped,
      });
    }

    const comparisonId = nanoid();
    const createdAt = new Date().toISOString();
    const comfyui = getComfyUiConfig();
    const runIds: string[] = [];
    const insertComparison = sqlite.prepare(
      `INSERT INTO comparisons(id, document_id, mode, presentation, focus, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertRun = sqlite.prepare(
      `INSERT INTO runs(id, document_id, provider, model, mode, presentation, image_provider,
     focus, status, progress, created_at, comparison_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    );
    sqlite.transaction(() => {
      insertComparison.run(
        comparisonId,
        parsed.data.documentId,
        parsed.data.mode,
        parsed.data.presentation,
        parsed.data.focus ?? null,
        createdAt,
      );
      for (const { selection } of reachable) {
        const runId = nanoid();
        const imageProvider =
          selection.provider === "codex"
            ? "openai"
            : selection.provider === "openrouter"
              ? "openrouter"
              : comfyui.enabled && comfyui.baseUrl && comfyui.checkpoint
                ? "comfyui"
                : null;
        insertRun.run(
          runId,
          parsed.data.documentId,
          selection.provider,
          selection.model,
          parsed.data.mode,
          parsed.data.presentation,
          imageProvider,
          parsed.data.focus ?? null,
          createdAt,
          comparisonId,
        );
        sqlite
          .prepare(
            `INSERT INTO run_attempts(run_id, attempt_no, status, started_at)
           VALUES (?, 1, 'queued', ?)`,
          )
          .run(runId, createdAt);
        runIds.push(runId);
      }
    })();
    for (const runId of runIds) queueRun(runId);
    const row = sqlite
      .prepare(
        `SELECT c.*, d.name AS document_name FROM comparisons c
       JOIN documents d ON d.id = c.document_id WHERE c.id = ?`,
      )
      .get(comparisonId) as Record<string, unknown>;
    return reply.code(202).send({ comparison: comparisonDto(row), skipped });
  });

  app.get("/api/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { attempt?: string };
    const runRow = sqlite
      .prepare(
        "SELECT r.*, d.name AS document_name FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = ?",
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!runRow) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    const selectedAttempt = query.attempt
      ? Number(query.attempt)
      : Number(runRow.current_attempt ?? 1);
    if (!Number.isInteger(selectedAttempt) || selectedAttempt < 1) {
      return reply.code(400).send({ error: "attempt muss eine positive ganze Zahl sein." });
    }
    const attemptRows = sqlite
      .prepare("SELECT * FROM run_attempts WHERE run_id = ? ORDER BY attempt_no DESC")
      .all(id) as Array<Record<string, unknown>>;
    const selectedAttemptRow = attemptRows.find(
      (attempt) => Number(attempt.attempt_no) === selectedAttempt,
    );
    if (!selectedAttemptRow) {
      return reply.code(404).send({ error: "Versuch nicht gefunden." });
    }
    const eventRows = sqlite
      .prepare(
        `SELECT e.id, e.run_id, e.attempt_no, e.stage_id, e.type, e.level, e.message, e.created_at
       FROM events e
       LEFT JOIN run_stages s
         ON s.id = e.stage_id AND s.run_id = e.run_id AND s.attempt_no = e.attempt_no
       WHERE e.run_id = ? AND (
         e.attempt_no = ?
         OR (
           e.stage_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM run_checkpoints c
             WHERE c.run_id = e.run_id AND c.attempt_no = ?
               AND c.inherited_from_attempt = e.attempt_no
               AND c.phase = CASE
                 WHEN s.name = 'Dokumentextraktion' THEN 'extraction'
                 WHEN s.name LIKE 'Belegkarte %' THEN 'evidence'
                 WHEN s.name LIKE 'QA-Architekt · RACI-Routing%' THEN 'routing-raci'
                 WHEN s.name LIKE 'Einzelreview · %' THEN 'role-reviews'
                 WHEN s.name LIKE 'Cross-Review · %' THEN 'peer-reviews-ranking'
                 WHEN s.name = 'Council · gemeinsames Review' THEN 'joint-review'
                 WHEN s.name LIKE 'Council-Debatte · %' THEN 'pro-contra-debate'
                 WHEN s.name LIKE 'Council-Runde %' THEN 'council-rounds'
                 WHEN s.name IN ('Finale Council-Synthese', 'Dissens-Audit')
                   THEN 'synthesis-dissent'
                 WHEN s.name LIKE 'Report-%' THEN 'reports'
                 ELSE NULL
               END
           )
         )
       ) ORDER BY e.id`,
      )
      .all(id, selectedAttempt, selectedAttempt) as Array<Record<string, unknown>>;
    const artifactRows = sqlite
      .prepare(
        `SELECT a.id, a.run_id, a.attempt_no, a.stage_id, a.kind, a.title,
              a.content_type, a.sha256, a.metadata, a.created_at, length(a.content) AS size,
              s.role
       FROM artifacts a LEFT JOIN run_stages s ON s.id = a.stage_id
       WHERE a.run_id = ? AND (
         a.attempt_no = ?
         OR (
           EXISTS (
             SELECT 1 FROM run_checkpoints c
             WHERE c.run_id = a.run_id AND c.attempt_no = ?
               AND c.inherited_from_attempt = a.attempt_no
               AND c.phase = CASE
                 WHEN a.kind IN ('document-extraction', 'coverage-manifest') THEN 'extraction'
                 WHEN a.kind LIKE 'evidence%' THEN 'evidence'
                 WHEN a.kind = 'triage' OR a.kind LIKE 'triage-%' THEN 'routing-raci'
                 WHEN a.kind LIKE 'role-review%' THEN 'role-reviews'
                 WHEN a.kind LIKE 'cross-review%' THEN 'peer-reviews-ranking'
                 WHEN a.kind = 'joint-review' THEN 'joint-review'
                 WHEN a.kind LIKE 'debate-%' THEN 'pro-contra-debate'
                 WHEN a.kind LIKE 'council-round%' THEN 'council-rounds'
                 WHEN a.kind IN ('synthesis', 'dissent-pass', 'final') THEN 'synthesis-dissent'
                 WHEN a.kind LIKE 'report-%' THEN 'reports'
                 ELSE NULL
               END
           )
         )
       ) ORDER BY a.created_at, a.rowid`,
      )
      .all(id, selectedAttempt, selectedAttempt) as Array<Record<string, unknown>>;
    const stageRows = sqlite
      .prepare(
        `SELECT id, run_id, attempt_no, name, role, status, input_tokens, output_tokens,
              cost_micros, started_at, completed_at
       FROM run_stages s WHERE run_id = ? AND (
         attempt_no = ?
         OR (
           EXISTS (
             SELECT 1 FROM run_checkpoints c
             WHERE c.run_id = s.run_id AND c.attempt_no = ?
               AND c.inherited_from_attempt = s.attempt_no
               AND c.phase = CASE
                 WHEN s.name = 'Dokumentextraktion' THEN 'extraction'
                 WHEN s.name LIKE 'Belegkarte %' THEN 'evidence'
                 WHEN s.name LIKE 'QA-Architekt · RACI-Routing%' THEN 'routing-raci'
                 WHEN s.name LIKE 'Einzelreview · %' THEN 'role-reviews'
                 WHEN s.name LIKE 'Cross-Review · %' THEN 'peer-reviews-ranking'
                 WHEN s.name = 'Council · gemeinsames Review' THEN 'joint-review'
                 WHEN s.name LIKE 'Council-Debatte · %' THEN 'pro-contra-debate'
                 WHEN s.name LIKE 'Council-Runde %' THEN 'council-rounds'
                 WHEN s.name IN ('Finale Council-Synthese', 'Dissens-Audit') THEN 'synthesis-dissent'
                 WHEN s.name LIKE 'Report-%' THEN 'reports'
                 ELSE NULL
               END
           )
         )
       ) ORDER BY started_at, rowid`,
      )
      .all(id, selectedAttempt, selectedAttempt) as Array<Record<string, unknown>>;
    const presentationRows = sqlite
      .prepare(
        `SELECT id, run_id, attempt_no, kind, title, pages_json, created_at
       FROM presentations p WHERE run_id = ? AND (
         attempt_no = ?
         OR EXISTS (
           SELECT 1 FROM run_checkpoints c
           WHERE c.run_id = p.run_id AND c.attempt_no = ?
             AND c.inherited_from_attempt = p.attempt_no AND c.phase = 'reports'
         )
       ) ORDER BY created_at`,
      )
      .all(id, selectedAttempt, selectedAttempt) as Array<Record<string, unknown>>;
    const question = sqlite
      .prepare(
        `SELECT id, prompt FROM run_questions
       WHERE run_id = ? AND attempt_no = ? AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id, selectedAttempt) as { id: string; prompt: string } | undefined;
    const attemptDto = (row: Record<string, unknown>): RunAttemptRecord => ({
      attempt: Number(row.attempt_no),
      status: row.status as RunAttemptRecord["status"],
      startedAt: String(row.started_at),
      completedAt: row.completed_at as string | null,
      error: row.error as string | null,
      predecessorAttempt: row.predecessor_attempt as number | null,
      resumePhase: row.resume_phase as string | null,
    });
    const result: RunDetails = {
      run: runDto(runRow),
      attempt: attemptDto(selectedAttemptRow),
      attempts: attemptRows.map(attemptDto),
      stages: stageRows.map((row) => {
        return {
          id: String(row.id),
          runId: String(row.run_id),
          attemptNo: selectedAttempt,
          originAttempt: Number(row.attempt_no),
          name: String(row.name),
          role: row.role as string | null,
          status: row.status as RunStageRecord["status"],
          inputTokens: Number(row.input_tokens),
          outputTokens: Number(row.output_tokens),
          costMicros: Number(row.cost_micros),
          startedAt: String(row.started_at),
          completedAt: row.completed_at as string | null,
        } satisfies RunStageRecord;
      }),
      events: eventRows.map(
        (row) =>
          ({
            id: Number(row.id),
            runId: String(row.run_id),
            attemptNo: selectedAttempt,
            originAttempt: Number(row.attempt_no),
            stageId: row.stage_id as string | null,
            type: String(row.type),
            level: row.level as RunEvent["level"],
            message: String(row.message),
            createdAt: String(row.created_at),
          }) satisfies RunEvent,
      ),
      artifacts: artifactRows.map(
        (row) =>
          ({
            id: String(row.id),
            runId: String(row.run_id),
            attemptNo: selectedAttempt,
            originAttempt: Number(row.attempt_no),
            stageId: row.stage_id as string | null,
            kind: String(row.kind),
            title: String(row.title),
            contentType: String(row.content_type),
            sha256: String(row.sha256),
            metadata: safeParse(row.metadata, undefined),
            role: row.role as string | null,
            phase: workflowPhaseForArtifact(String(row.kind)),
            size: Number(row.size),
            createdAt: String(row.created_at),
          }) satisfies ArtifactRecord,
      ),
      presentations: presentationRows.map(
        (row) =>
          ({
            id: String(row.id),
            runId: String(row.run_id),
            attemptNo: selectedAttempt,
            originAttempt: Number(row.attempt_no),
            kind: row.kind as PresentationKind,
            title: String(row.title),
            pageCount: safeParse<unknown[]>(row.pages_json, []).length,
            createdAt: String(row.created_at),
          }) satisfies PresentationRecord,
      ),
      question: question ?? null,
    };
    return result;
  });

  app.get("/api/runs/:id/activity", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { attempt?: string; afterEventId?: string };
    const run = sqlite.prepare("SELECT current_attempt FROM runs WHERE id = ?").get(id) as
      | { current_attempt: number }
      | undefined;
    if (!run) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    const attempt = query.attempt ? Number(query.attempt) : run.current_attempt;
    const afterEventId = query.afterEventId ? Number(query.afterEventId) : 0;
    if (
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      !Number.isInteger(afterEventId) ||
      afterEventId < 0
    ) {
      return reply.code(400).send({ error: "Ungültiger Activity-Cursor." });
    }
    const rows = sqlite
      .prepare(
        `SELECT e.id, e.run_id, e.attempt_no, e.stage_id, e.type, e.level, e.message,
                e.data, e.created_at
       FROM events e
       LEFT JOIN run_stages s
         ON s.id = e.stage_id AND s.run_id = e.run_id AND s.attempt_no = e.attempt_no
       WHERE e.run_id = ? AND e.id > ? AND (
         e.attempt_no = ?
         OR (
           e.stage_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM run_checkpoints c
             WHERE c.run_id = e.run_id AND c.attempt_no = ?
               AND c.inherited_from_attempt = e.attempt_no
               AND c.phase = CASE
                 WHEN s.name = 'Dokumentextraktion' THEN 'extraction'
                 WHEN s.name LIKE 'Belegkarte %' THEN 'evidence'
                 WHEN s.name LIKE 'QA-Architekt · RACI-Routing%' THEN 'routing-raci'
                 WHEN s.name LIKE 'Einzelreview · %' THEN 'role-reviews'
                 WHEN s.name LIKE 'Cross-Review · %' THEN 'peer-reviews-ranking'
                 WHEN s.name = 'Council · gemeinsames Review' THEN 'joint-review'
                 WHEN s.name LIKE 'Council-Debatte · %' THEN 'pro-contra-debate'
                 WHEN s.name LIKE 'Council-Runde %' THEN 'council-rounds'
                 WHEN s.name IN ('Finale Council-Synthese', 'Dissens-Audit')
                   THEN 'synthesis-dissent'
                 WHEN s.name LIKE 'Report-%' THEN 'reports'
                 ELSE NULL
               END
           )
         )
       )
       ORDER BY e.id LIMIT 500`,
      )
      .all(id, afterEventId, attempt, attempt) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const parsedData = safeParse<Record<string, unknown> | undefined>(row.data, undefined);
      const data =
        row.type === "assistant_message" && typeof parsedData?.markdown === "string"
          ? {
              ...parsedData,
              markdown: undefined,
              markdownHtml: cachedMarkdownHtml(parsedData.markdown),
            }
          : parsedData;
      return {
        id: Number(row.id),
        runId: String(row.run_id),
        attemptNo: attempt,
        originAttempt: Number(row.attempt_no),
        stageId: row.stage_id as string | null,
        type: String(row.type),
        level: row.level as RunEvent["level"],
        message: String(row.message),
        data,
        createdAt: String(row.created_at),
      } satisfies RunEvent;
    });
  });

  app.get("/api/runs/:id/files", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { attempt?: string; kind?: string };
    const run = sqlite.prepare("SELECT current_attempt FROM runs WHERE id = ?").get(id) as
      | { current_attempt: number }
      | undefined;
    if (!run) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    const attempt = query.attempt ? Number(query.attempt) : run.current_attempt;
    if (!Number.isInteger(attempt) || attempt < 1) {
      return reply.code(400).send({ error: "Ungültiger Versuch." });
    }
    const rows = sqlite
      .prepare(
        `SELECT a.id, a.run_id, a.attempt_no, a.stage_id, a.kind, a.title,
              a.content_type, a.sha256, a.metadata, a.created_at,
              length(a.content) AS size, s.role
       FROM artifacts a LEFT JOIN run_stages s ON s.id = a.stage_id
       WHERE a.run_id = ? AND (
         a.attempt_no = ?
         OR (
           EXISTS (
             SELECT 1 FROM run_checkpoints c
             WHERE c.run_id = a.run_id AND c.attempt_no = ?
               AND c.inherited_from_attempt = a.attempt_no
               AND c.phase = CASE
                 WHEN a.kind IN ('document-extraction', 'coverage-manifest') THEN 'extraction'
                 WHEN a.kind LIKE 'evidence%' THEN 'evidence'
                 WHEN a.kind = 'triage' OR a.kind LIKE 'triage-%' THEN 'routing-raci'
                 WHEN a.kind LIKE 'role-review%' THEN 'role-reviews'
                 WHEN a.kind LIKE 'cross-review%' THEN 'peer-reviews-ranking'
                 WHEN a.kind = 'joint-review' THEN 'joint-review'
                 WHEN a.kind LIKE 'debate-%' THEN 'pro-contra-debate'
                 WHEN a.kind LIKE 'council-round%' THEN 'council-rounds'
                 WHEN a.kind IN ('synthesis', 'dissent-pass', 'final') THEN 'synthesis-dissent'
                 WHEN a.kind LIKE 'report-%' THEN 'reports'
                 ELSE NULL
               END
           )
         )
       ) AND (? IS NULL OR a.kind = ?)
       ORDER BY a.created_at, a.rowid`,
      )
      .all(id, attempt, attempt, query.kind ?? null, query.kind ?? null) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      attemptNo: attempt,
      originAttempt: Number(row.attempt_no),
      stageId: row.stage_id as string | null,
      kind: String(row.kind),
      role: row.role as string | null,
      phase: workflowPhaseForArtifact(String(row.kind)),
      title: String(row.title),
      contentType: String(row.content_type),
      sha256: String(row.sha256),
      metadata: safeParse(row.metadata, undefined),
      size: Number(row.size),
      createdAt: String(row.created_at),
      contentUrl: `/api/runs/${id}/files/${row.id}`,
      downloadUrl: `/api/runs/${id}/files/${row.id}?download=1`,
    }));
  });

  app.get("/api/runs/:id/files/:artifactId", async (request, reply) => {
    const { id, artifactId } = request.params as { id: string; artifactId: string };
    const query = request.query as { download?: string };
    const row = sqlite
      .prepare(
        `SELECT id, run_id, attempt_no, kind, title, content_type, content, sha256,
              metadata, created_at FROM artifacts WHERE id = ? AND run_id = ?`,
      )
      .get(artifactId, id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Datei nicht gefunden." });
    if (query.download === "1") {
      const filename = `${String(row.title).replace(/[^\p{L}\p{N}._-]+/gu, "-") || "artefakt"}.md`;
      return reply
        .header("Content-Type", String(row.content_type))
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(String(row.content));
    }
    const content = String(row.content);
    return {
      id: String(row.id),
      runId: String(row.run_id),
      attemptNo: Number(row.attempt_no),
      originAttempt: Number(row.attempt_no),
      kind: String(row.kind),
      phase: workflowPhaseForArtifact(String(row.kind)),
      title: String(row.title),
      contentType: String(row.content_type),
      content,
      contentHtml:
        String(row.content_type) === "text/markdown" ? cachedMarkdownHtml(content) : undefined,
      sha256: String(row.sha256),
      metadata: safeParse(row.metadata, undefined),
      createdAt: String(row.created_at),
    };
  });

  app.get("/api/runs/:id/derived-analyses/top10", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { attempt?: string };
    const run = sqlite.prepare("SELECT current_attempt FROM runs WHERE id = ?").get(id) as
      | { current_attempt: number }
      | undefined;
    if (!run) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    const attempt = query.attempt ? Number(query.attempt) : run.current_attempt;
    if (!Number.isInteger(attempt) || attempt < 1) {
      return reply.code(400).send({ error: "attempt muss eine positive ganze Zahl sein." });
    }
    const exists = sqlite
      .prepare("SELECT 1 FROM run_attempts WHERE run_id = ? AND attempt_no = ?")
      .get(id, attempt);
    if (!exists) return reply.code(404).send({ error: "Versuch nicht gefunden." });
    return getLatestDerivedAnalysis(id, undefined, attempt);
  });

  app.post("/api/runs/:id/derived-analyses", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ kind: z.literal("top10_next_steps") }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    try {
      const result = startDerivedAnalysis({ runId: id, kind: parsed.data.kind });
      return reply.code(result.reused ? 200 : 202).send(result.job);
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/derived-analyses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return getDerivedAnalysis(id) ?? reply.code(404).send({ error: "Analyse nicht gefunden." });
  });

  app.post("/api/derived-analyses/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = cancelDerivedAnalysis(id);
    if (result === "not_found") return reply.code(404).send({ error: "Analyse nicht gefunden." });
    if (result === "not_active")
      return reply.code(409).send({ error: "Analyse ist nicht mehr aktiv." });
    return reply.code(202).send({ ok: true });
  });

  app.put("/api/runs/archive-all", async () => {
    const archivedAt = new Date().toISOString();
    const result = sqlite
      .prepare(
        `UPDATE runs SET archived_at = ?
       WHERE comparison_id IS NULL AND archived_at IS NULL
         AND status IN ('completed', 'failed', 'cancelled')`,
      )
      .run(archivedAt);
    return { archived: result.changes, archivedAt };
  });

  app.put("/api/runs/:id/archive", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ archived: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const run = sqlite.prepare("SELECT status FROM runs WHERE id = ?").get(id) as
      | { status: string }
      | undefined;
    if (!run) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    if (isRunExecuting(id)) {
      return reply.code(409).send({
        error: "Der Lauf wird noch beendet. Bitte versuche das Archivieren gleich erneut.",
      });
    }
    if (!["completed", "failed", "cancelled"].includes(run.status)) {
      return reply.code(409).send({ error: "Nur beendete Läufe können archiviert werden." });
    }
    sqlite
      .prepare("UPDATE runs SET archived_at = ? WHERE id = ?")
      .run(parsed.data.archived ? new Date().toISOString() : null, id);
    return reply.code(204).send();
  });

  app.delete("/api/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = sqlite.prepare("SELECT status FROM runs WHERE id = ?").get(id) as
      | { status: string }
      | undefined;
    if (!run) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    if (isRunExecuting(id)) {
      return reply
        .code(409)
        .send({ error: "Der Lauf wird noch beendet. Bitte versuche das Löschen gleich erneut." });
    }
    if (!["failed", "cancelled"].includes(run.status)) {
      return reply
        .code(409)
        .send({ error: "Nur fehlgeschlagene oder abgebrochene Läufe dürfen gelöscht werden." });
    }
    sqlite.prepare("DELETE FROM runs WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  app.post("/api/runs/:id/restart", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = sqlite.prepare("SELECT id FROM runs WHERE id = ?").get(id);
    if (!run) return reply.code(404).send({ error: "Lauf nicht gefunden." });
    const restarted = restartRun(id, false);
    if (!restarted) {
      return reply.code(409).send({
        error: "Der Lauf ist nicht fehlgeschlagen, bereits beansprucht oder archiviert.",
      });
    }
    queueRun(id);
    return reply
      .code(202)
      .send({ runId: id, attempt: restarted.attempt, resumeFrom: restarted.resumeFrom });
  });

  app.post("/api/runs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = services.cancelRun(id);
    if (result === "not_found") {
      return reply.code(404).send({ error: "Lauf nicht gefunden." });
    }
    if (result === "not_active") {
      return reply.code(409).send({ error: "Dieser Lauf ist nicht mehr aktiv." });
    }
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/runs/:id/answer", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ questionId: z.string(), answer: z.string().min(1).max(8_000) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    if (!services.resumeRunWithAnswer(id, parsed.data.questionId, parsed.data.answer, false)) {
      return reply.code(409).send({
        error: "Die Rückfrage ist nicht mehr offen oder der Lauf wartet nicht auf Eingabe.",
      });
    }
    queueRun(id);
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/runs/:id/presentations", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ kind: z.enum(["text", "newspaper", "onepaper"]) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    try {
      const presentationId = await generateAdditionalPresentation(id, parsed.data.kind);
      return reply.code(201).send({ id: presentationId });
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/runs/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare(
        `SELECT a.content FROM artifacts a JOIN runs r ON r.id = a.run_id
       WHERE a.run_id = ? AND a.attempt_no = r.current_attempt AND a.kind = 'final'
       ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(id) as { content: string } | undefined;
    if (!row) return reply.code(404).send({ error: "Finales Ergebnis fehlt." });
    return reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename=qa-council-${id}.md`)
      .send(row.content);
  });

  app.get("/api/presentations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare(
        `SELECT id, run_id, attempt_no, kind, title, html, pages_json, created_at
       FROM presentations WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          run_id: string;
          attempt_no: number;
          kind: PresentationKind;
          title: string;
          html: string;
          pages_json: string;
          created_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          runId: row.run_id,
          attemptNo: row.attempt_no,
          originAttempt: row.attempt_no,
          kind: row.kind,
          title: row.title,
          html: hydratePresentationImages(row.html),
          pages: safeParse<PresentationRecord["pages"]>(row.pages_json, [])?.map((page) => ({
            ...page,
            html: hydratePresentationImages(page.html),
          })),
          createdAt: row.created_at,
        }
      : reply.code(404).send({ error: "Darstellung nicht gefunden." });
  });

  app.get("/api/presentations/:id/pdf", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare("SELECT kind, title, html FROM presentations WHERE id = ?")
      .get(id) as { kind: PresentationKind; title: string; html: string } | undefined;
    if (!row) return reply.code(404).send({ error: "Darstellung nicht gefunden." });
    if (row.kind !== "onepaper") {
      return reply.code(409).send({ error: "PDF-Export ist für den Visual Report verfügbar." });
    }
    try {
      const pdf = await createPresentationPdf(hydratePresentationImages(row.html), row.title);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="qa-visual-report-${id}.pdf"`)
        .send(pdf);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "PDF konnte nicht erzeugt werden." });
    }
  });

  app.get("/api/providers/:provider/models", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!(["codex", "openrouter", "aibox"] as const).includes(provider as ProviderId)) {
      return reply.code(404).send({ error: "Unbekannter Anbieter." });
    }
    return services.listModels(provider as ProviderId);
  });

  app.get("/api/providers/aibox/embedding-models", async (_request, reply) => {
    try {
      return await services.listAiBoxEmbeddingModels();
    } catch (error) {
      return reply.code(502).send({
        error:
          error instanceof Error
            ? error.message
            : "AI-Box-Embedding-Modelle konnten nicht geladen werden.",
      });
    }
  });

  app.post("/api/comfyui/discover", async (request, reply) => {
    const parsed = z.object({ baseUrl: z.string().url() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    try {
      return await discoverComfyUi(parsed.data.baseUrl);
    } catch (error) {
      return reply.code(502).send({
        error: `ComfyUI ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.get("/api/images/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = sqlite
      .prepare("SELECT mime_type, data FROM generated_images WHERE id = ?")
      .get(id) as { mime_type: string; data: Buffer } | undefined;
    if (!row) return reply.code(404).send({ error: "Bild nicht gefunden." });
    return reply
      .header("Content-Type", row.mime_type)
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(row.data);
  });

  function settingsDto(): AppSettings {
    const rows = sqlite
      .prepare("SELECT provider, model, base_url, encrypted_api_key FROM provider_settings")
      .all() as Array<{
      provider: ProviderId;
      model: string;
      base_url: string | null;
      encrypted_api_key: string | null;
    }>;
    const provider = (id: ProviderId) => {
      const row = rows.find((candidate) => candidate.provider === id);
      if (!row) throw new Error(`Fehlende Einstellungen für ${id}`);
      const storedSecret = decryptSecret(row.encrypted_api_key);
      const configured =
        id === "codex"
          ? services.codexAuthStatus().configured
          : id === "openrouter"
            ? Boolean(storedSecret || process.env.OPENROUTER_API_KEY)
            : Boolean(row.base_url);
      const imageConfigured =
        id === "codex"
          ? Boolean(storedSecret || process.env.OPENAI_API_KEY)
          : id === "openrouter"
            ? Boolean(storedSecret || process.env.OPENROUTER_API_KEY)
            : Boolean(getComfyUiConfig().enabled);
      return {
        model: row.model,
        configured,
        imageConfigured,
        ...(row.base_url ? { baseUrl: row.base_url } : {}),
      };
    };
    const language = sqlite
      .prepare("SELECT value FROM app_settings WHERE key = 'automaticLanguage'")
      .get() as { value: string } | undefined;
    const routing = sqlite
      .prepare("SELECT value FROM app_settings WHERE key = 'openRouterRouting'")
      .get() as { value: string } | undefined;
    const embedding = embeddingConfig();
    const comfyui = getComfyUiConfig();
    return {
      providers: {
        codex: provider("codex"),
        openrouter: provider("openrouter"),
        aibox: provider("aibox"),
      },
      automaticLanguage: language?.value !== "false",
      openRouterRouting:
        routing?.value === "lowest" || routing?.value === "fastest" ? routing.value : "balanced",
      embedding: {
        ...embedding,
        configured: Boolean(provider("aibox").baseUrl && embedding.model),
      },
      comfyui: {
        ...comfyui,
        configured: Boolean(comfyui.baseUrl && comfyui.checkpoint),
      },
    };
  }

  app.get("/api/settings", async () => settingsDto());

  app.put("/api/settings", async (request, reply) => {
    const parsed = z
      .object({
        automaticLanguage: z.boolean(),
        openRouterRouting: z.enum(["balanced", "lowest", "fastest"]),
        embedding: z.object({
          enabled: z.boolean(),
          model: z.string().min(1),
          dimensions: z.literal(EMBEDDING_DIMENSIONS),
        }),
        comfyui: z
          .object({
            enabled: z.boolean(),
            baseUrl: z.union([z.string().url(), z.literal("")]),
            checkpoint: z.string(),
          })
          .superRefine((value, context) => {
            if (!value.enabled) return;
            if (!value.baseUrl) {
              context.addIssue({
                code: "custom",
                path: ["baseUrl"],
                message: "Für aktiviertes ComfyUI ist eine Serveradresse erforderlich.",
              });
            }
            if (!value.checkpoint.trim()) {
              context.addIssue({
                code: "custom",
                path: ["checkpoint"],
                message: "Für aktiviertes ComfyUI ist ein Checkpoint erforderlich.",
              });
            }
          }),
        providers: z.record(
          z.enum(["codex", "openrouter", "aibox"]),
          z.object({
            model: z.string().min(1),
            baseUrl: z.union([z.string().url(), z.literal("")]).optional(),
            apiKey: z.string().optional(),
          }),
        ),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const update = sqlite.prepare(
      `UPDATE provider_settings SET model = ?,
     base_url = CASE WHEN ? = 1 THEN ? ELSE base_url END,
     encrypted_api_key = COALESCE(?, encrypted_api_key), updated_at = ? WHERE provider = ?`,
    );
    const transaction = sqlite.transaction(() => {
      for (const id of ["codex", "openrouter", "aibox"] as const) {
        const value = parsed.data.providers[id];
        update.run(
          value.model,
          value.baseUrl !== undefined ? 1 : 0,
          value.baseUrl || null,
          value.apiKey ? encryptSecret(value.apiKey) : null,
          new Date().toISOString(),
          id,
        );
      }
      sqlite
        .prepare(
          "INSERT INTO app_settings(key, value) VALUES ('automaticLanguage', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(String(parsed.data.automaticLanguage));
      sqlite
        .prepare(
          "INSERT INTO app_settings(key, value) VALUES ('openRouterRouting', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(parsed.data.openRouterRouting);
      sqlite
        .prepare(
          "INSERT INTO app_settings(key, value) VALUES ('embeddingConfig', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(parsed.data.embedding));
      saveComfyUiConfig(parsed.data.comfyui);
    });
    transaction();
    return settingsDto();
  });

  interface LoginState {
    status: "starting" | "waiting" | "completed" | "failed";
    message: string;
    url?: string;
    userCode?: string;
  }
  const logins = new Map<string, LoginState>();

  app.post("/api/auth/codex/start", async (_request, reply) => {
    const id = nanoid();
    logins.set(id, { status: "starting", message: "Anmeldung wird vorbereitet …" });
    void services
      .getAuthStorage()
      .login("openai-codex", {
        onAuth: ({ url, instructions }) => {
          logins.set(id, {
            status: "waiting",
            message: instructions ?? "Öffne die Anmeldeseite.",
            url,
          });
        },
        onDeviceCode: ({ userCode, verificationUri }) => {
          logins.set(id, {
            status: "waiting",
            message: "Code auf der OpenAI-Seite bestätigen.",
            url: verificationUri,
            userCode,
          });
        },
        onPrompt: async () => {
          throw new Error(
            "Interaktive Eingabe nötig. Führe ersatzweise `pi /login` im Container aus.",
          );
        },
        onManualCodeInput: async () => {
          throw new Error("Manueller Code nötig. Führe ersatzweise `pi /login` im Container aus.");
        },
        onSelect: async ({ options }) => options[0]?.id,
        onProgress: (message) => {
          const state = logins.get(id);
          if (state) logins.set(id, { ...state, message });
        },
      })
      .then(() => logins.set(id, { status: "completed", message: "Codex ist angemeldet." }))
      .catch((error) =>
        logins.set(id, {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    return reply.code(202).send({ id });
  });

  app.get("/api/auth/codex/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const state = logins.get(id);
    return state ?? reply.code(404).send({ error: "Anmeldung nicht gefunden." });
  });

  const webRoot = options.webRoot === undefined ? path.resolve("dist/web") : options.webRoot;
  if (webRoot && fs.existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }
  return app;
}
