import type { EmbeddingModel } from "../shared/types.js";
import { sqlite } from "./db/index.js";
import type { QaRole, RaciCatalogRow } from "./raci.js";
import { QA_ROLES, raciCatalog } from "./raci.js";
import { safeParse } from "./safe-json.js";
import { sha256 } from "./skills.js";

export const RETRIEVAL_SCHEMA_VERSION = 1;
export const EMBEDDING_DIMENSIONS = 4096;
export const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:8b";

const PASSAGE_TARGET_CHARS = 1_800;
const PASSAGE_MIN_CHARS = 700;
const MAX_EXCERPT_CHARS = 620;
const RACI_HINTS_PER_CHUNK = 4;
const NEIGHBORS_PER_CHUNK = 5;
const EMBEDDING_BATCH_SIZE = 8;

const STOP_WORDS = new Set([
  "aber",
  "alle",
  "auch",
  "aus",
  "bei",
  "bzw",
  "das",
  "dass",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "dies",
  "durch",
  "eine",
  "einem",
  "einen",
  "einer",
  "eines",
  "für",
  "ist",
  "mit",
  "nach",
  "oder",
  "sich",
  "sind",
  "und",
  "von",
  "vor",
  "wird",
  "werden",
  "zum",
  "zur",
  "from",
  "into",
  "that",
  "the",
  "this",
  "with",
]);

export interface EmbeddingConfig {
  enabled: boolean;
  model: string;
  dimensions: number;
}

export interface RetrievalChunk {
  id: string;
  position: number;
  locator: string;
  content: string;
  sha256: string;
}

export interface RetrievalPassage {
  id: string;
  documentId: string;
  chunkId: string;
  position: number;
  startOffset: number;
  endOffset: number;
  content: string;
  sha256: string;
}

export interface RaciHint {
  activityId: string;
  activity: string;
  score: number;
  coreRoles: QaRole[];
  consultantRoles: QaRole[];
}

export interface ChunkNeighbor {
  chunkId: string;
  locator: string;
  score: number;
  reasons: string[];
}

export interface ChunkRetrievalHint {
  chunkId: string;
  position: number;
  locator: string;
  sha256: string;
  activities: RaciHint[];
  neighbors: ChunkNeighbor[];
  excerpts: string[];
  exactTerms: string[];
}

export interface RetrievalDossier {
  version: number;
  documentId: string;
  embedding: {
    status: "ready" | "disabled" | "unavailable";
    model: string;
    dimensions: number;
    error?: string;
  };
  chunks: ChunkRetrievalHint[];
  cards: Array<{ title: string; content: string; hint: ChunkRetrievalHint }>;
  markdown: string;
  relationshipManifest: string;
}

export type EmbedFunction = (
  inputs: string[],
  options: { model: string; dimensions: number; signal?: AbortSignal },
) => Promise<number[][]>;

interface EmbeddingSource {
  kind: "chunk" | "passage" | "raci";
  sourceId: string;
  documentId: string | null;
  chunkId: string;
  sourceHash: string;
  text: string;
}

interface VectorMatch {
  source_id: string;
  distance: number;
}

function appSetting(key: string) {
  return sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
}

export function embeddingConfig(): EmbeddingConfig {
  const parsed = safeParse<Partial<EmbeddingConfig>>(appSetting("embeddingConfig")?.value, {});
  return {
    enabled: parsed.enabled !== false,
    model: parsed.model?.trim() || DEFAULT_EMBEDDING_MODEL,
    dimensions:
      parsed.dimensions === EMBEDDING_DIMENSIONS ? parsed.dimensions : EMBEDDING_DIMENSIONS,
  };
}

export function embeddingConfigFingerprint() {
  return sha256(JSON.stringify({ version: RETRIEVAL_SCHEMA_VERSION, ...embeddingConfig() }));
}

function aiboxBaseUrl() {
  const row = sqlite
    .prepare("SELECT base_url FROM provider_settings WHERE provider = 'aibox'")
    .get() as { base_url: string | null } | undefined;
  return row?.base_url?.trim().replace(/\/$/, "") ?? "";
}

export async function listAiBoxEmbeddingModels(): Promise<EmbeddingModel[]> {
  const baseUrl = aiboxBaseUrl();
  if (!baseUrl) return [];
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Ollama-Modellliste fehlgeschlagen (${response.status}).`);
  const data = (await response.json()) as { models?: Array<{ name?: string }> };
  const models = await Promise.all(
    (data.models ?? [])
      .flatMap((model) => (model.name ? [model.name] : []))
      .map(async (model) => {
        const info = await fetch(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!info.ok) return null;
        const details = (await info.json()) as {
          capabilities?: string[];
          model_info?: Record<string, unknown>;
        };
        if (!details.capabilities?.includes("embedding")) return null;
        const contextWindow = Object.entries(details.model_info ?? {}).find(
          ([key, value]) => key.endsWith(".context_length") && typeof value === "number",
        )?.[1];
        const reportedDimensions = Object.entries(details.model_info ?? {}).find(
          ([key, value]) => key.endsWith(".embedding_length") && typeof value === "number",
        )?.[1];
        const dimensions =
          typeof reportedDimensions === "number"
            ? reportedDimensions
            : model.startsWith("qwen3-embedding:8b")
              ? EMBEDDING_DIMENSIONS
              : undefined;
        if (dimensions !== EMBEDDING_DIMENSIONS) return null;
        return {
          id: model,
          name: model,
          dimensions,
          contextWindow: typeof contextWindow === "number" ? contextWindow : undefined,
        } satisfies EmbeddingModel;
      }),
  );
  return models.filter((model): model is NonNullable<typeof model> => model !== null);
}

export async function embedWithAiBox(
  inputs: string[],
  options: { model: string; dimensions: number; signal?: AbortSignal },
) {
  if (process.env.VITEST) {
    throw new Error(
      "Live embedding inference is disabled in automated tests. Tests must inject a deterministic embedder.",
    );
  }
  const baseUrl = aiboxBaseUrl();
  if (!baseUrl) throw new Error("Für lokale Embeddings ist keine AI-Box-URL gesetzt.");
  const timeout = AbortSignal.timeout(3 * 60_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      input: inputs,
      truncate: true,
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Ollama-Embedding fehlgeschlagen (${response.status}).`);
  }
  const data = (await response.json()) as { embeddings?: number[][] };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
    throw new Error("Ollama lieferte nicht für jeden Text ein Embedding.");
  }
  for (const vector of data.embeddings) {
    if (vector.length !== options.dimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error(
        `Embedding-Dimension stimmt nicht: erwartet ${options.dimensions}, erhalten ${vector.length}.`,
      );
    }
  }
  return data.embeddings;
}

function passageBoundary(content: string, start: number, targetEnd: number) {
  if (targetEnd >= content.length) return content.length;
  const searchStart = Math.min(targetEnd, start + PASSAGE_MIN_CHARS);
  const candidate = content.slice(searchStart, targetEnd);
  const newline = candidate.lastIndexOf("\n");
  if (newline >= 0) return searchStart + newline + 1;
  const sentence = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "));
  if (sentence >= 0) return searchStart + sentence + 2;
  return targetEnd;
}

export function splitRetrievalPassages(
  documentId: string,
  chunk: RetrievalChunk,
): RetrievalPassage[] {
  const passages: RetrievalPassage[] = [];
  let cursor = 0;
  while (cursor < chunk.content.length) {
    const targetEnd = Math.min(chunk.content.length, cursor + PASSAGE_TARGET_CHARS);
    const boundary = passageBoundary(chunk.content, cursor, targetEnd);
    let startOffset = cursor;
    let endOffset = Math.max(cursor + 1, boundary);
    while (startOffset < endOffset && /\s/.test(chunk.content[startOffset] ?? "")) startOffset += 1;
    while (endOffset > startOffset && /\s/.test(chunk.content[endOffset - 1] ?? "")) endOffset -= 1;
    if (endOffset > startOffset) {
      const content = chunk.content.slice(startOffset, endOffset);
      const position = passages.length;
      passages.push({
        id: sha256(
          `${documentId}:${chunk.id}:${chunk.sha256}:${position}:${startOffset}:${endOffset}`,
        ).slice(0, 32),
        documentId,
        chunkId: chunk.id,
        position,
        startOffset,
        endOffset,
        content,
        sha256: sha256(content),
      });
    }
    cursor = Math.max(cursor + 1, boundary);
  }
  return passages;
}

function ensurePassages(documentId: string, chunks: RetrievalChunk[]) {
  const expected = chunks.flatMap((chunk) => splitRetrievalPassages(documentId, chunk));
  const existing = sqlite
    .prepare(
      `SELECT id, document_id, chunk_id, position, start_offset, end_offset, content, sha256
       FROM document_retrieval_passages WHERE document_id = ?
       ORDER BY chunk_id, position`,
    )
    .all(documentId) as Array<{
    id: string;
    document_id: string;
    chunk_id: string;
    position: number;
    start_offset: number;
    end_offset: number;
    content: string;
    sha256: string;
  }>;
  const valid =
    existing.length === expected.length &&
    expected.every((passage) =>
      existing.some(
        (row) =>
          row.id === passage.id &&
          row.sha256 === passage.sha256 &&
          row.start_offset === passage.startOffset &&
          row.end_offset === passage.endOffset,
      ),
    );
  if (valid) return expected;

  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM embedding_cache_entries WHERE document_id = ?").run(documentId);
    sqlite.prepare("DELETE FROM document_retrieval_passages WHERE document_id = ?").run(documentId);
    const insert = sqlite.prepare(
      `INSERT INTO document_retrieval_passages(
        id, document_id, chunk_id, position, start_offset, end_offset, content, sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const passage of expected) {
      insert.run(
        passage.id,
        passage.documentId,
        passage.chunkId,
        passage.position,
        passage.startOffset,
        passage.endOffset,
        passage.content,
        passage.sha256,
      );
    }
  })();
  return expected;
}

function sourceKey(source: Pick<EmbeddingSource, "kind" | "sourceId">) {
  return `${source.kind}:${source.sourceId}`;
}

async function ensureEmbeddings(
  sources: EmbeddingSource[],
  config: EmbeddingConfig,
  embed: EmbedFunction,
  signal?: AbortSignal,
) {
  const vectorIds = new Map<string, string>();
  const missing: Array<{ source: EmbeddingSource; vectorId: string }> = [];
  const cached = sqlite.prepare(
    `SELECT 1 AS found FROM embedding_cache_entries AS cache
     JOIN embedding_vectors AS vectors ON vectors.id = cache.id
     WHERE cache.id = ? AND cache.source_sha256 = ? AND cache.model = ?
       AND cache.dimensions = ?`,
  );
  for (const source of sources) {
    const vectorId = sha256(
      `${RETRIEVAL_SCHEMA_VERSION}:${config.model}:${config.dimensions}:${source.kind}:${source.sourceId}:${source.sourceHash}`,
    );
    vectorIds.set(sourceKey(source), vectorId);
    if (!cached.get(vectorId, source.sourceHash, config.model, config.dimensions)) {
      missing.push({ source, vectorId });
    }
  }

  for (let index = 0; index < missing.length; index += EMBEDDING_BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = missing.slice(index, index + EMBEDDING_BATCH_SIZE);
    const vectors = await embed(
      batch.map((entry) => entry.source.text),
      { model: config.model, dimensions: config.dimensions, signal },
    );
    sqlite.transaction(() => {
      const insertVector = sqlite.prepare(
        `INSERT INTO embedding_vectors(
          id, embedding, document_id, source_kind, chunk_id, model, source_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertCache = sqlite.prepare(
        `INSERT INTO embedding_cache_entries(
          id, source_kind, document_id, source_id, source_sha256, model, dimensions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [batchIndex, entry] of batch.entries()) {
        const vector = vectors[batchIndex];
        if (!vector) throw new Error("Ein erwartetes Embedding fehlt.");
        sqlite.prepare("DELETE FROM embedding_vectors WHERE id = ?").run(entry.vectorId);
        sqlite.prepare("DELETE FROM embedding_cache_entries WHERE id = ?").run(entry.vectorId);
        insertVector.run(
          entry.vectorId,
          new Float32Array(vector),
          entry.source.documentId ?? "__raci__",
          entry.source.kind,
          entry.source.chunkId,
          config.model,
          entry.source.sourceId,
        );
        insertCache.run(
          entry.vectorId,
          entry.source.kind,
          entry.source.documentId,
          entry.source.sourceId,
          entry.source.sourceHash,
          config.model,
          config.dimensions,
          new Date().toISOString(),
        );
      }
    })();
  }
  return vectorIds;
}

function tokenize(value: string) {
  return new Set(
    [...value.toLocaleLowerCase("de-DE").matchAll(/[\p{L}\p{N}][\p{L}\p{N}._/-]{2,}/gu)]
      .map(([token]) => token.replace(/^[._/-]+|[._/-]+$/g, ""))
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function lexicalActivityScore(chunkTokens: Set<string>, row: RaciCatalogRow) {
  const activityTokens = tokenize(`${row.activity} ${row.trigger} ${row.artifact}`);
  if (!activityTokens.size) return 0;
  let matches = 0;
  for (const token of activityTokens) if (chunkTokens.has(token)) matches += 1;
  return matches / Math.sqrt(activityTokens.size * Math.max(1, chunkTokens.size));
}

function rolesFor(row: RaciCatalogRow) {
  const coreRoles = QA_ROLES.filter((role) =>
    ["A", "R", "A/R"].includes(row.responsibilities[role] ?? ""),
  );
  const consultantRoles = QA_ROLES.filter((role) => row.responsibilities[role] === "C");
  return { coreRoles, consultantRoles };
}

function clampSimilarity(distance: number) {
  return Math.max(0, Math.min(1, 1 - distance));
}

function vectorMatches(options: {
  queryId: string;
  model: string;
  documentId: string;
  sourceKind: EmbeddingSource["kind"];
  chunkId?: string;
  limit: number;
}) {
  const chunkClause = options.chunkId === undefined ? "" : " AND chunk_id = @chunkId";
  return sqlite
    .prepare(
      `SELECT source_id, distance FROM embedding_vectors
       WHERE embedding MATCH (
         SELECT embedding FROM embedding_vectors WHERE id = @queryId
       )
         AND k = @limit
         AND document_id = @documentId
         AND source_kind = @sourceKind
         AND model = @model
         ${chunkClause}`,
    )
    .all({
      queryId: options.queryId,
      limit: options.limit,
      documentId: options.documentId,
      sourceKind: options.sourceKind,
      model: options.model,
      ...(options.chunkId === undefined ? {} : { chunkId: options.chunkId }),
    }) as VectorMatch[];
}

function lexicalRelations(chunks: RetrievalChunk[]) {
  const tokens = new Map(chunks.map((chunk) => [chunk.id, tokenize(chunk.content)]));
  const frequencies = new Map<string, number>();
  for (const chunkTokens of tokens.values()) {
    for (const token of chunkTokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  const result = new Map<string, Array<{ chunkId: string; score: number; terms: string[] }>>();
  for (const source of chunks) {
    const sourceTokens = tokens.get(source.id) ?? new Set();
    const relations: Array<{ chunkId: string; score: number; terms: string[] }> = [];
    for (const target of chunks) {
      if (source.id === target.id) continue;
      const targetTokens = tokens.get(target.id) ?? new Set();
      const shared = [...sourceTokens]
        .filter((token) => targetTokens.has(token))
        .map((token) => ({
          token,
          weight: Math.log((chunks.length + 1) / ((frequencies.get(token) ?? 0) + 1)) + 0.2,
        }))
        .sort((left, right) => right.weight - left.weight);
      const score = shared.slice(0, 20).reduce((sum, item) => sum + item.weight, 0);
      if (score > 0) {
        relations.push({
          chunkId: target.id,
          score,
          terms: shared.slice(0, 5).map((item) => item.token),
        });
      }
    }
    const maximum = Math.max(1, ...relations.map((relation) => relation.score));
    result.set(
      source.id,
      relations.map((relation) => ({ ...relation, score: relation.score / maximum })),
    );
  }
  return result;
}

function bestLexicalPassage(
  passages: RetrievalPassage[],
  activity: RaciCatalogRow,
): RetrievalPassage | undefined {
  const activityTokens = tokenize(`${activity.activity} ${activity.trigger} ${activity.artifact}`);
  return [...passages].sort((left, right) => {
    const score = (passage: RetrievalPassage) => {
      const passageTokens = tokenize(passage.content);
      return [...activityTokens].filter((token) => passageTokens.has(token)).length;
    };
    return score(right) - score(left);
  })[0];
}

function excerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_EXCERPT_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}

function renderCard(hint: ChunkRetrievalHint, chunks: RetrievalChunk[]) {
  const current = chunks.find((chunk) => chunk.id === hint.chunkId);
  const title = `Belegkarte ${hint.position + 1}/${chunks.length}`;
  const activities = hint.activities
    .map(
      (activity) =>
        `- **${activity.activityId} · ${activity.activity}** — Navigationsscore ${activity.score.toFixed(
          3,
        )}; Kernrollen: ${activity.coreRoles.join(", ")}${
          activity.consultantRoles.length
            ? `; mögliche C-Rollen: ${activity.consultantRoles.join(", ")}`
            : ""
        }`,
    )
    .join("\n");
  const neighbors = hint.neighbors
    .map(
      (neighbor) =>
        `- ${neighbor.locator} — ${neighbor.reasons.join("; ")} (${neighbor.score.toFixed(3)})`,
    )
    .join("\n");
  const excerpts = hint.excerpts.map((item) => `> ${item}`).join("\n>\n");
  return {
    title,
    content: `# ${title}

- **Originalquelle:** ${hint.locator}
- **Chunk-Hash:** \`${hint.sha256}\`
- **Originalzeichen:** ${current?.content.length ?? 0}

## Repräsentative Originalauszüge

${excerpts || "> Kein kurzer Auszug konnte deterministisch ausgewählt werden."}

## Unverbindliche RACI-Navigationshinweise

${activities || "- Keine belastbare Aktivitätsähnlichkeit ermittelt."}

## Dokumentweite Verbindungen

${neighbors || "- Keine zusätzlichen Beziehungen ermittelt."}

${hint.exactTerms.length ? `**Geteilte exakte Begriffe:** ${hint.exactTerms.join(", ")}` : ""}

## Verwendungsregel

Diese Karte ist ausschließlich ein Such- und Navigationsindex. Sie ist kein Fachreview und keine Quelle. Fachliche Befunde müssen durch einen spezialisierten Rollen-Agenten am vollständigen Originalchunk geprüft und mit dessen Locator belegt werden.`,
  };
}

function relationshipManifest(hints: ChunkRetrievalHint[]) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const hint of hints) {
    for (const neighbor of hint.neighbors) {
      const pair = [hint.chunkId, neighbor.chunkId].sort().join(":");
      if (seen.has(pair)) continue;
      seen.add(pair);
      lines.push(
        `- ${hint.locator} ↔ ${neighbor.locator} — ${neighbor.reasons.join("; ")} (${neighbor.score.toFixed(3)})`,
      );
    }
  }
  return `## Chunk-übergreifendes Beziehungsmanifest

${lines.join("\n") || "- Keine zusätzlichen Beziehungen ermittelt."}`;
}

export async function buildRetrievalDossier(options: {
  documentId: string;
  chunks: RetrievalChunk[];
  signal?: AbortSignal;
  embed?: EmbedFunction;
}): Promise<RetrievalDossier> {
  const config = embeddingConfig();
  const passages = ensurePassages(options.documentId, options.chunks);
  const catalog = [...raciCatalog().values()];
  const lexical = lexicalRelations(options.chunks);
  const chunkTokens = new Map(
    options.chunks.map((chunk) => [chunk.id, tokenize(chunk.content)] as const),
  );
  let vectorIds = new Map<string, string>();
  let embeddingStatus: RetrievalDossier["embedding"] = {
    status: config.enabled ? "unavailable" : "disabled",
    model: config.model,
    dimensions: config.dimensions,
  };

  if (config.enabled) {
    try {
      const sources: EmbeddingSource[] = [
        ...options.chunks.map(
          (chunk): EmbeddingSource => ({
            kind: "chunk",
            sourceId: chunk.id,
            documentId: options.documentId,
            chunkId: chunk.id,
            sourceHash: chunk.sha256,
            text: chunk.content,
          }),
        ),
        ...passages.map(
          (passage): EmbeddingSource => ({
            kind: "passage",
            sourceId: passage.id,
            documentId: options.documentId,
            chunkId: passage.chunkId,
            sourceHash: passage.sha256,
            text: passage.content,
          }),
        ),
        ...catalog.map((row): EmbeddingSource => {
          const text = `QA RACI activity ${row.id}: ${row.activity}
Handoff trigger: ${row.trigger}
Expected artifact: ${row.artifact}
Responsibilities: ${QA_ROLES.map((role) => `${role}=${row.responsibilities[role]}`).join(", ")}`;
          return {
            kind: "raci",
            sourceId: row.id,
            documentId: null,
            chunkId: "",
            sourceHash: sha256(text),
            text,
          };
        }),
      ];
      vectorIds = await ensureEmbeddings(
        sources,
        config,
        options.embed ?? embedWithAiBox,
        options.signal,
      );
      embeddingStatus = {
        status: "ready",
        model: config.model,
        dimensions: config.dimensions,
      };
    } catch (error) {
      options.signal?.throwIfAborted();
      embeddingStatus = {
        status: "unavailable",
        model: config.model,
        dimensions: config.dimensions,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const chunkById = new Map(options.chunks.map((chunk) => [chunk.id, chunk]));
  const passagesByChunk = new Map<string, RetrievalPassage[]>();
  for (const passage of passages) {
    const items = passagesByChunk.get(passage.chunkId) ?? [];
    items.push(passage);
    passagesByChunk.set(passage.chunkId, items);
  }

  const hints = options.chunks.map((chunk): ChunkRetrievalHint => {
    const activityScores = new Map<string, number>();
    for (const row of catalog) {
      activityScores.set(row.id, lexicalActivityScore(chunkTokens.get(chunk.id) ?? new Set(), row));
    }
    const chunkVectorId = vectorIds.get(sourceKey({ kind: "chunk", sourceId: chunk.id }));
    if (chunkVectorId) {
      for (const match of vectorMatches({
        queryId: chunkVectorId,
        model: config.model,
        documentId: "__raci__",
        sourceKind: "raci",
        limit: 8,
      })) {
        const semantic = clampSimilarity(match.distance);
        const lexicalScore = activityScores.get(match.source_id) ?? 0;
        activityScores.set(match.source_id, semantic * 0.82 + lexicalScore * 0.18);
      }
    }
    const activities = [...activityScores.entries()]
      .map(([activityId, score]) => {
        const row = raciCatalog().get(activityId);
        if (!row) return null;
        return {
          activityId,
          activity: row.activity,
          score,
          ...rolesFor(row),
        } satisfies RaciHint;
      })
      .filter((hint): hint is RaciHint => Boolean(hint))
      .sort(
        (left, right) =>
          right.score - left.score || left.activityId.localeCompare(right.activityId),
      )
      .slice(0, RACI_HINTS_PER_CHUNK);

    const neighborScores = new Map<
      string,
      { score: number; reasons: string[]; exactTerms: string[] }
    >();
    for (const relation of lexical.get(chunk.id) ?? []) {
      neighborScores.set(relation.chunkId, {
        score: relation.score * 0.35,
        reasons: relation.terms.length
          ? [`exakte Begriffe: ${relation.terms.join(", ")}`]
          : ["lexikalisch verwandt"],
        exactTerms: relation.terms,
      });
    }
    if (chunkVectorId) {
      for (const match of vectorMatches({
        queryId: chunkVectorId,
        model: config.model,
        documentId: options.documentId,
        sourceKind: "chunk",
        limit: Math.min(options.chunks.length, 8),
      })) {
        if (match.source_id === chunk.id) continue;
        const existing = neighborScores.get(match.source_id) ?? {
          score: 0,
          reasons: [],
          exactTerms: [],
        };
        existing.score += clampSimilarity(match.distance) * 0.65;
        existing.reasons.push("semantisch verwandt");
        neighborScores.set(match.source_id, existing);
      }
    }
    for (const adjacent of options.chunks.filter(
      (candidate) => Math.abs(candidate.position - chunk.position) === 1,
    )) {
      const existing = neighborScores.get(adjacent.id) ?? {
        score: 0,
        reasons: [],
        exactTerms: [],
      };
      existing.score = Math.max(existing.score, 0.2);
      existing.reasons.push("strukturell benachbart");
      neighborScores.set(adjacent.id, existing);
    }
    const neighbors = [...neighborScores.entries()]
      .flatMap(([chunkId, relation]) => {
        const target = chunkById.get(chunkId);
        return target
          ? [
              {
                chunkId,
                locator: target.locator,
                score: Math.min(1, relation.score),
                reasons: [...new Set(relation.reasons)],
              } satisfies ChunkNeighbor,
            ]
          : [];
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          (chunkById.get(left.chunkId)?.position ?? 0) -
            (chunkById.get(right.chunkId)?.position ?? 0),
      )
      .slice(0, NEIGHBORS_PER_CHUNK);

    const selectedPassages: RetrievalPassage[] = [];
    for (const activity of activities.slice(0, 2)) {
      const row = raciCatalog().get(activity.activityId);
      if (!row) continue;
      const raciVectorId = vectorIds.get(
        sourceKey({ kind: "raci", sourceId: activity.activityId }),
      );
      let passage: RetrievalPassage | undefined;
      if (raciVectorId) {
        const [match] = vectorMatches({
          queryId: raciVectorId,
          model: config.model,
          documentId: options.documentId,
          sourceKind: "passage",
          chunkId: chunk.id,
          limit: 1,
        });
        passage = passages.find((candidate) => candidate.id === match?.source_id);
      }
      passage ??= bestLexicalPassage(passagesByChunk.get(chunk.id) ?? [], row);
      if (passage && !selectedPassages.some((candidate) => candidate.id === passage?.id)) {
        selectedPassages.push(passage);
      }
    }
    if (!selectedPassages.length && passagesByChunk.get(chunk.id)?.[0]) {
      selectedPassages.push(passagesByChunk.get(chunk.id)?.[0] as RetrievalPassage);
    }
    const exactTerms = [
      ...new Set(
        neighbors.flatMap(
          (neighbor) =>
            neighborScores.get(neighbor.chunkId)?.exactTerms.filter((term) => term.length > 2) ??
            [],
        ),
      ),
    ].slice(0, 8);

    return {
      chunkId: chunk.id,
      position: chunk.position,
      locator: chunk.locator,
      sha256: chunk.sha256,
      activities,
      neighbors,
      excerpts: selectedPassages.map((passage) => excerpt(passage.content)),
      exactTerms,
    };
  });

  const cards = hints.map((hint) => ({ ...renderCard(hint, options.chunks), hint }));
  const relations = relationshipManifest(hints);
  const markdown = `# Dokumentweite, quelltreue Voranalyse

**Regel:** Alle folgenden RACI-Zuordnungen und Beziehungen sind unverbindliche Navigationshinweise. Sie ersetzen weder das Original noch ein Rollenreview. Jeder fachliche Befund muss am Originalchunk geprüft werden.

**Retrieval:** ${
    embeddingStatus.status === "ready"
      ? `hybrid · lokale Embeddings ${embeddingStatus.model} · exakte Begriffe · strukturelle Nachbarschaft`
      : `lexikalischer Rückfall · ${embeddingStatus.status}`
  }

${relations}

${cards.map((card) => card.content).join("\n\n---\n\n")}`;

  return {
    version: RETRIEVAL_SCHEMA_VERSION,
    documentId: options.documentId,
    embedding: embeddingStatus,
    chunks: hints,
    cards,
    markdown,
    relationshipManifest: relations,
  };
}

export function roleChunkNavigation(
  dossier: RetrievalDossier | undefined,
  chunk: RetrievalChunk,
  activityIds: ReadonlySet<string>,
) {
  const hint = dossier?.chunks.find((candidate) => candidate.chunkId === chunk.id);
  if (!hint) return "";
  const matching = hint.activities.filter((activity) => activityIds.has(activity.activityId));
  const other = hint.activities.filter((activity) => !activityIds.has(activity.activityId));
  return `UNVERBINDLICHE NAVIGATIONSHINWEISE — niemals als Quelle oder Befund übernehmen:
- Passende zugewiesene Aktivitäten: ${
    matching.map((activity) => `${activity.activityId} ${activity.activity}`).join("; ") || "keine"
  }
- Weitere vorgeschlagene Aktivitäten: ${
    other.map((activity) => `${activity.activityId} ${activity.activity}`).join("; ") || "keine"
  }
- Dokumentweit verwandte Originalchunks: ${
    hint.neighbors.map((neighbor) => neighbor.locator).join("; ") || "keine"
  }
- Geteilte exakte Begriffe: ${hint.exactTerms.join(", ") || "keine"}

Arbeite ausschließlich am nachfolgenden Originalchunk. Wenn die Hinweise falsch sind, korrigiere sie anhand des Originals.`;
}
