import { describe, expect, it } from "vitest";
import { composeSlideExtraction, isPresentationDocument } from "./extract.js";

describe("Präsentationsextraktion", () => {
  it("erkennt PowerPoint- und OpenDocument-Präsentationen", () => {
    expect(isPresentationDocument("roadmap.pptx", "application/octet-stream")).toBe(true);
    expect(
      isPresentationDocument(
        "roadmap.bin",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe(true);
    expect(isPresentationDocument("bericht.pdf", "application/pdf")).toBe(false);
  });

  it("ordnet Text und visuelle Codex-Beschreibung eindeutig einer Folie zu", () => {
    expect(composeSlideExtraction(3, "Umsatz\n2026", "Ein ansteigendes Balkendiagramm.")).toContain(
      "# Folie 3\n\n## Extrahierter Folientext\n\nUmsatz\n2026\n\n## Visuelle Folienbeschreibung (Codex)\n\nEin ansteigendes Balkendiagramm.",
    );
  });
});
