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
  provider: "openai" | "openrouter";
  prompt: string;
  mimeType: string;
  data: Buffer;
  remotePromptId?: string;
}) {
  const id = nanoid();
  sqlite
    .prepare(
      `INSERT INTO generated_images(id, run_id, provider, prompt, remote_prompt_id, mime_type, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.runId,
      options.provider,
      options.prompt,
      options.remotePromptId ?? null,
      options.mimeType,
      options.data,
      new Date().toISOString(),
    );
  return id;
}

async function generateOpenAiImage(options: {
  runId: string;
  prompt: string;
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
    signal: AbortSignal.timeout(180_000),
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
  model: string;
  prompt: string;
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
    { apiKey, signal: AbortSignal.timeout(180_000) },
  );
  const image = result.output.find((item) => item.type === "image");
  if (result.stopReason === "error" || !image || image.type !== "image") {
    throw new Error(result.errorMessage ?? `${model.name} lieferte kein Bild.`);
  }
  const data = imageData(image.data, "OpenRouter");
  const id = storeImage({
    runId: options.runId,
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
  provider: ProviderId;
  model: string;
  imageProvider: ImageProvider;
  documentName: string;
  summary: string;
  onEvent?: (event: ImageEvent) => void;
}) {
  const existing = sqlite
    .prepare(
      "SELECT id, provider FROM generated_images WHERE run_id = ? ORDER BY created_at LIMIT 1",
    )
    .get(options.runId) as { id: string; provider: string } | undefined;
  if (existing) {
    options.onEvent?.({
      type: "image_generation_reused",
      message: "Das Editorialmotiv dieses Laufs wird für die zweite Ausgabe wiederverwendet",
      data: { imageId: existing.id, provider: existing.provider },
    });
    return existing.id;
  }

  const prompt = editorialImagePrompt(options.documentName, options.summary);
  if (options.imageProvider === "openai") {
    return generateOpenAiImage({ runId: options.runId, prompt, onEvent: options.onEvent });
  }
  if (options.imageProvider === "openrouter") {
    try {
      const nativeImage = await generateOpenRouterImage({
        runId: options.runId,
        model: options.model,
        prompt,
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
    documentName: options.documentName,
    summary: options.summary,
    onEvent: options.onEvent,
  });
}
