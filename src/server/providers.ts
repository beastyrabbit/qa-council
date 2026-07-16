import fs from "node:fs";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ProviderId, ProviderModel } from "../shared/types.js";
import { decryptSecret } from "./crypto.js";
import { sqlite } from "./db/index.js";

const dataDir = process.env.DATA_DIR ?? path.resolve("data");
const piDir = path.join(dataDir, "pi");
fs.mkdirSync(piDir, { recursive: true });
export const authStorage = AuthStorage.create(path.join(piDir, "auth.json"));

interface ProviderRow {
  provider: ProviderId;
  model: string;
  base_url: string | null;
  encrypted_api_key: string | null;
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

  const aibox = providerRow("aibox");
  registry.registerProvider("aibox", {
    name: "Lokale AI Box",
    baseUrl: `${(aibox.base_url ?? "http://192.168.10.120:11434").replace(/\/$/, "")}/v1`,
    apiKey: "ollama-local",
    api: "openai-completions",
    models: [
      {
        id: aibox.model,
        name: aibox.model,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 65_536,
        maxTokens: 16_384,
      },
    ],
  });
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
      return (data.models ?? []).map((model) => ({
        id: model.name,
        name: model.name,
        provider: "aibox" as const,
      }));
    } catch {
      return [{ id: row.model, name: `${row.model} (nicht erreichbar)`, provider: "aibox" }];
    }
  }

  const registry = providerRegistry();
  const registryProvider = provider === "codex" ? "openai-codex" : "openrouter";
  return registry
    .getAll()
    .filter((model) => model.provider === registryProvider)
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider,
      contextWindow: model.contextWindow,
    }));
}

export interface PiStageResult {
  content: string;
  usage: { input: number; output: number; cost: number };
  events: Array<{ type: string; message: string; data?: unknown }>;
}

function safeEvent(event: AgentSessionEvent) {
  if (event.type === "message_update") {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent.type === "thinking_delta") return null;
    if (assistantEvent.type === "text_delta") {
      return {
        type: "model_text",
        message: "Antwort wird erzeugt",
        data: { chars: assistantEvent.delta.length },
      };
    }
    return { type: assistantEvent.type, message: `Pi: ${assistantEvent.type}` };
  }
  if (event.type === "entry_appended" || event.type === "queue_update") return null;
  return { type: event.type, message: `Pi: ${event.type}` };
}

export async function runPiStage(options: {
  provider: ProviderId;
  modelId: string;
  systemPrompt: string;
  prompt: string;
  onEvent?: (event: { type: string; message: string; data?: unknown }) => void;
}): Promise<PiStageResult> {
  const registry = providerRegistry();
  const providerName = options.provider === "codex" ? "openai-codex" : options.provider;
  let model = registry.find(providerName, options.modelId);

  if (!model && options.provider === "aibox") {
    const row = providerRow("aibox");
    registry.registerProvider("aibox", {
      name: "Lokale AI Box",
      baseUrl: `${(row.base_url ?? "http://192.168.10.120:11434").replace(/\/$/, "")}/v1`,
      apiKey: "ollama-local",
      api: "openai-completions",
      models: [
        {
          id: options.modelId,
          name: options.modelId,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 65_536,
          maxTokens: 16_384,
        },
      ],
    });
    model = registry.find("aibox", options.modelId);
  }
  if (!model) throw new Error(`Modell ${providerName}/${options.modelId} wurde nicht gefunden.`);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
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
    thinkingLevel: model.reasoning ? "medium" : "off",
    noTools: "all",
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager,
    resourceLoader,
  });

  const captured: PiStageResult["events"] = [];
  const unsubscribe = session.subscribe((event) => {
    const safe = safeEvent(event);
    if (!safe) return;
    captured.push(safe);
    options.onEvent?.(safe);
  });

  try {
    await session.prompt(options.prompt, { expandPromptTemplates: false, source: "rpc" });
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
