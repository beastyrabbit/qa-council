import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Api, AssistantMessage, ImageContent, Model } from "@earendil-works/pi-ai/compat";
import {
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { OpenRouterRoutingMode, ProviderId, ProviderModel } from "../shared/types.js";
import { decryptSecret } from "./crypto.js";
import { sqlite } from "./db/index.js";

const dataDir = process.env.DATA_DIR ?? path.resolve("data");
const piDir = path.join(dataDir, "pi");
fs.mkdirSync(piDir, { recursive: true });
const persistentAuthPath = path.join(piDir, "auth.json");
const userAuthPath = path.join(os.homedir(), ".pi", "agent", "auth.json");

function hasStoredAuth(file: string) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
  } catch {
    return false;
  }
}

const authPath =
  !process.env.DATA_DIR && !hasStoredAuth(persistentAuthPath) && hasStoredAuth(userAuthPath)
    ? userAuthPath
    : persistentAuthPath;
export const authStorage = AuthStorage.create(authPath);

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
    const baseUrl = (row.base_url ?? "http://192.168.10.120:11434").replace(/\/$/, "");
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const runningContexts = await aiboxRunningContexts(baseUrl);
      const models = await Promise.all(
        (data.models ?? []).map(async (model) => {
          const info = await aiboxModelInfo(baseUrl, model.name);
          if (info.capabilities && !info.capabilities.includes("completion")) return null;
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
      };
    });
}

export async function modelSupportsVision(provider: ProviderId, modelId: string) {
  if (provider === "aibox") return false;
  const model = (await listModels(provider)).find((candidate) => candidate.id === modelId);
  return model?.supportsVision === true;
}

export interface PiStageResult {
  content: string;
  usage: { input: number; output: number; cost: number };
  events: Array<{ type: string; message: string; data?: unknown }>;
}

function safeEvent(event: AgentSessionEvent) {
  if (event.type === "message_update") return null;
  if (event.type === "compaction_start" || event.type === "compaction_end") {
    return { type: event.type, message: `Pi: ${event.type}` };
  }
  return null;
}

export async function runPiStage(options: {
  provider: ProviderId;
  modelId: string;
  systemPrompt: string;
  prompt: string;
  images?: ImageContent[];
  onEvent?: (event: { type: string; message: string; data?: unknown }) => void;
  onStream?: (channel: "thinking" | "text", delta: string) => void;
}): Promise<PiStageResult> {
  const registry = providerRegistry();
  const providerName = options.provider === "codex" ? "openai-codex" : options.provider;
  let model = registry.find(providerName, options.modelId);

  if (!model && options.provider === "aibox") {
    const row = providerRow("aibox");
    const baseUrl = (row.base_url ?? "http://192.168.10.120:11434").replace(/\/$/, "");
    const info = await aiboxModelInfo(baseUrl, options.modelId);
    const runningContext = (await aiboxRunningContexts(baseUrl)).get(options.modelId);
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
    retry: { enabled: true, maxRetries: 2 },
    hideThinkingBlock: true,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: piDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: options.systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir: piDir,
    authStorage,
    modelRegistry: registry,
    model,
    thinkingLevel: model.reasoning ? "high" : "off",
    noTools: "all",
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager,
    resourceLoader,
  });

  const captured: PiStageResult["events"] = [];
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
    const safe = safeEvent(event);
    if (!safe) return;
    captured.push(safe);
    options.onEvent?.(safe);
  });

  try {
    await session.prompt(options.prompt, {
      expandPromptTemplates: false,
      source: "rpc",
      images: options.images,
    });
    const message = [...session.messages].reverse().find((entry) => entry.role === "assistant") as
      | AssistantMessage
      | undefined;
    if (!message) throw new Error("Das Modell hat keine Antwort geliefert.");
    if (message.errorMessage) throw new Error(message.errorMessage);
    const content = message.content
      .filter((item) => item.type === "text")
      .map((item) => (item.type === "text" ? item.text : ""))
      .join("\n")
      .trim();
    if (!content) throw new Error("Die Modellantwort war leer.");
    return {
      content,
      usage: {
        input: message.usage.input,
        output: message.usage.output,
        cost: message.usage.cost.total,
      },
      events: captured,
    };
  } finally {
    unsubscribe();
    session.dispose();
  }
}

export function codexAuthStatus() {
  authStorage.reload();
  return authStorage.getAuthStatus("openai-codex");
}
