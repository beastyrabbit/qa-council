import { describe, expect, it } from "vitest";
import { chunkDocument } from "./extract.js";

describe("chunkDocument", () => {
  it("verliert keinen Inhalt an Chunk-Grenzen", () => {
    const text = `# Kapitel\n${"Absatz mit Beleg.\n".repeat(2_000)}`.trim();
    const chunks = chunkDocument(text, 800);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.content).join("\n")).toBe(text);
    expect(chunks.every((chunk, index) => chunk.position === index)).toBe(true);
  });
});
