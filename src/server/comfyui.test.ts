import { describe, expect, it } from "vitest";
import {
  buildComfyUiWorkflow,
  editorialImagePrompt,
  getComfyUiConfig,
  saveComfyUiConfig,
} from "./comfyui.js";
import { createDatabase, withDatabase } from "./db/index.js";

const baseOptions = {
  prompt: "Editorial quality report",
  negativePrompt: "text, logo",
  seed: 42,
  filenamePrefix: "qa_test",
};

describe("ComfyUI workflow", () => {
  it("builds the locally supported Anima graph", () => {
    const workflow = buildComfyUiWorkflow({
      ...baseOptions,
      checkpoint: "anima-base-v1.0.safetensors",
    }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

    expect(workflow["1"]).toMatchObject({
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "anima-base-v1.0.safetensors" },
    });
    expect(workflow["2"]).toMatchObject({
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen_3_06b_base.safetensors" },
    });
    expect(workflow["3"]).toMatchObject({
      class_type: "VAELoader",
      inputs: { vae_name: "qwen_image_vae.safetensors" },
    });
    expect(workflow["10"].class_type).toBe("SaveImage");
  });

  it("uses a conventional checkpoint graph for other models", () => {
    const workflow = buildComfyUiWorkflow({
      ...baseOptions,
      checkpoint: "editorial-sdxl.safetensors",
    }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

    expect(workflow["1"].class_type).toBe("CheckpointLoaderSimple");
    expect(workflow["2"].inputs.clip).toEqual(["1", 1]);
    expect(workflow["6"].inputs.vae).toEqual(["1", 2]);
    expect(workflow["7"].class_type).toBe("SaveImage");
  });

  it("creates a bounded prompt without Markdown control syntax", () => {
    const prompt = editorialImagePrompt(
      "Release #42",
      `# Entscheidung\n\n**Kritisches Risiko:** ${"lange Beschreibung ".repeat(100)}`,
    );

    expect(prompt).toContain("serious European quality-assurance publication");
    expect(prompt).toContain("Release 42");
    expect(prompt).not.toContain("**");
    expect(prompt.length).toBeLessThan(1_700);
  });

  it("akzeptiert eine leere optionale Konfiguration nur im deaktivierten Zustand", () => {
    const database = createDatabase(":memory:");
    try {
      withDatabase(database, () => {
        expect(saveComfyUiConfig({ enabled: false, baseUrl: "", checkpoint: "" })).toEqual({
          enabled: false,
          baseUrl: "",
          checkpoint: "",
        });
        expect(getComfyUiConfig()).toEqual({
          enabled: false,
          baseUrl: "",
          checkpoint: "",
        });
        expect(() => saveComfyUiConfig({ enabled: true, baseUrl: "", checkpoint: "" })).toThrow(
          "Serveradresse und ein Checkpoint",
        );
      });
    } finally {
      database.close();
    }
  });
});
