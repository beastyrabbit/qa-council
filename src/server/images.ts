import { builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
import { nanoid } from "nanoid";
import type { ImageProvider, ProviderId } from "../shared/types.js";
import { editorialImagePrompt, getOrCreateEditorialImage } from "./comfyui.js";
import { decryptSecret } from "./crypto.js";
import { sqlite } from "./db/index.js";
import { providerRow } from "./providers.js";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface ImageEvent {
  type: string;
  message: string;
  data?: unknown;
  level?: "info" | "warning" | "error";
}

export function openRouterSupportsNativeImage(modelId: string) {
  const model = builtinImagesModels().getModel("openrouter", modelId);
  return Boolean(model?.input.includes("text") && model.output.includes("image"));
}

function imageData(value: string, provider: string) {
  const data = Buffer.from(value, "base64");
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
    throw new Error(`${provider} lieferte ein leeres oder zu großes Bild.`);
  }
  return data;
}

function storeImage(options: {
  runId: string;
  slot: string;
  provider: "openai" | "openrouter";
  prompt: string;
  mimeType: string;
  data: Buffer;
  remotePromptId?: string;
}) {
  const run = sqlite
    .prepare("SELECT current_attempt FROM runs WHERE id = ?")
    .get(options.runId) as {
    current_attempt: number;
  };
  const id = nanoid();
  sqlite
    .prepare(
      `INSERT INTO generated_images(
        id, run_id, attempt_no, provider, prompt, remote_prompt_id, slot, mime_type, data, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.runId,
      run.current_attempt,
      options.provider,
      options.prompt,
      options.remotePromptId ?? null,
      options.slot,
      options.mimeType,
      options.data,
      new Date().toISOString(),
    );
  return id;
}

async function generateOpenAiImage(options: {
  runId: string;
  slot: string;
  prompt: string;
  signal?: AbortSignal;
  onEvent?: (event: ImageEvent) => void;
}) {
  const row = providerRow("codex");
  const apiKey = decryptSecret(row.encrypted_api_key) ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Für native Codex-Bilder fehlt ein OpenAI API-Key. Codex-OAuth deckt die Bild-API nicht ab.",
    );
  }
  options.onEvent?.({
    type: "image_generation_started",
    message: "OpenAI GPT Image erzeugt das dokumentbezogene Editorialmotiv",
    data: { provider: "openai", model: "gpt-image-2" },
  });
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: options.prompt,
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
    }),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(180_000)])
      : AbortSignal.timeout(180_000),
  });
  const body = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  };
  if (!response.ok || !body.data?.[0]?.b64_json) {
    throw new Error(body.error?.message ?? `OpenAI Bild-API antwortete mit ${response.status}.`);
  }
  const data = imageData(body.data[0].b64_json, "OpenAI");
  const id = storeImage({
    runId: options.runId,
    slot: options.slot,
    provider: "openai",
    prompt: options.prompt,
    mimeType: "image/png",
    data,
  });
  options.onEvent?.({
    type: "image_generation_completed",
    message: "OpenAI-Editorialmotiv wurde gespeichert",
    data: { provider: "openai", imageId: id, bytes: data.length },
  });
  return id;
}

async function generateOpenRouterImage(options: {
  runId: string;
  slot: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
  onEvent?: (event: ImageEvent) => void;
}) {
  const row = providerRow("openrouter");
  const apiKey = decryptSecret(row.encrypted_api_key) ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Für native OpenRouter-Bilder fehlt der OpenRouter API-Key.");
  const imagesModels = builtinImagesModels();
  const model = imagesModels.getModel("openrouter", options.model);
  if (!model || !openRouterSupportsNativeImage(options.model)) return null;

  options.onEvent?.({
    type: "image_generation_started",
    message: `${model.name} erzeugt das Editorialmotiv nativ über OpenRouter`,
    data: { provider: "openrouter", model: model.id },
  });
  const result = await imagesModels.generateImages(
    model,
    { input: [{ type: "text", text: options.prompt }] },
    {
      apiKey,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(180_000)])
        : AbortSignal.timeout(180_000),
    },
  );
  const image = result.output.find((item) => item.type === "image");
  if (result.stopReason === "error" || !image || image.type !== "image") {
    throw new Error(result.errorMessage ?? `${model.name} lieferte kein Bild.`);
  }
  const data = imageData(image.data, "OpenRouter");
  const id = storeImage({
    runId: options.runId,
    slot: options.slot,
    provider: "openrouter",
    prompt: options.prompt,
    mimeType: image.mimeType,
    data,
    remotePromptId: result.responseId,
  });
  options.onEvent?.({
    type: "image_generation_completed",
    message: "Natives OpenRouter-Editorialmotiv wurde gespeichert",
    data: { provider: "openrouter", model: model.id, imageId: id, bytes: data.length },
  });
  return id;
}

export async function getOrCreateRunImage(options: {
  runId: string;
  slot?: string;
  provider: ProviderId;
  model: string;
  imageProvider: ImageProvider;
  documentName: string;
  summary: string;
  signal?: AbortSignal;
  onEvent?: (event: ImageEvent) => void;
}) {
  const slot = options.slot ?? "hero";
  const existing = sqlite
    .prepare(
      `SELECT g.id, g.provider FROM generated_images g JOIN runs r ON r.id = g.run_id
       WHERE g.run_id = ? AND g.attempt_no = r.current_attempt AND g.slot = ?
       ORDER BY g.created_at LIMIT 1`,
    )
    .get(options.runId, slot) as { id: string; provider: string } | undefined;
  if (existing) {
    options.onEvent?.({
      type: "image_generation_reused",
      message: `Das Bild für den Slot „${slot}“ wird wiederverwendet`,
      data: { imageId: existing.id, provider: existing.provider, slot },
    });
    return existing.id;
  }

  const prompt = editorialImagePrompt(options.documentName, options.summary);
  if (options.imageProvider === "openai") {
    try {
      return await generateOpenAiImage({
        runId: options.runId,
        slot,
        prompt,
        signal: options.signal,
        onEvent: options.onEvent,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.onEvent?.({
        type: "image_generation_fallback",
        level: "warning",
        message: `OpenAI-Bildausgabe nicht verfügbar; das lokale ComfyUI übernimmt: ${
          error instanceof Error ? error.message : String(error)
        }`,
        data: { provider: "openai", fallback: "comfyui", slot },
      });
      return getOrCreateEditorialImage({
        runId: options.runId,
        slot,
        documentName: options.documentName,
        summary: options.summary,
        signal: options.signal,
        onEvent: options.onEvent,
      });
    }
  }
  if (options.imageProvider === "openrouter") {
    try {
      const nativeImage = await generateOpenRouterImage({
        runId: options.runId,
        slot,
        model: options.model,
        prompt,
        signal: options.signal,
        onEvent: options.onEvent,
      });
      if (nativeImage) return nativeImage;
      options.onEvent?.({
        type: "image_generation_fallback",
        level: "warning",
        message: `${options.model} unterstützt keine native OpenRouter-Bildausgabe; ComfyUI übernimmt`,
        data: { provider: "openrouter", model: options.model, fallback: "comfyui" },
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.onEvent?.({
        type: "image_generation_fallback",
        level: "warning",
        message: `Native OpenRouter-Bildausgabe fehlgeschlagen; ComfyUI übernimmt: ${
          error instanceof Error ? error.message : String(error)
        }`,
        data: { provider: "openrouter", model: options.model, fallback: "comfyui" },
      });
    }
  }
  return getOrCreateEditorialImage({
    runId: options.runId,
    slot,
    documentName: options.documentName,
    summary: options.summary,
    signal: options.signal,
    onEvent: options.onEvent,
  });
}
