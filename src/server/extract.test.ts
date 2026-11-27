import { describe, expect, it, vi } from "vitest";
import {
  composeSlideExtraction,
  extractDocument,
  extractionFingerprint,
  extractNativeWordStructure,
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

  it("liest die native Word-Struktur über den Tika-4-kompatiblen HTML-Endpunkt", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    // Body shape as returned by apache/tika:4.2.0-full for a DOCX with heading, list and table.
    const tikaHtml = `<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta name="tk:content-type-parser-override" content="false"/><title></title></head>
<body><h1><a name="_ziele"></a>Ziele</h1>
<p class="first_Paragraph">Das Modul <b>muss</b> prüfen.</p>
<table><tr>	<td>Risiko</td>	<td>Stufe</td></tr></table>
</body></html>`;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(tikaHtml, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    });
    vi.stubEnv("TIKA_URL", "http://tika.test:9998");
    try {
      const text = await extractNativeWordStructure(
        "konzept.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Buffer.from("docx"),
        {},
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("http://tika.test:9998/tika/html");
      expect(calls[0]?.init?.method).toBe("PUT");
      expect(new Headers(calls[0]?.init?.headers).has("Accept")).toBe(false);
      expect(text).toBe(
        "<h1>Ziele</h1>\n<p>Das Modul <b>muss</b> prüfen.</p>\n<table><tr>\t<td>Risiko</td>\t<td>Stufe</td></tr></table>",
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
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
