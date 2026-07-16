import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { PresentationKind, ProviderId } from "../shared/types.js";
import { runPiStage } from "./providers.js";

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  "article",
  "section",
  "header",
  "footer",
  "nav",
  "main",
  "figure",
  "figcaption",
  "details",
  "summary",
]);

export function markdownHtml(markdown: string): string {
  return sanitizeHtml(marked.parse(markdown, { async: false }) as string, {
    allowedTags,
    allowedAttributes: { a: ["href", "title"], code: ["class"], "*": ["id"] },
  });
}

function shell(kind: PresentationKind, title: string, body: string) {
  return `<main class="result result--${kind}">
    <header class="result__masthead"><a href="#volltext">QA Council</a><span>${title}</span></header>
    ${body}
  </main>`;
}

export async function createPresentation(options: {
  kind: PresentationKind;
  finalMarkdown: string;
  provider: ProviderId;
  model: string;
  documentName: string;
  automaticLanguage: boolean;
  onEvent?: (event: { type: string; message: string; data?: unknown }) => void;
}): Promise<{ title: string; html: string; generatedMarkdown?: string }> {
  const full = `<article id="volltext" class="result__full"><h2>Vollständiges Council-Ergebnis</h2>${markdownHtml(options.finalMarkdown)}</article>`;
  if (options.kind === "text") {
    return {
      title: `Prüfergebnis · ${options.documentName}`,
      html: shell("text", options.documentName, full),
    };
  }

  const onePaper = options.kind === "onepaper";
  const instruction = onePaper
    ? `Erzeuge ein kompaktes One-Paper für Entscheider. Nutze ausschließlich Fakten und Zahlen aus dem finalen Ergebnis. Struktur: Entscheidung, Top-Risiken, Maßnahmen, Verantwortliche, nächste 7 Tage. Maximal 650 Wörter. Gib Markdown aus.`
    : `Erzeuge die Titelseite einer seriösen Qualitätszeitung. Leite eine klare Hauptschlagzeile, eine kurze Lage, die wichtigsten Risiken und priorisierten Maßnahmen aus dem finalen Ergebnis ab. Verweise mit Markdown-Links auf #volltext. Maximal 900 Wörter. Gib Markdown aus.`;
  const language = options.automaticLanguage
    ? "Nutze die Sprache des geprüften Dokuments."
    : "Schreibe auf Deutsch.";
  const generated = await runPiStage({
    provider: options.provider,
    modelId: options.model,
    systemPrompt:
      "Du bist Redakteur für QA-Entscheidungsvorlagen. Du verdichtest erst nach abgeschlossener Fachprüfung. Erfinde keine Fakten, Bewertungen oder Zahlen.",
    prompt: `${instruction}\n${language}\n\nFINALES, BEREITS ERZEUGTES COUNCIL-ERGEBNIS:\n${options.finalMarkdown}`,
    onEvent: options.onEvent,
  });
  const feature = `<article class="result__feature">${markdownHtml(generated.content)}</article>`;

  let graphic = "";
  if (onePaper) {
    const counts = {
      kritisch: (options.finalMarkdown.match(/kritisch/gi) ?? []).length,
      hoch: (options.finalMarkdown.match(/\bhoch\b/gi) ?? []).length,
      mittel: (options.finalMarkdown.match(/mittel/gi) ?? []).length,
      niedrig: (options.finalMarkdown.match(/niedrig/gi) ?? []).length,
    };
    const max = Math.max(1, ...Object.values(counts));
    graphic = `<figure class="risk-bars"><figcaption>Risikobegriffe im vollständigen Ergebnis</figcaption>${Object.entries(
      counts,
    )
      .map(
        ([label, value]) =>
          `<div><span>${label}</span><i style="--value:${Math.round((value / max) * 100)}%"></i><b>${value}</b></div>`,
      )
      .join("")}</figure>`;
  }

  return {
    title: `${onePaper ? "One-Paper" : "QA-Zeitung"} · ${options.documentName}`,
    html: shell(options.kind, options.documentName, `${feature}${graphic}${full}`),
    generatedMarkdown: generated.content,
  };
}
