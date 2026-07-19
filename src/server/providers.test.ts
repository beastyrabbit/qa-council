import { describe, expect, it, vi } from "vitest";
import { createDatabase, withDatabase } from "./db/index.js";
import {
  assertPiTurnHasOutput,
  InferenceTimeoutError,
  isRetryableProviderError,
  listModels,
  probeCouncilToolCapability,
  runPiStage,
  withProviderRetries,
} from "./providers.js";

describe("Pi-Stage-Ausgabe", () => {
  it("akzeptiert einen erfolgreichen tool-only Turn", () => {
    expect(() =>
      assertPiTurnHasOutput("", [
        { name: "submit_council_plan", callId: "call-1", args: { activities: [] } },
      ]),
    ).not.toThrow();
  });

  it("lehnt einen Turn ohne Text und ohne Tool-Aufruf ab", () => {
    expect(() => assertPiTurnHasOutput("", [])).toThrow("Modellantwort war leer");
  });

  it("wiederholt retrybare Providerfehler höchstens zweimal stateless", async () => {
    let calls = 0;
    const retries: number[] = [];

    await expect(
      withProviderRetries(
        async () => {
          calls += 1;
          throw new Error("HTTP 408 Request Timeout");
        },
        { retryDelaysMs: [0, 0], onRetry: (attempt) => retries.push(attempt) },
      ),
    ).rejects.toThrow("HTTP 408");

    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("klassifiziert Netzwerk, 408, 429 und 5xx als retrybar", () => {
    expect(isRetryableProviderError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableProviderError(new Error("WebSocket error"))).toBe(true);
    expect(
      isRetryableProviderError(Object.assign(new Error("Request Timeout"), { status: 408 })),
    ).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error("Rate limit"), { status: 429 }))).toBe(
      true,
    );
    expect(
      isRetryableProviderError(Object.assign(new Error("Service unavailable"), { status: 503 })),
    ).toBe(true);
  });

  it("fängt einen vorübergehenden WebSocket-Fehler in einer frischen Session ab", async () => {
    let calls = 0;
    const retries: number[] = [];

    const result = await withProviderRetries(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("WebSocket error");
        return "ok";
      },
      { retryDelaysMs: [0, 0], onRetry: (attempt) => retries.push(attempt) },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(retries).toEqual([1]);
  });

  it("wiederholt weder Auth-, Abrechnungs- noch Inferenz-Timeouts", async () => {
    expect(isRetryableProviderError(new InferenceTimeoutError(1_000))).toBe(false);
    expect(isRetryableProviderError(new Error("401 Unauthorized"))).toBe(false);
    expect(
      isRetryableProviderError(
        Object.assign(new Error("429 insufficient_quota: billing required"), { status: 429 }),
      ),
    ).toBe(false);

    let calls = 0;
    await expect(
      withProviderRetries(async () => {
        calls += 1;
        throw new Error("401 Unauthorized");
      }),
    ).rejects.toThrow("401");
    expect(calls).toBe(1);
  });

  it("blockiert Live-Inferenz im automatischen Vitest-Lauf", async () => {
    await expect(
      runPiStage({
        provider: "codex",
        modelId: "must-not-run",
        systemPrompt: "must not run",
        prompt: "must not run",
      }),
    ).rejects.toThrow("disabled in automated tests");
  });

  it("behandelt eine leere AI-Box-URL ohne Netzwerkzugriff als nicht gesetzt", async () => {
    const database = createDatabase(":memory:");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      database
        .prepare("UPDATE provider_settings SET base_url = NULL WHERE provider = 'aibox'")
        .run();
      await expect(withDatabase(database, () => listModels("aibox"))).resolves.toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      database.close();
    }
  });

  it("bietet bei der AI Box ausschließlich Modelle mit Tool-Capability an", async () => {
    const database = createDatabase(":memory:");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/tags") {
        return Response.json({ models: [{ name: "tool-model" }, { name: "plain-model" }] });
      }
      if (url.pathname === "/api/ps") return Response.json({ models: [] });
      if (url.pathname === "/api/show") {
        const model = JSON.parse(String(init?.body)) as { model: string };
        return Response.json({
          capabilities: model.model === "tool-model" ? ["completion", "tools"] : ["completion"],
          model_info: { "model.context_length": 32_768 },
        });
      }
      throw new Error(`Unerwarteter Testzugriff: ${url}`);
    });
    try {
      database
        .prepare(
          "UPDATE provider_settings SET base_url = 'http://aibox.test' WHERE provider = 'aibox'",
        )
        .run();
      await expect(withDatabase(database, () => listModels("aibox"))).resolves.toMatchObject([
        { id: "tool-model", supportsTools: true },
      ]);
    } finally {
      fetchSpy.mockRestore();
      database.close();
    }
  });

  it("verwendet einen frischen Tool-Probe-Cache ohne Providerzugriff", async () => {
    const database = createDatabase(":memory:");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      database
        .prepare(
          `INSERT INTO tool_capability_probes(
             provider, model, endpoint, schema_version, supported, checked_at
           ) VALUES ('codex', 'cached-model', 'openai-codex', 1, 1, ?)`,
        )
        .run(new Date().toISOString());
      await expect(
        withDatabase(database, () => probeCouncilToolCapability("codex", "cached-model")),
      ).resolves.toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      database.close();
    }
  });
});
