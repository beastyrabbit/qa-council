import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_SKILL_FILES,
  EXPECTED_SKILL_HASHES,
  loadCanonicalSkills,
  sha256,
} from "./skills.js";

describe("kanonische QA-Skills", () => {
  it("enthält jede Quelldatei bytegenau", () => {
    const loaded = loadCanonicalSkills();
    expect(Object.keys(loaded)).toEqual([...CANONICAL_SKILL_FILES]);
    for (const filename of CANONICAL_SKILL_FILES) {
      const bytes = fs.readFileSync(path.resolve("resources/qa/source", filename));
      expect(sha256(bytes)).toBe(EXPECTED_SKILL_HASHES[filename]);
      expect(Buffer.from(loaded[filename])).toEqual(bytes);
    }
  });

  it("übernimmt alle 37 RACI-Zuordnungen", () => {
    const matrix = loadCanonicalSkills()["07_RACI-Team-Matrix.md"];
    const rows = matrix.split("\n").filter((line) => /^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/i.test(line));
    expect(rows).toHaveLength(37);
  });
});
