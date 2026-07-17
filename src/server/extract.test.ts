import { describe, expect, it } from "vitest";
import {
  composeSlideExtraction,
  extractDocument,
  extractionFingerprint,
  isPresentationDocument,
  mapWithConcurrency,
  runWithTimeoutAndRetry,
} from "./extract.js";

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

  it("versioniert den Extraktionscache nach Dateityp und MIME-Route", () => {
    const docx = extractionFingerprint(
      "bericht.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "gpt-5.5",
    );
    expect(
      extractionFingerprint(
        "bericht.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "gpt-5.5",
      ),
    ).toBe(docx);
    expect(extractionFingerprint("bericht.bin", "application/octet-stream", "gpt-5.5")).not.toBe(
      docx,
    );
    expect(
      extractionFingerprint(
        "bericht.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "gpt-5.6",
      ),
    ).not.toBe(docx);
  });

  it("protokolliert die direkte Extraktion und erzeugt Belegabschnitte", async () => {
    const messages: string[] = [];
    const result = await extractDocument(
      "smoke.md",
      "text/markdown",
      Buffer.from("# Smoke\n\nEin prüfbarer Inhalt."),
      { onProgress: (message) => messages.push(message) },
    );

    expect(result.chunks).toHaveLength(1);
    expect(messages).toEqual([
      "Textdatei wird direkt eingelesen",
      "Extraktion wurde in 1 Belegabschnitte gegliedert",
    ]);
  });

  it("begrenzt parallele Seitenaufgaben und behält die Seitenreihenfolge", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 4, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 5 : 10));
      active -= 1;
      return `Seite ${value}`;
    });

    expect(maximum).toBe(4);
    expect(result).toEqual([
      "Seite 1",
      "Seite 2",
      "Seite 3",
      "Seite 4",
      "Seite 5",
      "Seite 6",
      "Seite 7",
    ]);
  });

  it("wiederholt eine fehlgeschlagene Seitenaufgabe und liefert den zweiten Versuch", async () => {
    const attempts: number[] = [];
    const retries: number[] = [];
    const result = await runWithTimeoutAndRetry(
      {
        timeoutMs: 100,
        retries: 1,
        onRetry: (_error, attempt) => retries.push(attempt),
      },
      async (_signal, attempt) => {
        attempts.push(attempt);
        if (attempt === 1) throw new Error("temporär");
        return "beschrieben";
      },
    );

    expect(result).toBe("beschrieben");
    expect(attempts).toEqual([1, 2]);
    expect(retries).toEqual([1]);
  });

  it("bricht einen hängenden Seitenversuch am Timeout ab", async () => {
    await expect(
      runWithTimeoutAndRetry({ timeoutMs: 10, retries: 0 }, (signal) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
