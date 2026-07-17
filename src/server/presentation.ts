import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type {
  ImageProvider,
  PresentationKind,
  PresentationPage,
  ProviderId,
} from "../shared/types.js";
import { getOrCreateRunImage } from "./images.js";

const RESULT_BASE = "__RESULT_BASE__";

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
  "meter",
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (match, code: string) => {
      const point = Number(code);
      return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => {
      const point = Number.parseInt(code, 16);
      return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : match;
    })
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

export function markdownHtml(markdown: string): string {
  return sanitizeHtml(marked.parse(markdown, { async: false }) as string, {
    allowedTags,
    allowedAttributes: { a: ["href", "title"], code: ["class"], "*": ["id"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
  });
}

function unwrapHtmlFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function layoutHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "class"],
      img: ["src", "alt", "loading", "width", "height", "class"],
      meter: ["value", "min", "max", "low", "high", "optimum", "class"],
      "*": ["id", "class"],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
  });
}

interface NewspaperSection {
  slug: string;
  title: string;
  markdown: string;
}

interface AiNewspaperPage {
  slug: string;
  title: string;
  html: string;
}

function transportContent(source: string, tag: string) {
  return source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.trim() ?? "";
}

function parseAiNewspaper(source: string) {
  const newspaper = transportContent(source, "newspaper");
  if (!newspaper) return null;
  const front = transportContent(newspaper, "front");
  if (!front) return null;
  const pages = [...newspaper.matchAll(/<page\s+([^>]+)>([\s\S]*?)<\/page>/gi)]
    .map((match): AiNewspaperPage => {
      const slug = match[1].match(/\bslug="([^"]+)"/i)?.[1] ?? "";
      const title = match[1].match(/\btitle="([^"]+)"/i)?.[1] ?? "";
      return {
        slug: slugify(slug),
        title: decodeHtmlEntities(title.trim()),
        html: match[2].trim(),
      };
    })
    .filter((page) => page.slug && page.title && page.html);
  return pages.length ? { front, pages } : null;
}

function parseReportPackage(value: string) {
  const source = unwrapHtmlFence(value);
  return {
    source,
    imageBrief: transportContent(source, "image-brief"),
    newspaper: parseAiNewspaper(source),
    onepaper: transportContent(source, "onepaper"),
  };
}

const sectionRoutes: Record<string, { slug: string; title: string }> = {
  "Finale Synthese": { slug: "synthese", title: "Entscheidung" },
  "Triage, Scope und RACI": { slug: "triage", title: "Triage & RACI" },
  "Isolierte Einzelreviews": { slug: "fachreviews", title: "Fachreviews" },
  "Cross-Reviews": { slug: "cross-reviews", title: "Cross-Reviews" },
  Debattenprotokoll: { slug: "debatte", title: "Debatte" },
  "Nachweis der vollständigen Dokumentverarbeitung": {
    slug: "nachweis",
    title: "Nachweis",
  },
};

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function splitNewspaperSections(markdown: string): NewspaperSection[] {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  const selected: RegExpMatchArray[] = [];
  let before = markdown.length;
  for (const sourceTitle of Object.keys(sectionRoutes).reverse()) {
    const match = matches
      .filter(
        (candidate) =>
          candidate[1].trim() === sourceTitle && (candidate.index ?? markdown.length) < before,
      )
      .at(-1);
    if (!match) continue;
    selected.push(match);
    before = match.index ?? before;
  }
  const headings = selected.reverse();
  return headings.map((match, index) => {
    const sourceTitle = match[1].trim();
    const route = sectionRoutes[sourceTitle] ?? {
      slug: slugify(sourceTitle),
      title: sourceTitle,
    };
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    return {
      ...route,
      markdown: markdown.slice(start, end).trim(),
    };
  });
}

function newspaperNav(sections: NewspaperSection[], activeSlug: string) {
  const items = [{ slug: "", title: "Titelseite" }, ...sections];
  return `<nav class="newspaper-nav" aria-label="Zeitungsressorts">${items
    .map(
      (item) =>
        `<a ${item.slug === activeSlug ? 'class="active"' : ""} href="${RESULT_BASE}${
          item.slug ? `/${item.slug}` : ""
        }">${escapeHtml(item.title)}</a>`,
    )
    .join("")}</nav>`;
}

function shell(
  kind: PresentationKind,
  title: string,
  body: string,
  newspaperSections: NewspaperSection[] = [],
  activeSlug = "",
) {
  const safeTitle = escapeHtml(title);
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date());
  const masthead =
    kind === "newspaper"
      ? `<header class="result__masthead newspaper-masthead">
          <span>Qualität · Risiko · Entscheidung</span>
          <a href="${RESULT_BASE}">QA REPORT</a>
          <time>${date}</time>
        </header>
        ${newspaperNav(newspaperSections, activeSlug)}
        <div class="newspaper-context">${safeTitle}</div>`
      : `<header class="result__masthead">
          <a href="#volltext">QA Council</a><span>${safeTitle}</span>
        </header>`;
  return `<main class="result result--${kind}">
    ${masthead}
    ${body}
  </main>`;
}

export function reportDesignerPrompt(options: {
  finalMarkdown: string;
  documentName: string;
  automaticLanguage: boolean;
}) {
  const sections = splitNewspaperSections(options.finalMarkdown);
  const pageManifest = sections
    .map((section) => `- slug="${section.slug}", Inhaltsbereich="${section.title}"`)
    .join("\n");
  return `Wende den vollständig geladenen Report-Designer-Skill an. Erzeuge jetzt das komplette Report-Package neu.

DOKUMENTNAME: ${options.documentName}
SPRACHE: ${
    options.automaticLanguage ? "Sprache des geprüften Dokuments automatisch übernehmen" : "Deutsch"
  }

VERBINDLICHE ZEITUNGSSEITEN:
${pageManifest}

Das Bildbriefing muss spezifisch auf dieses Dokument und seine wichtigsten Befunde eingehen.
Gib ausschließlich das im Skill definierte <report-package> aus.

FINALES, FACHLICH ABGESCHLOSSENES COUNCIL-ERGEBNIS:
${options.finalMarkdown}`;
}

export async function createPresentation(options: {
  kind: PresentationKind;
  finalMarkdown: string;
  reportPackage?: string;
  documentName: string;
  provider?: ProviderId;
  model?: string;
  runId?: string;
  imageProvider?: ImageProvider | null;
  editorialImageId?: string | null;
  reportCss?: string;
  imageSlots?: Array<{ slot: string; hook: string; brief: string; alt: string }>;
  signal?: AbortSignal;
  onEvent?: (event: {
    type: string;
    message: string;
    data?: unknown;
    level?: "info" | "warning" | "error";
  }) => void;
}): Promise<{
  title: string;
  html: string;
  pages?: PresentationPage[];
  generatedMarkdown?: string;
  editorialImageId?: string | null;
}> {
  const full = `<article id="volltext" class="result__full"><h2>Vollständiges Council-Ergebnis</h2>${markdownHtml(options.finalMarkdown)}</article>`;
  if (options.kind === "text") {
    return {
      title: `Prüfergebnis · ${options.documentName}`,
      html: shell("text", options.documentName, full),
    };
  }

  const onePaper = options.kind === "onepaper";
  const sections = splitNewspaperSections(options.finalMarkdown);
  const parsedPackage = parseReportPackage(options.reportPackage ?? "");
  const generatedSource = parsedPackage.source;
  if (!generatedSource) {
    throw new Error("Der Report-Designer hat kein HTML-Package geliefert.");
  }
  const requestedSlots = options.imageSlots?.length
    ? options.imageSlots
    : [
        {
          slot: "editorial",
          hook: "{{EDITORIAL_IMAGE}}",
          brief: parsedPackage.imageBrief || generatedSource,
          alt: `Redaktionelle Illustration zu ${options.documentName}`,
        },
      ];
  const generatedSlots = new Map<string, { id: string; html: string }>();
  let imageId = options.editorialImageId;
  await Promise.all(
    requestedSlots.map(async (slot) => {
      let id =
        slot.hook === "{{EDITORIAL_IMAGE}}" && options.editorialImageId !== undefined
          ? options.editorialImageId
          : undefined;
      if (
        id === undefined &&
        options.imageProvider &&
        options.runId &&
        options.provider &&
        options.model
      ) {
        try {
          id = await getOrCreateRunImage({
            runId: options.runId,
            slot: `${options.kind}:${slot.slot}`,
            provider: options.provider,
            model: options.model,
            imageProvider: options.imageProvider,
            documentName: options.documentName,
            summary: slot.brief,
            signal: options.signal,
            onEvent: options.onEvent,
          });
        } catch (error) {
          if (options.signal?.aborted) throw error;
          id = null;
          options.onEvent?.({
            type: "image_generation_failed",
            level: "warning",
            message: `Bild-Slot „${slot.slot}“ konnte nicht erzeugt werden: ${
              error instanceof Error ? error.message : String(error)
            }`,
            data: { slot: slot.slot, kind: options.kind },
          });
        }
      }
      if (slot.hook === "{{EDITORIAL_IMAGE}}") imageId = id;
      if (id) {
        generatedSlots.set(slot.hook, {
          id,
          html: `<img src="/api/images/${id}" alt="${escapeHtml(slot.alt)}" loading="eager">`,
        });
      }
    }),
  );
  const applyImages = (html: string) => {
    for (const slot of requestedSlots) {
      html = html.replaceAll(slot.hook, generatedSlots.get(slot.hook)?.html ?? "");
    }
    return html.replace(/\{\{(?:EDITORIAL_IMAGE|REPORT_IMAGE_[A-Z0-9_]+)\}\}/g, "");
  };
  const withReportCss = (html: string) =>
    options.reportCss ? `<style data-report-workspace>${options.reportCss}</style>${html}` : html;

  if (onePaper) {
    if (!parsedPackage.onepaper) {
      throw new Error("Im Report-Package fehlt der visuelle HTML-Report.");
    }
    let sheet = layoutHtml(parsedPackage.onepaper);
    if (!sheet.includes("onepaper-sheet")) {
      options.onEvent?.({
        type: "presentation_html_fallback",
        level: "warning",
        message: "Visual-Report-HTML ohne erforderliche Außenhülle; sichere Hülle ergänzt",
      });
      sheet = `<section class="onepaper-sheet visual-report"><header class="onepaper-title visual-hero"><span>VISUAL REPORT · QA COUNCIL</span><strong>${escapeHtml(
        options.documentName,
      )}</strong></header><main class="onepaper-content">${sheet}</main><footer class="onepaper-footer"><span>Entscheidungsgrundlage</span><b>QA Council</b></footer></section>`;
    }
    sheet = applyImages(sheet);
    return {
      title: `Visual Report · ${options.documentName}`,
      html: withReportCss(shell("onepaper", options.documentName, sheet)),
      editorialImageId: imageId,
    };
  }

  const parsed = parsedPackage.newspaper;
  if (!parsed) {
    throw new Error("Im Report-Package fehlt die mehrseitige HTML-Zeitung.");
  }
  const aiPages = new Map(parsed.pages.map((page) => [page.slug, page]));
  const missingPages = sections.filter((section) => !aiPages.has(section.slug));
  if (missingPages.length) {
    throw new Error(
      `Im Report-Package fehlen Zeitungsseiten: ${missingPages.map((page) => page.slug).join(", ")}`,
    );
  }
  const newspaperPages = sections.map((section) => {
    const aiPage = aiPages.get(section.slug);
    if (!aiPage) throw new Error(`Zeitungsseite ${section.slug} fehlt.`);
    return {
      slug: section.slug,
      title: aiPage.title,
      html: aiPage.html,
    };
  });
  const navigationSections = newspaperPages.map((page) => ({ ...page, markdown: "" }));
  let front = layoutHtml(parsed.front);
  front = applyImages(front);
  if (!imageId) {
    front = front.replace(
      /<figure(?:\s[^>]*)?>\s*(?:<figcaption(?:\s[^>]*)?>[\s\S]*?<\/figcaption>)?\s*<\/figure>/gi,
      "",
    );
  }
  const pages = newspaperPages.map(
    (page): PresentationPage => ({
      slug: page.slug,
      title: page.title,
      html: withReportCss(
        shell(
          "newspaper",
          options.documentName,
          `${applyImages(layoutHtml(page.html))}
         <footer class="newspaper-page-footer"><a href="${RESULT_BASE}">← Zur Titelseite</a><span>QA REPORT · ${escapeHtml(
           options.documentName,
         )}</span></footer>`,
          navigationSections,
          page.slug,
        ),
      ),
    }),
  );

  return {
    title: `QA-Tageszeitung · ${options.documentName}`,
    html: withReportCss(shell("newspaper", options.documentName, front, navigationSections)),
    pages,
    editorialImageId: imageId,
  };
}
