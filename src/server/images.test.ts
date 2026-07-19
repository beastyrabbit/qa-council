import { describe, expect, it, vi } from "vitest";

const imageMocks = vi.hoisted(() => ({
  comfyui: vi.fn(async () => "comfy-image"),
}));

vi.mock("./comfyui.js", () => ({
  editorialImagePrompt: (documentName: string, summary: string) => `${documentName}: ${summary}`,
  getOrCreateEditorialImage: imageMocks.comfyui,
}));
vi.mock("./crypto.js", () => ({ decryptSecret: () => undefined }));
vi.mock("./providers.js", () => ({
  providerRow: () => ({ encrypted_api_key: null }),
}));
vi.mock("./db/index.js", () => ({
  sqlite: {
    prepare: () => ({ get: () => undefined }),
  },
}));

import { getOrCreateRunImage, openRouterSupportsNativeImage } from "./images.js";

describe("automatische Bildquellen", () => {
  it("erkennt ein nativ bildfähiges OpenRouter-Modell", () => {
    expect(openRouterSupportsNativeImage("google/gemini-3-pro-image")).toBe(true);
  });

  it("erkennt ein reines Textmodell für den ComfyUI-Fallback", () => {
    expect(openRouterSupportsNativeImage("openai/gpt-oss-20b")).toBe(false);
  });

  it("nutzt bei fehlendem OpenAI-Bildschlüssel das lokale ComfyUI", async () => {
    const events: Array<{ type: string }> = [];
    const imageId = await getOrCreateRunImage({
      runId: "run",
      slot: "newspaper:actions",
      provider: "codex",
      model: "gpt-5.6-sol",
      imageProvider: "openai",
      documentName: "Konzept",
      summary: "Priorisierte Maßnahmen",
      onEvent: (event) => events.push(event),
    });

    expect(imageId).toBe("comfy-image");
    expect(imageMocks.comfyui).toHaveBeenCalledWith(
      expect.objectContaining({ slot: "newspaper:actions" }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "image_generation_fallback" }));
  });
});
