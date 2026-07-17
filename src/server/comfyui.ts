import { nanoid } from "nanoid";
import { sqlite } from "./db/index.js";

const DEFAULT_BASE_URL = process.env.COMFYUI_URL ?? "http://192.168.10.120:8188";
const DEFAULT_CHECKPOINT = process.env.COMFYUI_CHECKPOINT ?? "anima-base-v1.0.safetensors";
const REQUEST_TIMEOUT_MS = 20_000;
const GENERATION_TIMEOUT_MS = 5 * 60_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface ComfyUiConfig {
  enabled: boolean;
  baseUrl: string;
  checkpoint: string;
}

export interface ComfyUiDiscovery {
  reachable: true;
  checkpoints: string[];
  device?: string;
}

type ComfyEvent = {
  type: string;
  message: string;
  data?: unknown;
  level?: "info" | "warning" | "error";
};

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("ComfyUI muss über eine HTTP- oder HTTPS-Adresse erreichbar sein.");
  }
  if (url.username || url.password) {
    throw new Error("Anmeldedaten gehören nicht in die ComfyUI-Serveradresse.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function responseError(response: Response) {
  const body = (await response.text()).slice(0, 1_500);
  return body || `${response.status} ${response.statusText}`;
}

async function getJson<T>(
  url: string,
  timeout = REQUEST_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as T;
}

export function getComfyUiConfig(): ComfyUiConfig {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'comfyUiConfig'").get() as
    | { value: string }
    | undefined;
  try {
    const parsed = row ? (JSON.parse(row.value) as Partial<ComfyUiConfig>) : {};
    return {
      enabled: parsed.enabled === true,
      baseUrl: parsed.baseUrl || DEFAULT_BASE_URL,
      checkpoint: parsed.checkpoint || DEFAULT_CHECKPOINT,
    };
  } catch {
    return {
      enabled: false,
      baseUrl: DEFAULT_BASE_URL,
      checkpoint: DEFAULT_CHECKPOINT,
    };
  }
}

export function saveComfyUiConfig(config: ComfyUiConfig) {
  const normalized = {
    enabled: config.enabled,
    baseUrl: normalizeBaseUrl(config.baseUrl),
    checkpoint: config.checkpoint.trim(),
  };
  sqlite
    .prepare(
      "INSERT INTO app_settings(key, value) VALUES ('comfyUiConfig', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(JSON.stringify(normalized));
  return normalized;
}

export async function discoverComfyUi(baseUrl: string): Promise<ComfyUiDiscovery> {
  const base = normalizeBaseUrl(baseUrl);
  const [stats, checkpoints] = await Promise.all([
    getJson<{
      devices?: Array<{ name?: string; type?: string }>;
    }>(`${base}/system_stats`),
    getJson<string[]>(`${base}/models/checkpoints`),
  ]);
  const device = stats.devices?.[0];
  return {
    reachable: true,
    checkpoints,
    ...(device?.name || device?.type
      ? { device: [device.name, device.type].filter(Boolean).join(" · ") }
      : {}),
  };
}

function isAnima(checkpoint: string) {
  return checkpoint.toLowerCase().includes("anima");
}

export function buildComfyUiWorkflow(options: {
  checkpoint: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
  filenamePrefix: string;
}) {
  const common = {
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: options.prompt },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: options.negativePrompt },
    },
    "7": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 640, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        seed: options.seed,
        steps: 30,
        cfg: 4,
        sampler_name: "er_sde",
        scheduler: "simple",
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
        denoise: 1,
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["3", 0] },
    },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["9", 0], filename_prefix: options.filenamePrefix },
    },
  };

  if (isAnima(options.checkpoint)) {
    return {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: options.checkpoint },
      },
      "2": {
        class_type: "CLIPLoader",
        inputs: {
          clip_name: "qwen_3_06b_base.safetensors",
          type: "stable_diffusion",
          device: "default",
        },
      },
      "3": {
        class_type: "VAELoader",
        inputs: { vae_name: "qwen_image_vae.safetensors" },
      },
      "4": {
        class_type: "ModelSamplingAuraFlow",
        inputs: { model: ["1", 0], shift: 3 },
      },
      ...common,
    };
  }

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: options.checkpoint },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: options.prompt },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: options.negativePrompt },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 640, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        seed: options.seed,
        steps: 28,
        cfg: 6,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        denoise: 1,
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: options.filenamePrefix },
    },
  };
}

function compactText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`[\]()>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
}

export function editorialImagePrompt(documentName: string, summary: string) {
  return [
    "masterpiece, best quality, score_7, safe.",
    "Create a sophisticated editorial illustration for a serious European quality-assurance publication.",
    "Warm ivory paper, charcoal ink, muted rust and olive, fine engraved linework, restrained composition, landscape format.",
    "Show the central subject and risk tension implied by this report without depicting brand marks.",
    "No readable text, no letters, no logos, no watermark, no UI screenshot.",
    `Report title: ${compactText(documentName)}.`,
    `Editorial context: ${compactText(summary)}.`,
  ].join(" ");
}

const negativePrompt =
  "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration, readable text, letters, logo, watermark, signature, UI screenshot";

function historyError(entry: {
  status?: { status_str?: string; messages?: Array<[string, Record<string, unknown>]> };
}) {
  const error = entry.status?.messages?.filter(([type]) => type === "execution_error").at(-1)?.[1];
  if (!error) return entry.status?.status_str || "ComfyUI-Ausführung fehlgeschlagen.";
  return String(error.exception_message ?? error.node_type ?? "ComfyUI-Ausführung fehlgeschlagen.");
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function generateComfyUiImage(options: {
  config: ComfyUiConfig;
  prompt: string;
  runId: string;
  signal?: AbortSignal;
  onEvent?: (event: ComfyEvent) => void;
}) {
  const base = normalizeBaseUrl(options.config.baseUrl);
  const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  const workflow = buildComfyUiWorkflow({
    checkpoint: options.config.checkpoint,
    prompt: options.prompt,
    negativePrompt,
    seed,
    filenamePrefix: `qa_council_${options.runId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
  });
  const queued = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!queued.ok) throw new Error(`ComfyUI lehnt den Workflow ab: ${await responseError(queued)}`);
  const queuedBody = (await queued.json()) as {
    prompt_id?: string;
    node_errors?: Record<string, unknown>;
  };
  if (!queuedBody.prompt_id) {
    throw new Error(
      `ComfyUI hat keine Prompt-ID geliefert${
        queuedBody.node_errors ? `: ${JSON.stringify(queuedBody.node_errors)}` : "."
      }`,
    );
  }
  options.onEvent?.({
    type: "image_generation_queued",
    message: "ComfyUI-Workflow wurde eingereiht",
    data: { promptId: queuedBody.prompt_id, checkpoint: options.config.checkpoint },
  });

  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  let image:
    | {
        filename: string;
        subfolder?: string;
        type?: string;
      }
    | undefined;
  while (Date.now() < deadline) {
    const history = await getJson<
      Record<
        string,
        {
          status?: {
            completed?: boolean;
            status_str?: string;
            messages?: Array<[string, Record<string, unknown>]>;
          };
          outputs?: Record<
            string,
            { images?: Array<{ filename: string; subfolder?: string; type?: string }> }
          >;
        }
      >
    >(
      `${base}/history/${encodeURIComponent(queuedBody.prompt_id)}`,
      REQUEST_TIMEOUT_MS,
      options.signal,
    );
    const entry = history[queuedBody.prompt_id];
    if (entry?.status?.completed) {
      image = Object.values(entry.outputs ?? {})
        .flatMap((output) => output.images ?? [])
        .at(0);
      if (!image) throw new Error(historyError(entry));
      break;
    }
    if (entry?.status?.status_str === "error") throw new Error(historyError(entry));
    await abortableDelay(1_000, options.signal);
  }
  if (!image) throw new Error("ComfyUI hat die Bildgenerierung nicht rechtzeitig abgeschlossen.");

  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  const downloaded = await fetch(`${base}/view?${query}`, {
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!downloaded.ok)
    throw new Error(`ComfyUI-Bild konnte nicht geladen werden: ${await responseError(downloaded)}`);
  const mimeType = downloaded.headers.get("content-type")?.split(";")[0] ?? "image/png";
  if (!mimeType.startsWith("image/")) throw new Error("ComfyUI hat keine Bilddatei geliefert.");
  const data = Buffer.from(await downloaded.arrayBuffer());
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
    throw new Error("Das von ComfyUI gelieferte Bild ist leer oder größer als 25 MB.");
  }
  return { data, mimeType, remotePromptId: queuedBody.prompt_id };
}

export async function getOrCreateEditorialImage(options: {
  runId: string;
  slot?: string;
  documentName: string;
  summary: string;
  signal?: AbortSignal;
  onEvent?: (event: ComfyEvent) => void;
}) {
  const slot = options.slot ?? "hero";
  const existing = sqlite
    .prepare(
      `SELECT id FROM generated_images
       WHERE run_id = ? AND provider = 'comfyui' AND slot = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(options.runId, slot) as { id: string } | undefined;
  if (existing) {
    options.onEvent?.({
      type: "image_generation_reused",
      message: `Vorhandenes ComfyUI-Bild für „${slot}“ wird wiederverwendet`,
      data: { imageId: existing.id, slot },
    });
    return existing.id;
  }

  const config = getComfyUiConfig();
  if (!config.enabled) throw new Error("ComfyUI ist in den Einstellungen nicht aktiviert.");
  if (!config.checkpoint) throw new Error("In den Einstellungen ist kein ComfyUI-Modell gewählt.");
  const prompt = editorialImagePrompt(options.documentName, options.summary);
  options.onEvent?.({
    type: "image_generation_started",
    message: "ComfyUI erzeugt das redaktionelle Titelbild",
    data: { checkpoint: config.checkpoint },
  });
  const generated = await generateComfyUiImage({
    config,
    prompt,
    runId: options.runId,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  const id = nanoid();
  sqlite
    .prepare(
      `INSERT INTO generated_images(
        id, run_id, provider, prompt, remote_prompt_id, slot, mime_type, data, created_at
       ) VALUES (?, ?, 'comfyui', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.runId,
      prompt,
      generated.remotePromptId,
      slot,
      generated.mimeType,
      generated.data,
      new Date().toISOString(),
    );
  options.onEvent?.({
    type: "image_generation_completed",
    message: "ComfyUI-Titelbild wurde gespeichert",
    data: { imageId: id, promptId: generated.remotePromptId, bytes: generated.data.length },
  });
  return id;
}

export function hydratePresentationImages(html: string) {
  const ids = [...html.matchAll(/\/api\/images\/([a-zA-Z0-9_-]+)/g)].map((match) => match[1]);
  let hydrated = html;
  for (const id of new Set(ids)) {
    const row = sqlite
      .prepare("SELECT mime_type, data FROM generated_images WHERE id = ?")
      .get(id) as { mime_type: string; data: Buffer } | undefined;
    if (row) {
      hydrated = hydrated.replaceAll(
        `/api/images/${id}`,
        `data:${row.mime_type};base64,${row.data.toString("base64")}`,
      );
    }
  }
  return hydrated;
}
