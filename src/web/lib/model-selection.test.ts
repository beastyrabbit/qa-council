import { describe, expect, it } from "vitest";
import { resolveExplicitModel } from "./model-selection.js";

describe("explizite Modellauswahl", () => {
  const models = [{ id: "gpt-5.3-codex-spark" }, { id: "gpt-5.6-sol" }];

  it("fällt bei leerem oder unbekanntem Wert nie auf das erste Katalogmodell zurück", () => {
    expect(resolveExplicitModel(models, "")).toBeUndefined();
    expect(resolveExplicitModel(models, "nicht-mehr-verfügbar")).toBeUndefined();
  });

  it("übernimmt ausschließlich die exakt gewählte Modell-ID", () => {
    expect(resolveExplicitModel(models, "gpt-5.6-sol")).toEqual({ id: "gpt-5.6-sol" });
  });
});
