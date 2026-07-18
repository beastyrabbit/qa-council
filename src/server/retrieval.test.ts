import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase, type SqliteDatabase, withDatabase } from "./db/index.js";
import {
  buildRetrievalDossier,
  EMBEDDING_DIMENSIONS,
  embedWithAiBox,
  listAiBoxEmbeddingModels,
  type RetrievalChunk,
  roleDocumentBriefing,
  splitRetrievalPassages,
} from "./retrieval.js";

let database: SqliteDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  vi.unstubAllGlobals();
});

function testDatabase() {
  if (!database) throw new Error("Testdatenbank wurde nicht initialisiert.");
  return database;
}

function normalize(vector: number[]) {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / length);
}

function deterministicEmbedding(text: string) {
  const value = text.toLocaleLowerCase("de-DE");
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const features = [
    ["risiko", 0],
    ["priorität", 0],
    ["report", 1],
    ["automatis", 2],
    ["architektur", 3],
    ["test", 4],
    ["freigabe", 5],
  ] as const;
  for (const [token, index] of features) {
    if (value.includes(token)) vector[index] += 2;
  }
  vector[20] = 0.1;
  return normalize(vector);
}

function seed() {
  database = migrateDatabase(new Database(":memory:"));
  database.exec(`
    INSERT INTO documents(
      id, name, mime_type, size, sha256, original, status, created_at
    ) VALUES ('doc', 'Konzept.md', 'text/markdown', 1, 'doc-hash', X'78', 'ready', 'now');
  `);
  const chunks: RetrievalChunk[] = [
    {
      id: "chunk-1",
      position: 0,
      locator: "Kapitel Risiko · Zeilen 1–20",
      content:
        "Die Produktrisikoanalyse stuft Priorität 1 als hoch ein. Das Freigabegate benötigt einen dokumentierten Owner.",
      sha256: "hash-1",
    },
    {
      id: "chunk-2",
      position: 1,
      locator: "Kapitel Reporting · Zeilen 21–40",
      content:
        "Das Testreporting enthält Fortschritt, Abdeckung und offene Abweichungen. Der Report wird wöchentlich verteilt.",
      sha256: "hash-2",
    },
    {
      id: "chunk-3",
      position: 2,
      locator: "Anhang Risiken · Zeilen 80–100",
      content:
        "Priorität 20 wird ebenfalls als hoch behandelt. Die Produktrisiken benötigen ein gemeinsames Freigabegate.",
      sha256: "hash-3",
    },
  ];
  const insert = database.prepare(
    `INSERT INTO document_chunks(id, document_id, position, locator, content, sha256)
     VALUES (?, 'doc', ?, ?, ?, ?)`,
  );
  for (const chunk of chunks) {
    insert.run(chunk.id, chunk.position, chunk.locator, chunk.content, chunk.sha256);
  }
  return chunks;
}

describe("hybride Dokumentretrieval", () => {
  it("blockiert Live-Embedding-Inferenz in automatisierten Tests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      embedWithAiBox(["kein Live-Aufruf"], {
        model: "qwen3-embedding:8b",
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    ).rejects.toThrow("disabled in automated tests");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("entdeckt reine AI-Box-Embedding-Modelle getrennt von Council-Modellen", async () => {
    seed();
    database
      ?.prepare("UPDATE provider_settings SET base_url = ? WHERE provider = 'aibox'")
      .run("http://aibox.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/tags")) {
          return new Response(
            JSON.stringify({
              models: [
                { name: "qwen3-embedding:8b" },
                { name: "small-embedding" },
                { name: "completion-only" },
              ],
            }),
          );
        }
        const model = JSON.parse(String(init?.body ?? "{}")).model as string | undefined;
        return new Response(
          JSON.stringify({
            capabilities: model === "completion-only" ? ["completion"] : ["embedding"],
            model_info: {
              "qwen3.context_length": 40_960,
              ...(model === "small-embedding" ? { "small.embedding_length": 1_024 } : {}),
            },
          }),
        );
      }),
    );
    const models = await withDatabase(testDatabase(), () => listAiBoxEmbeddingModels());
    expect(models.map((model) => model.id)).toContain("qwen3-embedding:8b");
    expect(models.map((model) => model.id)).not.toContain("small-embedding");
    expect(models[0]).toMatchObject({ dimensions: EMBEDDING_DIMENSIONS });
  });

  it("zerlegt Originalchunks nachvollziehbar in Passagen", () => {
    const chunk: RetrievalChunk = {
      id: "chunk",
      position: 0,
      locator: "Zeilen 1–2",
      content: `${"Risiko und Testabdeckung. ".repeat(90)}\n${"Freigabe und Reporting. ".repeat(90)}`,
      sha256: "hash",
    };
    const passages = splitRetrievalPassages("doc", chunk);
    expect(passages.length).toBeGreaterThan(1);
    expect(
      passages.every(
        (passage) =>
          passage.content === chunk.content.slice(passage.startOffset, passage.endOffset),
      ),
    ).toBe(true);
    expect(new Set(passages.map((passage) => passage.id)).size).toBe(passages.length);
  });

  it("verknüpft entfernte Chunks, erzeugt RACI-Hinweise und cached Embeddings", async () => {
    const chunks = seed();
    const embed = vi.fn(async (inputs: string[]) =>
      inputs.map((input) => deterministicEmbedding(input)),
    );

    const first = await withDatabase(testDatabase(), () =>
      buildRetrievalDossier({ documentId: "doc", chunks, embed }),
    );

    expect(first.embedding.status).toBe("ready");
    expect(first.cards).toHaveLength(3);
    expect(first.cards[0]?.content).toContain("ausschließlich ein Such- und Navigationsindex");
    expect(first.chunks[0]?.neighbors.map((neighbor) => neighbor.chunkId)).toContain("chunk-3");
    expect(first.chunks[0]?.activities.length).toBeGreaterThan(0);
    expect(first.chunks[0]?.excerpts.join(" ")).toContain("Produktrisikoanalyse");
    expect(first.relationshipManifest).toContain("Kapitel Risiko");
    expect(first.relationshipManifest).toContain("Anhang Risiken");

    const callsAfterFirstBuild = embed.mock.calls.length;
    const second = await withDatabase(testDatabase(), () =>
      buildRetrievalDossier({
        documentId: "doc",
        chunks,
        embed: async () => {
          throw new Error("Der Cache hätte eine erneute Inferenz verhindern müssen.");
        },
      }),
    );
    expect(second.embedding.status).toBe("ready");
    expect(embed).toHaveBeenCalledTimes(callsAfterFirstBuild);
    expect(
      testDatabase().prepare("SELECT COUNT(*) AS count FROM embedding_cache_entries").get() as {
        count: number;
      },
    ).toMatchObject({ count: expect.any(Number) });
    expect(
      testDatabase().prepare("SELECT COUNT(*) AS count FROM document_retrieval_fts").get() as {
        count: number;
      },
    ).toEqual({ count: 3 });
  });

  it("baut ein einziges dokumentweites Rollenbriefing in Originalreihenfolge", async () => {
    const chunks = seed();
    const dossier = await withDatabase(testDatabase(), () =>
      buildRetrievalDossier({
        documentId: "doc",
        chunks,
        embed: async (inputs) => inputs.map((input) => deterministicEmbedding(input)),
      }),
    );
    const briefing = roleDocumentBriefing(dossier, "Test-Manager", new Set(["2.1"]));
    expect(briefing).toContain("genau **ein** Review für das vollständige Dokument");
    expect(briefing).toContain("Quelltreue Chunk-Zusammenfassung");
    expect(briefing).toContain("nur Navigation, keine Befunde");
    expect(briefing).toContain("2.1");
    expect(briefing.indexOf(`## Chunk 1/3 · ${chunks[0]?.locator}`)).toBeLessThan(
      briefing.indexOf(`## Chunk 2/3 · ${chunks[1]?.locator}`),
    );
    expect(briefing.indexOf(`## Chunk 2/3 · ${chunks[1]?.locator}`)).toBeLessThan(
      briefing.indexOf(`## Chunk 3/3 · ${chunks[2]?.locator}`),
    );
  });
});
