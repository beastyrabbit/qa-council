import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Api, AssistantMessage, ImageContent, Model } from "@earendil-works/pi-ai/compat";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import type { OpenRouterRoutingMode, ProviderId, ProviderModel } from "../shared/types.js";
import { decryptSecret } from "./crypto.js";
import { sqlite } from "./db/index.js";
import { createWorkspaceReadEditTools, safeWorkspaceEventPath } from "./workspace-tools.js";

function hasStoredAuth(file: string) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
  } catch {
    return false;
  }
}

const authStores = new Map<string, AuthStorage>();

function authStoragePath() {
  const dataDir = process.env.DATA_DIR ?? path.resolve("data");
  const persistentAuthPath = path.join(dataDir, "pi", "auth.json");
  const userAuthPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
  return !process.env.DATA_DIR && !hasStoredAuth(persistentAuthPath) && hasStoredAuth(userAuthPath)
    ? userAuthPath
    : persistentAuthPath;
}

export function getAuthStorage() {
  const authPath = authStoragePath();
  let storage = authStores.get(authPath);
  if (!storage) {
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    storage = AuthStorage.create(authPath);
    authStores.set(authPath, storage);
  }
  return storage;
}

interface ProviderRow {
  provider: ProviderId;
  model: string;
  base_url: string | null;
  encrypted_api_key: string | null;
}

interface OllamaModelInfo {
  capabilities?: string[];
  contextWindow: number;
  maximumContextWindow: number;
}

interface OpenRouterCatalogModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

let openRouterCatalogCache:
  | { expiresAt: number; models: Map<string, OpenRouterCatalogModel> }
  | undefined;

function pricePerMillion(value: string | undefined) {
  const perToken = Number(value);
  return Number.isFinite(perToken) ? perToken * 1_000_000 : undefined;
}

async function openRouterCatalog() {
  if (openRouterCatalogCache && openRouterCatalogCache.expiresAt > Date.now()) {
    return openRouterCatalogCache.models;
  }
  const row = providerRow("openrouter");
  const apiKey = decryptSecret(row.encrypted_api_key) ?? process.env.OPENROUTER_API_KEY;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`OpenRouter-Modellkatalog fehlgeschlagen (${response.status}).`);
  const data = (await response.json()) as { data?: OpenRouterCatalogModel[] };
  const models = new Map((data.data ?? []).map((model) => [model.id, model]));
  openRouterCatalogCache = { expiresAt: Date.now() + 5 * 60_000, models };
  return models;
}

function openRouterRoutingMode(): OpenRouterRoutingMode {
  const row = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = 'openRouterRouting'")
    .get() as { value: string } | undefined;
  return row?.value === "lowest" || row?.value === "fastest" ? row.value : "balanced";
}

function withOpenRouterRouting(model: Model<Api>) {
  if (model.provider !== "openrouter" || model.api !== "openai-completions") return model;
  const mode = openRouterRoutingMode();
  return {
    ...model,
    compat: {
      ...model.compat,
      ...(mode === "balanced"
        ? { openRouterRouting: undefined }
        : { openRouterRouting: { sort: mode === "lowest" ? "price" : "throughput" } }),
    },
  } as Model<Api>;
}

async function aiboxModelInfo(baseUrl: string, model: string): Promise<OllamaModelInfo> {
  const response = await fetch(`${baseUrl}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Ollama-Modellinfo fehlgeschlagen (${response.status}).`);
  const data = (await response.json()) as {
    capabilities?: string[];
    model_info?: Record<string, unknown>;
    parameters?: string;
  };
  const maximumContextWindow = Object.entries(data.model_info ?? {}).find(([key, value]) => {
    return key.endsWith(".context_length") && typeof value === "number";
  })?.[1];
  const configuredContextWindow = data.parameters?.match(/(?:^|\n)num_ctx\s+(\d+)/)?.[1]?.trim();
  const contextWindow = typeof maximumContextWindow === "number" ? maximumContextWindow : 32_768;
  return {
    capabilities: data.capabilities,
    maximumContextWindow: contextWindow,
    contextWindow: configuredContextWindow
      ? Math.min(contextWindow, Number(configuredContextWindow))
      : contextWindow,
  };
}

async function aiboxRunningContexts(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return new Map<string, number>();
    const data = (await response.json()) as {
      models?: Array<{ name?: string; context_length?: number }>;
    };
    return new Map(
      (data.models ?? [])
        .filter(
          (model): model is { name: string; context_length: number } =>
            typeof model.name === "string" && typeof model.context_length === "number",
        )
        .map((model) => [model.name, model.context_length]),
    );
  } catch {
    return new Map<string, number>();
  }
}

export function providerRow(provider: ProviderId): ProviderRow {
  const row = sqlite
    .prepare(
      "SELECT provider, model, base_url, encrypted_api_key FROM provider_settings WHERE provider = ?",
    )
    .get(provider) as ProviderRow | undefined;
  if (!row) throw new Error(`Anbieter ${provider} ist nicht konfiguriert.`);
  return row;
}

function providerRegistry(): ModelRegistry {
  const authStorage = getAuthStorage();
  authStorage.reload();
  const registry = ModelRegistry.inMemory(authStorage);
  const openRouter = providerRow("openrouter");
  const openRouterKey =
    decryptSecret(openRouter.encrypted_api_key) ?? process.env.OPENROUTER_API_KEY;
  if (openRouterKey) authStorage.setRuntimeApiKey("openrouter", openRouterKey);

  return registry;
}

export async function listModels(provider: ProviderId): Promise<ProviderModel[]> {
  if (provider === "aibox") {
    const row = providerRow("aibox");
    const baseUrl = row.base_url?.trim().replace(/\/$/, "");
    if (!baseUrl) return [];
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const runningContexts = await aiboxRunningContexts(baseUrl);
      const models = await Promise.all(
        (data.models ?? []).map(async (model) => {
          const info = await aiboxModelInfo(baseUrl, model.name);
          if (!info.capabilities?.includes("completion") || !info.capabilities.includes("tools"))
            return null;
          return {
            id: model.name,
            name: model.name,
            provider: "aibox" as const,
            contextWindow: Math.min(
              info.contextWindow,
              runningContexts.get(model.name) ?? info.contextWindow,
            ),
            maximumContextWindow: info.maximumContextWindow,
            supportsReasoning: info.capabilities?.includes("thinking") ?? false,
            supportsVision: info.capabilities?.includes("vision") ?? false,
            supportsTools: true,
          };
        }),
      );
      return models.filter((model): model is NonNullable<typeof model> => model !== null);
    } catch {
      return [
        {
          id: row.model,
          name: `${row.model} (nicht erreichbar)`,
          provider: "aibox",
          available: false,
        },
      ];
    }
  }

  const registry = providerRegistry();
  const registryProvider = provider === "codex" ? "openai-codex" : "openrouter";
  const catalog =
    provider === "openrouter" ? await openRouterCatalog().catch(() => new Map()) : new Map();
  return registry
    .getAll()
    .filter((model) => model.provider === registryProvider)
    .map((model) => {
      const live = catalog.get(model.id);
      return {
        id: model.id,
        name: model.name,
        provider,
        contextWindow: live?.context_length ?? model.contextWindow,
        inputPricePerMillion: pricePerMillion(live?.pricing?.prompt) ?? model.cost.input,
        outputPricePerMillion: pricePerMillion(live?.pricing?.completion) ?? model.cost.output,
        supportsReasoning:
          live?.supported_parameters?.includes("reasoning") ??
          live?.supported_parameters?.includes("reasoning_effort") ??
          model.reasoning,
        supportsVision:
          live?.architecture?.input_modalities?.includes("image") ?? model.input.includes("image"),
        supportsTools:
          provider === "codex" ? true : live?.supported_parameters?.includes("tools") === true,
      };
    })
    .filter((model) => model.supportsTools);
}

export async function modelSupportsVision(provider: ProviderId, modelId: string) {
  if (provider === "aibox") return false;
  const model = (await listModels(provider)).find((candidate) => candidate.id === modelId);
  return model?.supportsVision === true;
}

const TOOL_PROBE_SCHEMA_VERSION = 1;
const TOOL_PROBE_TTL_MS = 24 * 60 * 60 * 1000;

async function metadataSupportsTools(provider: ProviderId, modelId: string) {
  if (provider === "aibox") {
    const row = providerRow("aibox");
    const baseUrl = row.base_url?.replace(/\/$/, "");
    if (!baseUrl) return false;
    return (await aiboxModelInfo(baseUrl, modelId)).capabilities?.includes("tools") === true;
  }
  if (provider === "openrouter") {
    return (
      (await openRouterCatalog()).get(modelId)?.supported_parameters?.includes("tools") === true
    );
  }
  return (await listModels("codex")).some(
    (model) => model.id === modelId && model.supportsTools === true,
  );
}

export async function probeCouncilToolCapability(
  provider: ProviderId,
  modelId: string,
  signal?: AbortSignal,
) {
  const row = providerRow(provider);
  const endpoint =
    provider === "codex"
      ? "openai-codex"
      : provider === "openrouter"
        ? row.base_url || "https://openrouter.ai/api/v1"
        : row.base_url || "";
  if (!endpoint) {
    throw new Error("Für die AI Box ist keine URL gesetzt.");
  }
  const cached = sqlite
    .prepare(
      `SELECT supported, error, checked_at FROM tool_capability_probes
       WHERE provider = ? AND model = ? AND endpoint = ? AND schema_version = ?`,
    )
    .get(provider, modelId, endpoint, TOOL_PROBE_SCHEMA_VERSION) as
    | { supported: number; error: string | null; checked_at: string }
    | undefined;
  if (cached && Date.now() - Date.parse(cached.checked_at) < TOOL_PROBE_TTL_MS) {
    if (cached.supported) return true;
    throw new Error(cached.error || "Das Modell hat den Council-Tool-Probe nicht bestanden.");
  }

  let supported = false;
  let error: string | undefined;
  try {
    if (!(await metadataSupportsTools(provider, modelId))) {
      throw new Error("Die Modellmetadaten weisen keinen Tool-Call-Support aus.");
    }
    const probe = await runPiStage({
      provider,
      modelId,
      systemPrompt: "Du prüfst ausschließlich einen Tool-Aufruf.",
      prompt: "Rufe jetzt genau einmal submit_capability_probe mit ok=true auf.",
      signal,
      toolMode: "output-tools",
      outputTools: [
        {
          name: "submit_capability_probe",
          description: "Bestätigt die Unterstützung strukturierter Council-Tools.",
          parameters: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
        },
      ],
    });
    supported =
      probe.toolCalls.length === 1 &&
      probe.toolCalls[0]?.name === "submit_capability_probe" &&
      (probe.toolCalls[0].args as { ok?: unknown })?.ok === true;
    if (!supported) error = "Das Modell hat den erforderlichen Probe-Tool-Aufruf nicht geliefert.";
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  sqlite
    .prepare(
      `INSERT INTO tool_capability_probes(
        provider, model, endpoint, schema_version, supported, error, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, model, endpoint, schema_version) DO UPDATE SET
        supported = excluded.supported, error = excluded.error, checked_at = excluded.checked_at`,
    )
    .run(
      provider,
      modelId,
      endpoint,
      TOOL_PROBE_SCHEMA_VERSION,
      supported ? 1 : 0,
      error ?? null,
      new Date().toISOString(),
    );
  if (!supported) {
    throw new Error(
      `Modell ${provider}/${modelId} ist nicht Council-fähig: ${error ?? "Tool-Probe fehlgeschlagen."}`,
    );
  }
  return true;
}

export interface PiStageResult {
  content: string;
  usage: { input: number; output: number; cost: number };
  events: Array<{ type: string; message: string; data?: unknown }>;
  toolCalls: Array<{ name: string; callId: string; args: unknown }>;
}

export interface OutputToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
}

export type PiToolMode = "read-edit" | "output-tools";

export function assertPiTurnHasOutput(content: string, toolCalls: PiStageResult["toolCalls"]) {
  if (!content && toolCalls.length === 0) throw new Error("Die Modellantwort war leer.");
}

export class InferenceTimeoutError extends Error {
  override name = "InferenceTimeoutError";
  constructor(readonly timeoutMs: number) {
    super(
      `Die Modellinferenz hat das Zeitlimit von ${Math.round(timeoutMs / 60_000)} Minuten überschritten.`,
    );
  }
}

export interface RunPiStageOptions {
  provider: ProviderId;
  modelId: string;
  systemPrompt: string;
  prompt: string;
  images?: ImageContent[];
  signal?: AbortSignal;
  workspaceDir?: string;
  workspaceEditableFiles?: string[];
  toolMode?: PiToolMode;
  outputTools?: OutputToolDefinition[];
  onEvent?: (event: { type: string; message: string; data?: unknown }) => void;
  onStream?: (channel: "thinking" | "text", delta: string) => void;
}

const TERMINAL_PROVIDER_ERROR =
  /(?:insufficient[_ -]?quota|out of budget|quota exceeded|billing|unauthori[sz]ed|forbidden|invalid api key|authentication|configuration)/i;
const RETRYABLE_PROVIDER_ERROR =
  /(?:\b408\b|\b429\b|\b5\d\d\b|rate.?limit|too many requests|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|fetch failed|upstream.?connect|reset before headers|socket hang up|websocket|timed? out|timeout|terminated|an error occurred while processing your request|you can retry your request)/i;

export function isRetryableProviderError(error: unknown) {
  if (
    error instanceof InferenceTimeoutError ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return false;
  }
  if (
    error &&
    typeof error === "object" &&
    ("status" in error || "statusCode" in error) &&
    Number.isInteger(
      (error as { status?: unknown; statusCode?: unknown }).status ??
        (error as { statusCode?: unknown }).statusCode,
    )
  ) {
    const status = Number(
      (error as { status?: unknown; statusCode?: unknown }).status ??
        (error as { statusCode?: unknown }).statusCode,
    );
    const message = error instanceof Error ? error.message : String(error);
    if (TERMINAL_PROVIDER_ERROR.test(message)) return false;
    return status === 408 || status === 429 || status >= 500;
  }
  const message = error instanceof Error ? error.message : String(error);
  return !TERMINAL_PROVIDER_ERROR.test(message) && RETRYABLE_PROVIDER_ERROR.test(message);
}

const DEFAULT_PROVIDER_RETRY_DELAYS_MS = [2_000, 8_000] as const;

async function waitForProviderRetry(delayMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Vorgang abgebrochen.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function withProviderRetries<T>(
  task: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    retryDelaysMs?: readonly number[];
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  } = {},
) {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_PROVIDER_RETRY_DELAYS_MS;
  for (let retry = 0; ; retry += 1) {
    try {
      return await task();
    } catch (error) {
      options.signal?.throwIfAborted();
      const delayMs = retryDelaysMs[retry];
      if (delayMs === undefined || !isRetryableProviderError(error)) throw error;
      options.onRetry?.(retry + 1, error, delayMs);
      await waitForProviderRetry(delayMs, options.signal);
    }
  }
}

function safeEvent(event: AgentSessionEvent) {
  if (event.type === "message_update") return null;
  if (event.type === "compaction_start" || event.type === "compaction_end") {
    return { type: event.type, message: `Pi: ${event.type}` };
  }
  return null;
}

async function runPiStageAttempt(options: RunPiStageOptions): Promise<PiStageResult> {
  options.signal?.throwIfAborted();
  if (
    (options.toolMode === "read-edit" && !options.workspaceDir) ||
    (options.workspaceDir && options.toolMode !== "read-edit") ||
    (options.toolMode === "output-tools" && !options.outputTools?.length) ||
    (options.outputTools?.length && options.toolMode !== "output-tools")
  ) {
    throw new Error("Werkzeugmodus und Werkzeugdefinitionen passen nicht zusammen.");
  }
  const workspace =
    options.toolMode === "read-edit" && options.workspaceDir
      ? await createWorkspaceReadEditTools(options.workspaceDir, {
          editableFiles: options.workspaceEditableFiles,
        })
      : undefined;
  const capturedToolCalls: PiStageResult["toolCalls"] = [];
  const outputTools = (options.outputTools ?? []).map((definition) =>
    defineTool({
      name: definition.name,
      label: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      async execute(callId, args) {
        capturedToolCalls.push({ name: definition.name, callId, args });
        return {
          content: [{ type: "text", text: `${definition.name} wurde entgegengenommen.` }],
          details: {},
        };
      },
    }),
  ) as ToolDefinition[];
  const customTools = workspace?.tools ?? outputTools;
  const sessionCwd = workspace?.root ?? process.cwd();
  const registry = providerRegistry();
  const providerName = options.provider === "codex" ? "openai-codex" : options.provider;
  let model = registry.find(providerName, options.modelId);

  if (!model && options.provider === "aibox") {
    const row = providerRow("aibox");
    const baseUrl = row.base_url?.trim().replace(/\/$/, "");
    if (!baseUrl) throw new Error("Für die AI Box ist keine URL gesetzt.");
    const info = await aiboxModelInfo(baseUrl, options.modelId);
    options.signal?.throwIfAborted();
    const runningContext = (await aiboxRunningContexts(baseUrl)).get(options.modelId);
    options.signal?.throwIfAborted();
    const effectiveContextWindow = Math.min(
      info.contextWindow,
      runningContext ?? info.contextWindow,
    );
    if (info.capabilities && !info.capabilities.includes("completion")) {
      throw new Error(`Modell ${options.modelId} unterstützt keine Textgenerierung.`);
    }
    registry.registerProvider("aibox", {
      name: "Lokale AI Box",
      baseUrl: `${baseUrl}/v1`,
      apiKey: "ollama-local",
      api: "openai-completions",
      models: [
        {
          id: options.modelId,
          name: options.modelId,
          reasoning: info.capabilities?.includes("thinking") ?? false,
          input: info.capabilities?.includes("vision") ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: effectiveContextWindow,
          maxTokens: Math.min(16_384, Math.max(4_096, Math.floor(effectiveContextWindow / 8))),
          compat: {
            supportsReasoningEffort: true,
            thinkingFormat: "openai",
          },
        },
      ],
    });
    model = registry.find("aibox", options.modelId);
  }
  if (!model) throw new Error(`Modell ${providerName}/${options.modelId} wurde nicht gefunden.`);
  model = withOpenRouterRouting(model);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 8_192, keepRecentTokens: 20_000 },
    // The application owns one retry budget around fresh, stateless sessions.
    retry: { enabled: false, provider: { maxRetries: 0 } },
    hideThinkingBlock: true,
  });
  const agentDir = path.dirname(authStoragePath());
  const resourceLoader = new DefaultResourceLoader({
    cwd: sessionCwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: options.systemPrompt,
  });
  await resourceLoader.reload();
  options.signal?.throwIfAborted();

  const { session } = await createAgentSession({
    cwd: sessionCwd,
    agentDir,
    authStorage: getAuthStorage(),
    modelRegistry: registry,
    model,
    thinkingLevel: model.reasoning ? "high" : "off",
    noTools: customTools.length ? "builtin" : "all",
    tools: workspace
      ? ["read", "edit"]
      : outputTools.length
        ? outputTools.map((tool) => tool.name)
        : undefined,
    customTools: customTools.length ? customTools : undefined,
    sessionManager: SessionManager.inMemory(sessionCwd),
    settingsManager,
    resourceLoader,
  });

  const captured: PiStageResult["events"] = [];
  const workspaceToolCalls = new Map<string, { tool: "read" | "edit"; path: string }>();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === "thinking_delta") {
        options.onStream?.("thinking", assistantEvent.delta);
        return;
      }
      if (assistantEvent.type === "text_delta") {
        options.onStream?.("text", assistantEvent.delta);
        return;
      }
    }
    if (workspace && event.type === "tool_execution_start") {
      if (event.toolName !== "read" && event.toolName !== "edit") return;
      const file = safeWorkspaceEventPath(event.args?.path);
      const metadata = {
        tool: event.toolName as "read" | "edit",
        path: file,
      };
      workspaceToolCalls.set(event.toolCallId, metadata);
      const safe = {
        type: "workspace_tool_start",
        message: `Workspace: ${event.toolName} ${file}`,
        data: metadata,
      };
      captured.push(safe);
      options.onEvent?.(safe);
      return;
    }
    if (options.toolMode === "output-tools" && event.type === "tool_execution_start") {
      const safe = {
        type: "council_tool_call",
        message: `Council-Submit: ${event.toolName}`,
        data: { name: event.toolName, callId: event.toolCallId, args: event.args },
      };
      captured.push(safe);
      options.onEvent?.(safe);
      return;
    }
    if (workspace && event.type === "tool_execution_end") {
      const metadata = workspaceToolCalls.get(event.toolCallId);
      if (!metadata) return;
      workspaceToolCalls.delete(event.toolCallId);
      const safe = {
        type: "workspace_tool_end",
        message: `Workspace: ${metadata.tool} ${metadata.path} ${
          event.isError ? "fehlgeschlagen" : "abgeschlossen"
        }`,
        data: { ...metadata, success: !event.isError },
      };
      captured.push(safe);
      options.onEvent?.(safe);
      return;
    }
    const safe = safeEvent(event);
    if (!safe) return;
    captured.push(safe);
    options.onEvent?.(safe);
  });
  const abortSession = () => {
    void session.abort().catch(() => {});
  };
  if (options.signal?.aborted) abortSession();
  else options.signal?.addEventListener("abort", abortSession, { once: true });

  try {
    options.signal?.throwIfAborted();
    const timeoutMs = Number(process.env.PI_INFERENCE_TIMEOUT_MS ?? 15 * 60_000);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const abortCombined = () => {
      void session.abort().catch(() => {});
    };
    combinedSignal.addEventListener("abort", abortCombined, { once: true });
    let promptError: unknown;
    try {
      try {
        await session.prompt(options.prompt, {
          expandPromptTemplates: false,
          source: "rpc",
          images: options.images,
        });
      } catch (error) {
        promptError = error;
      }
    } finally {
      combinedSignal.removeEventListener("abort", abortCombined);
    }
    if (timeoutSignal.aborted && !options.signal?.aborted) {
      throw new InferenceTimeoutError(timeoutMs);
    }
    options.signal?.throwIfAborted();
    if (promptError) throw promptError;
    const message = [...session.messages].reverse().find((entry) => entry.role === "assistant") as
      | AssistantMessage
      | undefined;
    if (!message) throw new Error("Das Modell hat keine Antwort geliefert.");
    if (message.stopReason === "error") {
      throw new Error(message.errorMessage || "Der Provider hat die Inferenz abgebrochen.");
    }
    const content = message.content
      .filter((item) => item.type === "text")
      .map((item) => (item.type === "text" ? item.text : ""))
      .join("\n")
      .trim();
    assertPiTurnHasOutput(content, capturedToolCalls);
    return {
      content,
      usage: {
        input: message.usage.input,
        output: message.usage.output,
        cost: message.usage.cost.total,
      },
      events: captured,
      toolCalls: capturedToolCalls,
    };
  } finally {
    options.signal?.removeEventListener("abort", abortSession);
    unsubscribe();
    session.dispose();
  }
}

export async function runPiStage(options: RunPiStageOptions): Promise<PiStageResult> {
  if (process.env.VITEST) {
    throw new Error(
      "Live AI inference is disabled in automated tests (Vitest). A specific manual acceptance run requires an explicit user request.",
    );
  }
  return withProviderRetries(() => runPiStageAttempt(options), {
    signal: options.signal,
    onRetry: (attempt, error, delayMs) => {
      const reason = error instanceof Error ? error.message : String(error);
      options.onEvent?.({
        type: "provider_retry",
        message: `Provider-Anfrage wird nach einem vorübergehenden Fehler in ${Math.round(delayMs / 1_000)} Sekunden erneut versucht (${attempt}/2)`,
        data: { attempt, maxRetries: 2, delayMs, reason },
      });
    },
  });
}

export function codexAuthStatus() {
  const authStorage = getAuthStorage();
  authStorage.reload();
  return authStorage.getAuthStatus("openai-codex");
}
