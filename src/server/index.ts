import fs from "node:fs";
import path from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  AppSettings,
  ArtifactRecord,
  DocumentRecord,
  PresentationKind,
  PresentationRecord,
  ProviderId,
  RunDetails,
  RunEvent,
  RunRecord,
} from "../shared/types.js";
import { encryptSecret } from "./crypto.js";
import { sqlite } from "./db/index.js";
import { extractDocument } from "./extract.js";
import { enqueueRun, generateAdditionalPresentation, resumeRunWithAnswer } from "./orchestrator.js";
import { authStorage, codexAuthStatus, listModels } from "./providers.js";
import { sha256 } from "./skills.js";

const app = Fastify({ logger: true, bodyLimit: 52_428_800 });
await app.register(multipart, { limits: { fileSize: 52_428_800, files: 1 } });

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

function runDto(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    documentName: String(row.document_name ?? "Dokument"),
    provider: row.provider as ProviderId,
    model: String(row.model),
    mode: row.mode as RunRecord["mode"],
    resolvedMode: row.resolved_mode as RunRecord["resolvedMode"],
    presentation: row.presentation as PresentationKind,
    focus: row.focus as string | null,
    status: row.status as RunRecord["status"],
    progress: Number(row.progress),
    currentStage: row.current_stage as string | null,
    error: row.error as string | null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at as string | null,
  };
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/documents", async () => {
  const rows = sqlite
    .prepare(
      "SELECT id, name, mime_type, size, sha256, status, error, created_at FROM documents ORDER BY created_at DESC",
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
      "SELECT id, name, mime_type, size, sha256, status, error, created_at FROM documents WHERE sha256 = ?",
    )
    .get(hash) as Record<string, unknown> | undefined;
  if (existing) return reply.code(200).send(documentDto(existing));

  const id = nanoid();
  const createdAt = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO documents(id, name, mime_type, size, sha256, original, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'extracting', ?)`,
    )
    .run(id, upload.filename, upload.mimetype, buffer.length, hash, buffer, createdAt);
  try {
    const extracted = await extractDocument(upload.filename, upload.mimetype, buffer);
    const insert = sqlite.prepare(
      "INSERT INTO document_chunks(id, document_id, position, locator, content, sha256) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const transaction = sqlite.transaction(() => {
      for (const chunk of extracted.chunks) {
        insert.run(chunk.id, id, chunk.position, chunk.locator, chunk.content, chunk.sha256);
      }
      sqlite
        .prepare("UPDATE documents SET extracted_text = ?, status = 'ready' WHERE id = ?")
        .run(extracted.text, id);
    });
    transaction();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sqlite
      .prepare("UPDATE documents SET status = 'failed', error = ? WHERE id = ?")
      .run(message, id);
  }
  const row = sqlite
    .prepare(
      "SELECT id, name, mime_type, size, sha256, status, error, created_at FROM documents WHERE id = ?",
    )
    .get(id) as Record<string, unknown>;
  return reply.code(201).send(documentDto(row));
});

app.delete("/api/documents/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = sqlite.prepare("DELETE FROM documents WHERE id = ?").run(id);
  return result.changes
    ? reply.code(204).send()
    : reply.code(404).send({ error: "Nicht gefunden." });
});

app.get("/api/runs", async () => {
  const rows = sqlite
    .prepare(
      `SELECT r.*, d.name AS document_name FROM runs r JOIN documents d ON d.id = r.document_id
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
  focus: z.string().max(4_000).optional(),
});

app.post("/api/runs", async (request, reply) => {
  const parsed = createRunSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  const document = sqlite
    .prepare("SELECT status FROM documents WHERE id = ?")
    .get(parsed.data.documentId) as { status: string } | undefined;
  if (!document) return reply.code(404).send({ error: "Dokument nicht gefunden." });
  if (document.status !== "ready")
    return reply.code(409).send({ error: "Dokument ist noch nicht bereit." });
  const id = nanoid();
  sqlite
    .prepare(
      `INSERT INTO runs(id, document_id, provider, model, mode, presentation, focus, status, progress, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
    )
    .run(
      id,
      parsed.data.documentId,
      parsed.data.provider,
      parsed.data.model,
      parsed.data.mode,
      parsed.data.presentation,
      parsed.data.focus ?? null,
      new Date().toISOString(),
    );
  enqueueRun(id);
  return reply.code(202).send({ id });
});

app.get("/api/runs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const runRow = sqlite
    .prepare(
      "SELECT r.*, d.name AS document_name FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = ?",
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!runRow) return reply.code(404).send({ error: "Lauf nicht gefunden." });
  const eventRows = sqlite
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id")
    .all(id) as Array<Record<string, unknown>>;
  const artifactRows = sqlite
    .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at")
    .all(id) as Array<Record<string, unknown>>;
  const presentationRows = sqlite
    .prepare("SELECT * FROM presentations WHERE run_id = ? ORDER BY created_at")
    .all(id) as Array<Record<string, unknown>>;
  const question = sqlite
    .prepare(
      "SELECT id, prompt FROM run_questions WHERE run_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    )
    .get(id) as { id: string; prompt: string } | undefined;
  const result: RunDetails = {
    run: runDto(runRow),
    events: eventRows.map(
      (row) =>
        ({
          id: Number(row.id),
          runId: String(row.run_id),
          stageId: row.stage_id as string | null,
          type: String(row.type),
          level: row.level as RunEvent["level"],
          message: String(row.message),
          data: row.data ? JSON.parse(String(row.data)) : undefined,
          createdAt: String(row.created_at),
        }) satisfies RunEvent,
    ),
    artifacts: artifactRows.map(
      (row) =>
        ({
          id: String(row.id),
          runId: String(row.run_id),
          kind: String(row.kind),
          title: String(row.title),
          contentType: String(row.content_type),
          content: String(row.content),
          sha256: String(row.sha256),
          metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
          createdAt: String(row.created_at),
        }) satisfies ArtifactRecord,
    ),
    presentations: presentationRows.map(
      (row) =>
        ({
          id: String(row.id),
          runId: String(row.run_id),
          kind: row.kind as PresentationKind,
          title: String(row.title),
          html: String(row.html),
          createdAt: String(row.created_at),
        }) satisfies PresentationRecord,
    ),
    question: question ?? null,
  };
  return result;
});

app.post("/api/runs/:id/answer", async (request, reply) => {
  const { id } = request.params as { id: string };
  const parsed = z
    .object({ questionId: z.string(), answer: z.string().min(1).max(8_000) })
    .safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  resumeRunWithAnswer(id, parsed.data.questionId, parsed.data.answer);
  return reply.code(202).send({ ok: true });
});

app.post("/api/runs/:id/presentations", async (request, reply) => {
  const { id } = request.params as { id: string };
  const parsed = z
    .object({ kind: z.enum(["text", "newspaper", "onepaper"]) })
    .safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  try {
    await generateAdditionalPresentation(id, parsed.data.kind);
    return reply.code(201).send({ ok: true });
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/runs/:id/download", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = sqlite
    .prepare(
      "SELECT content FROM artifacts WHERE run_id = ? AND kind = 'final' ORDER BY created_at DESC LIMIT 1",
    )
    .get(id) as { content: string } | undefined;
  if (!row) return reply.code(404).send({ error: "Finales Ergebnis fehlt." });
  return reply
    .header("Content-Type", "text/markdown; charset=utf-8")
    .header("Content-Disposition", `attachment; filename=qa-council-${id}.md`)
    .send(row.content);
});

app.get("/api/providers/:provider/models", async (request, reply) => {
  const { provider } = request.params as { provider: string };
  if (!(["codex", "openrouter", "aibox"] as const).includes(provider as ProviderId)) {
    return reply.code(404).send({ error: "Unbekannter Anbieter." });
  }
  return listModels(provider as ProviderId);
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
    const configured =
      id === "codex"
        ? codexAuthStatus().configured
        : id === "openrouter"
          ? Boolean(row.encrypted_api_key || process.env.OPENROUTER_API_KEY)
          : true;
    return { model: row.model, configured, ...(row.base_url ? { baseUrl: row.base_url } : {}) };
  };
  const language = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = 'automaticLanguage'")
    .get() as { value: string } | undefined;
  return {
    providers: {
      codex: provider("codex"),
      openrouter: provider("openrouter"),
      aibox: provider("aibox"),
    },
    automaticLanguage: language?.value !== "false",
  };
}

app.get("/api/settings", async () => settingsDto());

app.put("/api/settings", async (request, reply) => {
  const parsed = z
    .object({
      automaticLanguage: z.boolean(),
      providers: z.record(
        z.enum(["codex", "openrouter", "aibox"]),
        z.object({
          model: z.string().min(1),
          baseUrl: z.string().url().optional(),
          apiKey: z.string().optional(),
        }),
      ),
    })
    .safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  const update = sqlite.prepare(
    `UPDATE provider_settings SET model = ?, base_url = COALESCE(?, base_url),
     encrypted_api_key = COALESCE(?, encrypted_api_key), updated_at = ? WHERE provider = ?`,
  );
  const transaction = sqlite.transaction(() => {
    for (const id of ["codex", "openrouter", "aibox"] as const) {
      const value = parsed.data.providers[id];
      update.run(
        value.model,
        value.baseUrl ?? null,
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
  void authStorage
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

const webRoot = path.resolve("dist/web");
if (fs.existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
}

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
