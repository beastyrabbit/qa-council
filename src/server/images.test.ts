import { describe, expect, it } from "vitest";
import { openRouterSupportsNativeImage } from "./images.js";

describe("automatische Bildquellen", () => {
  it("erkennt ein nativ bildfähiges OpenRouter-Modell", () => {
    expect(openRouterSupportsNativeImage("google/gemini-3-pro-image")).toBe(true);
  });

  it("erkennt ein reines Textmodell für den ComfyUI-Fallback", () => {
    expect(openRouterSupportsNativeImage("openai/gpt-oss-20b")).toBe(false);
  });
});
