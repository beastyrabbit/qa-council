import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseCss } from "css-tree";
import * as ts from "typescript-compiler";

export type ReportWorkspaceKind = "newspaper" | "visual-report";

export interface NewspaperPageTemplate {
  slug: string;
  title: string;
}

export interface ReportManifest {
  version: 1;
  kind: ReportWorkspaceKind;
  documentName: string;
  title: string;
  imageBrief: string;
  editorialAlt: string;
  images: ReportImageSlot[];
}

export interface ReportImageSlot {
  slot: string;
  hook: string;
  brief: string;
  alt: string;
}

export interface ReportWorkspaceFiles {
  root: string;
  newspaper: {
    root: string;
    html: string;
    css: string;
    manifest: string;
  };
  visualReport: {
    root: string;
    html: string;
    css: string;
    manifest: string;
  };
}

export interface ReportWorkspaceValidation {
  valid: boolean;
  findings: string[];
  manifests: {
    newspaper?: ReportManifest;
    visualReport?: ReportManifest;
  };
}

export interface ReportWorkspaceAssembly {
  reportPackage: string;
  styles: {
    newspaper: string;
    visualReport: string;
  };
  imageSlots: Array<ReportImageSlot & { kind: ReportWorkspaceKind }>;
  snapshot: string;
  validation: ReportWorkspaceValidation;
}

const DEFAULT_NEWSPAPER_PAGES: NewspaperPageTemplate[] = [
  { slug: "synthese", title: "Entscheidung" },
  { slug: "triage", title: "Triage & RACI" },
  { slug: "fachreviews", title: "Fachreviews" },
  { slug: "cross-reviews", title: "Cross-Reviews" },
  { slug: "debatte", title: "Debatte" },
  { slug: "nachweis", title: "Nachweis" },
];

const WORKSPACE_FILES = ["index.html", "styles.css", "report.ts"] as const;
const MAX_FILE_BYTES = 750_000;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const FORBIDDEN_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "base",
  "link",
  "meta",
  "video",
  "audio",
  "canvas",
  "svg",
  "math",
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeTsString(value: string) {
  return JSON.stringify(value);
}

function assertRunId(runId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId)) {
    throw new Error("Ungültige Run-ID für den Report-Arbeitsbereich.");
  }
}

function assertPage(page: NewspaperPageTemplate) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(page.slug)) {
    throw new Error(`Ungültiger Zeitungs-Slug: ${page.slug}`);
  }
  if (!page.title.trim() || page.title.length > 120) {
    throw new Error(`Ungültiger Seitentitel für "${page.slug}".`);
  }
}

function dataRoot() {
  return path.resolve(process.env.DATA_DIR ?? "data");
}

export function reportWorkspacePath(runId: string) {
  assertRunId(runId);
  return path.join(dataRoot(), "report-workspaces", runId);
}

function manifestSource(manifest: ReportManifest) {
  return `/**
 * Statisches Report-Manifest. Diese Datei wird als TypeScript-AST gelesen und niemals ausgeführt.
 * Erlaubt ist genau dieses exportierte Objekt mit einfachen Literalwerten.
 */
export const reportManifest = {
  version: 1,
  kind: ${escapeTsString(manifest.kind)},
  documentName: ${escapeTsString(manifest.documentName)},
  title: ${escapeTsString(manifest.title)},
  imageBrief: ${escapeTsString(manifest.imageBrief)},
  editorialAlt: ${escapeTsString(manifest.editorialAlt)},
  images: ${JSON.stringify(manifest.images, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n")},
} as const;
`;
}

function newspaperHtml(documentName: string, pages: NewspaperPageTemplate[]) {
  const safeName = escapeHtml(documentName);
  const pageMarkup = pages
    .map(
      (page, index) => `<page slug="${escapeHtml(page.slug)}" title="${escapeHtml(page.title)}">
  <article class="news-layout ${index % 2 ? "news-layout--sidebar" : "news-layout--columns"}">
    <header class="news-wide">
      <span class="news-kicker">${escapeHtml(page.title)}</span>
      <h1>${index === 0 ? "Die Entscheidung im Detail" : `${escapeHtml(page.title)}: die belastbaren Befunde`}</h1>
      <p class="news-summary">Diesen Vorspann anhand des finalen Council-Ergebnisses präzisieren.</p>
    </header>
    <section class="news-block">
      <h2>Kernaussage</h2>
      <p>Den wichtigsten belegten Befund dieses Ressorts mit konkretem Nachweis einsetzen.</p>
    </section>
    <aside class="news-card">
      <span class="news-kicker">Was jetzt zählt</span>
      <ol class="news-list">
        <li>Konkrete Maßnahme mit Verantwortlichem ergänzen.</li>
        <li>Prüfbaren Abschlussnachweis benennen.</li>
      </ol>
    </aside>
    <blockquote class="news-pullquote">Eine kurze, belegte Aussage aus dem Council-Ergebnis einsetzen.</blockquote>
  </article>
</page>`,
    )
    .join("\n\n");

  return `<newspaper>
<front>
  <article class="news-layout news-layout--lead">
    <div class="news-ribbon">QA COUNCIL · SONDERAUSGABE</div>
    <header class="news-hero">
      <span class="news-breaking">EXKLUSIV</span>
      <h1 class="news-hero__headline">${safeName}: Was der Qualitätsrat jetzt fordert</h1>
      <p class="news-hero__deck">Die entscheidenden Risiken, Gegenpositionen und nächsten Schritte auf einen Blick.</p>
    </header>
    <figure class="news-wide">
      {{EDITORIAL_IMAGE}}
      <figcaption class="news-byline">Dokumentbezogenes Editorialmotiv · QA Council</figcaption>
    </figure>
    <section class="news-layout news-layout--split">
      <article class="news-block">
        <span class="news-kicker">Die Lage</span>
        <h2>Die wichtigste Entscheidung gehört hierher</h2>
        <p class="news-summary">Finale Synthese verdichten: Entscheidung, Begründung und verbleibendes Risiko.</p>
      </article>
      <aside class="news-priority">
        <span class="news-breaking">TOP-PRIORITÄT</span>
        <strong>Die dringendste belegte Maßnahme einsetzen</strong>
        <p>Owner, Frist und Abnahmekriterium konkret benennen.</p>
      </aside>
    </section>
    <nav class="news-teaser-grid" aria-label="Ressorts">
      ${pages
        .slice(0, 4)
        .map(
          (page) => `<a class="news-teaser" href="__RESULT_BASE__/${escapeHtml(page.slug)}">
        <span class="news-kicker">${escapeHtml(page.title)}</span>
        <strong>Die stärkste Aussage dieses Ressorts einsetzen</strong>
      </a>`,
        )
        .join("\n      ")}
    </nav>
  </article>
</front>

${pageMarkup}
</newspaper>
`;
}

const NEWSPAPER_CSS = `:root {
  --news-red: #e30613;
  --news-red-dark: #a90009;
  --news-ink: #11100f;
  --news-paper: #fffdf8;
  --news-rule: #d7d0c4;
  --news-muted: #655f58;
}

.result--newspaper {
  background: var(--news-paper);
  color: var(--news-ink);
  font-family: Georgia, "Times New Roman", serif;
}

.news-layout {
  display: grid;
  gap: clamp(1rem, 2.5vw, 2.25rem);
  min-width: 0;
}

.news-layout--lead { grid-template-columns: minmax(0, 1fr); }
.news-layout--split { grid-template-columns: minmax(0, 1.65fr) minmax(15rem, 0.7fr); }
.news-layout--columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.news-layout--sidebar { grid-template-columns: minmax(0, 1fr) minmax(15rem, 0.42fr); }
.news-wide { grid-column: 1 / -1; }

.news-ribbon {
  background: var(--news-red);
  color: white;
  font: 900 0.78rem/1.1 Arial, sans-serif;
  letter-spacing: 0.12em;
  padding: 0.65rem 0.85rem;
  text-transform: uppercase;
}

.news-hero {
  border-bottom: 5px solid var(--news-ink);
  padding: clamp(1rem, 3vw, 2.4rem) 0;
}

.news-breaking,
.news-kicker {
  color: var(--news-red);
  font: 900 0.76rem/1.2 Arial, sans-serif;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.news-hero__headline {
  font-size: clamp(2.6rem, 7.5vw, 7rem);
  letter-spacing: -0.065em;
  line-height: 0.86;
  margin: 0.35rem 0 0.85rem;
  max-width: 15ch;
  overflow-wrap: anywhere;
}

.news-hero__deck,
.news-summary {
  color: var(--news-muted);
  font-size: clamp(1.08rem, 2vw, 1.45rem);
  line-height: 1.42;
  margin: 0;
  max-width: 62ch;
}

.news-block,
.news-card,
.news-priority {
  border-top: 3px solid var(--news-ink);
  padding-top: 0.9rem;
}

.news-block h1,
.news-block h2,
.news-card h2 {
  font-size: clamp(1.75rem, 4vw, 3.4rem);
  letter-spacing: -0.035em;
  line-height: 0.98;
  margin: 0.35rem 0 0.8rem;
}

.news-card,
.news-priority {
  background: #f1ede5;
  padding: 1rem;
}

.news-priority {
  background: var(--news-red);
  border-color: var(--news-red-dark);
  color: white;
}

.news-priority .news-breaking { color: white; }
.news-priority strong { display: block; font-size: 1.65rem; line-height: 1; margin-top: 0.6rem; }

.news-pullquote {
  border-left: 0.45rem solid var(--news-red);
  font-size: clamp(1.4rem, 3vw, 2.5rem);
  font-weight: 700;
  grid-column: 1 / -1;
  line-height: 1.08;
  margin: 0;
  padding: 0.35rem 0 0.35rem 1.1rem;
}

.news-list { padding-left: 1.25rem; }
.news-list li + li { margin-top: 0.7rem; }

.news-teaser-grid {
  border-top: 1px solid var(--news-rule);
  display: grid;
  gap: 1px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.news-teaser {
  border-right: 1px solid var(--news-rule);
  color: inherit;
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
  text-decoration: none;
}

.news-teaser strong { font-size: 1.15rem; line-height: 1.08; }
.news-byline { color: var(--news-muted); font: 0.75rem/1.4 Arial, sans-serif; }

@media (max-width: 760px) {
  .news-layout--split,
  .news-layout--columns,
  .news-layout--sidebar { grid-template-columns: minmax(0, 1fr); }
  .news-teaser-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .news-hero__headline { font-size: clamp(2.4rem, 15vw, 4.8rem); }
}

@media print {
  .result--newspaper { background: white; }
  .news-teaser { break-inside: avoid; }
}
`;

function visualReportHtml(documentName: string) {
  return `<onepaper>
<section class="onepaper-sheet visual-report">
  <header class="onepaper-title visual-hero">
    <span class="onepaper-kicker">QA COUNCIL · DECISION BRIEF</span>
    <strong>${escapeHtml(documentName)}</strong>
    <p>Ein visuelles Lagebild aus finaler Synthese, Fachreviews und Gegenpositionen.</p>
  </header>

  <main class="onepaper-content">
    <section class="visual-section visual-grid visual-grid--wide">
      <article class="onepaper-decision visual-panel visual-panel--dark">
        <span class="onepaper-kicker">Entscheidung</span>
        <h1>Die finale Council-Entscheidung prägnant einsetzen</h1>
        <p>Begründung, Bedingungen und verbleibendes Restrisiko in drei Sätzen verdichten.</p>
      </article>
      <figure class="visual-image">
        {{EDITORIAL_IMAGE}}
        <figcaption>Dokumentbezogenes Schlüsselmotiv</figcaption>
      </figure>
    </section>

    <section class="visual-section">
      <h2>Risikolage auf einen Blick</h2>
      <div class="visual-grid">
        <article class="visual-metric">
          <strong class="visual-metric__value">–</strong>
          <span class="visual-metric__label">belegte Blocker</span>
        </article>
        <article class="visual-metric">
          <strong class="visual-metric__value">–</strong>
          <span class="visual-metric__label">kritische Auflagen</span>
        </article>
        <article class="visual-metric">
          <strong class="visual-metric__value">–</strong>
          <span class="visual-metric__label">offene Nachweise</span>
        </article>
      </div>
      <div class="visual-chart" aria-label="Belegte Risikoverteilung">
        <label>Produktqualität <meter class="visual-chart__row" min="0" max="5" value="3">3 von 5</meter></label>
        <label>Betriebsrisiko <meter class="visual-chart__row" min="0" max="5" value="4">4 von 5</meter></label>
        <label>Nachweisreife <meter class="visual-chart__row" min="0" max="5" value="2">2 von 5</meter></label>
      </div>
    </section>

    <section class="visual-section visual-grid visual-grid--wide">
      <article class="visual-panel">
        <span class="onepaper-kicker">Nächste Schritte</span>
        <ol class="onepaper-actions visual-timeline">
          <li class="visual-timeline__step"><strong>01</strong><span>Dringendste Maßnahme mit Owner, Frist und Abnahmekriterium.</span></li>
          <li class="visual-timeline__step"><strong>02</strong><span>Zweiten priorisierten Schritt und dessen Nachweis ergänzen.</span></li>
          <li class="visual-timeline__step"><strong>03</strong><span>Entscheidungspunkt für den nächsten Council-Termin nennen.</span></li>
        </ol>
      </article>
      <aside class="visual-callout">
        <span class="onepaper-kicker">Gegenposition</span>
        <h2>Das stärkste Gegenargument sichtbar machen</h2>
        <p>Warum es nicht vollständig überzeugt und welche Unsicherheit dennoch bleibt.</p>
      </aside>
    </section>

    <section class="visual-section visual-evidence">
      <span class="onepaper-kicker">Nachweis</span>
      <h2>Die drei belastbarsten Belege</h2>
      <div class="visual-matrix">
        <article class="visual-matrix__item"><strong>Beleg 01</strong><span>Fundstelle und Aussage ergänzen.</span></article>
        <article class="visual-matrix__item"><strong>Beleg 02</strong><span>Fundstelle und Aussage ergänzen.</span></article>
        <article class="visual-matrix__item"><strong>Beleg 03</strong><span>Fundstelle und Aussage ergänzen.</span></article>
      </div>
    </section>

    <section class="visual-section visual-grid visual-grid--wide">
      <figure class="visual-image">
        {{REPORT_IMAGE_EVIDENCE}}
        <figcaption>Visuelle Evidenzkarte · aus den stärksten Fachreview-Nachweisen</figcaption>
      </figure>
      <figure class="visual-image">
        {{REPORT_IMAGE_ROADMAP}}
        <figcaption>Visuelle Umsetzungsroute · priorisierte nächste Schritte</figcaption>
      </figure>
    </section>
  </main>

  <footer class="onepaper-footer">
    <span>Entscheidungsgrundlage · vollständiges Council-Ergebnis im Anhang</span>
    <b>QA Council</b>
  </footer>
</section>
</onepaper>
`;
}

const VISUAL_REPORT_CSS = `:root {
  --visual-ink: #14221f;
  --visual-paper: #f6f1e7;
  --visual-lime: #c9ff3d;
  --visual-coral: #ff634f;
  --visual-line: #c7c0b3;
  --visual-muted: #626a65;
}

.onepaper-sheet.visual-report {
  background: var(--visual-paper);
  color: var(--visual-ink);
  font-family: "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
  margin: 0 auto;
  max-width: 1180px;
  min-width: 0;
}

.visual-hero {
  border-bottom: 1px solid var(--visual-line);
  display: grid;
  gap: 0.65rem;
  padding: clamp(1.5rem, 5vw, 4.5rem);
}

.visual-hero strong {
  font-size: clamp(2.4rem, 7vw, 6.4rem);
  letter-spacing: -0.065em;
  line-height: 0.88;
  overflow-wrap: anywhere;
}

.visual-hero p {
  color: var(--visual-muted);
  font: 1.1rem/1.45 Georgia, serif;
  margin: 0;
  max-width: 62ch;
}

.onepaper-kicker {
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.onepaper-content { display: grid; gap: 0; }
.visual-section { border-bottom: 1px solid var(--visual-line); padding: clamp(1.4rem, 4vw, 3.5rem); }
.visual-section > h2 { font-size: clamp(1.7rem, 3vw, 2.8rem); letter-spacing: -0.04em; margin: 0 0 1.4rem; }
.visual-grid { display: grid; gap: 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.visual-grid--wide { grid-template-columns: minmax(0, 1.55fr) minmax(16rem, 0.8fr); }

.visual-panel,
.visual-callout {
  border: 1px solid var(--visual-line);
  padding: clamp(1.2rem, 3vw, 2.2rem);
}

.visual-panel--dark { background: var(--visual-ink); color: white; }
.visual-panel h1 { font-size: clamp(2rem, 4.5vw, 4.6rem); letter-spacing: -0.06em; line-height: 0.9; margin: 1rem 0; }
.visual-callout { background: var(--visual-lime); border-color: var(--visual-ink); }
.visual-callout h2 { font-size: clamp(1.6rem, 3vw, 2.8rem); letter-spacing: -0.045em; line-height: 0.96; }

.visual-image {
  background: #ded8cc;
  display: grid;
  margin: 0;
  min-height: 20rem;
  place-items: stretch;
}

.visual-image img { height: 100%; object-fit: cover; width: 100%; }
.visual-image figcaption { align-self: end; font-size: 0.7rem; padding: 0.55rem; text-transform: uppercase; }

.visual-metric {
  border-top: 0.5rem solid var(--visual-coral);
  display: grid;
  gap: 0.25rem;
  padding-top: 0.7rem;
}

.visual-metric__value { font-size: clamp(3rem, 7vw, 6rem); letter-spacing: -0.08em; line-height: 0.85; }
.visual-metric__label { color: var(--visual-muted); font-size: 0.78rem; font-weight: 800; text-transform: uppercase; }

.visual-chart { display: grid; gap: 0.8rem; margin-top: 2rem; }
.visual-chart label { display: grid; font-size: 0.78rem; font-weight: 800; gap: 0.35rem; text-transform: uppercase; }
.visual-chart__row { accent-color: var(--visual-coral); height: 1.2rem; width: 100%; }

.visual-timeline { display: grid; gap: 0; list-style: none; margin: 1.2rem 0 0; padding: 0; }
.visual-timeline__step { border-top: 1px solid var(--visual-line); display: grid; gap: 1rem; grid-template-columns: 2.5rem 1fr; padding: 1rem 0; }
.visual-timeline__step strong { color: var(--visual-coral); }

.visual-matrix { display: grid; gap: 1px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.visual-matrix__item { background: white; display: grid; gap: 0.75rem; min-height: 9rem; padding: 1rem; }
.visual-matrix__item strong { font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; }
.visual-matrix__item span { font: 1.05rem/1.35 Georgia, serif; }

.onepaper-footer {
  align-items: center;
  background: var(--visual-ink);
  color: white;
  display: flex;
  font-size: 0.72rem;
  justify-content: space-between;
  letter-spacing: 0.08em;
  padding: 1rem clamp(1.4rem, 4vw, 3.5rem);
  text-transform: uppercase;
}

@media (max-width: 760px) {
  .visual-grid,
  .visual-grid--wide,
  .visual-matrix { grid-template-columns: minmax(0, 1fr); }
  .visual-image { min-height: 14rem; }
}

@media print {
  .onepaper-sheet.visual-report { background: white; }
  .visual-section,
  .visual-panel,
  .visual-callout,
  .visual-matrix__item { break-inside: avoid; }
}
`;

async function writeTrustedInitialFile(filePath: string, content: string) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function scaffoldReportWorkspace(options: {
  runId: string;
  documentName: string;
  newspaperPages?: NewspaperPageTemplate[];
}) {
  const pages = options.newspaperPages?.length
    ? options.newspaperPages.map((page) => ({ ...page, title: page.title.trim() }))
    : DEFAULT_NEWSPAPER_PAGES;
  for (const page of pages) assertPage(page);
  if (new Set(pages.map((page) => page.slug)).size !== pages.length) {
    throw new Error("Zeitungs-Slugs müssen im Report-Arbeitsbereich eindeutig sein.");
  }

  const root = reportWorkspacePath(options.runId);
  const newspaperRoot = path.join(root, "newspaper");
  const visualRoot = path.join(root, "visual-report");
  await mkdir(newspaperRoot, { recursive: true, mode: 0o700 });
  await mkdir(visualRoot, { recursive: true, mode: 0o700 });

  const commonBrief = `Erzeuge eine dokumentbezogene, textfreie Editorial-Illustration zu ${options.documentName}. Zeige das zentrale Qualitätsrisiko und die wichtigste Entscheidung als klare visuelle Metapher; keine Logos, keine Schrift, keine generische Büroaufnahme.`;
  await Promise.all([
    writeTrustedInitialFile(
      path.join(newspaperRoot, "index.html"),
      newspaperHtml(options.documentName, pages),
    ),
    writeTrustedInitialFile(path.join(newspaperRoot, "styles.css"), NEWSPAPER_CSS),
    writeTrustedInitialFile(
      path.join(newspaperRoot, "report.ts"),
      manifestSource({
        version: 1,
        kind: "newspaper",
        documentName: options.documentName,
        title: `QA-Tageszeitung · ${options.documentName}`,
        imageBrief: commonBrief,
        editorialAlt: `Editorial-Illustration zum QA-Bericht ${options.documentName}`,
        images: [
          {
            slot: "editorial",
            hook: "{{EDITORIAL_IMAGE}}",
            brief: commonBrief,
            alt: `Editorial-Illustration zum QA-Bericht ${options.documentName}`,
          },
        ],
      }),
    ),
    writeTrustedInitialFile(
      path.join(visualRoot, "index.html"),
      visualReportHtml(options.documentName),
    ),
    writeTrustedInitialFile(path.join(visualRoot, "styles.css"), VISUAL_REPORT_CSS),
    writeTrustedInitialFile(
      path.join(visualRoot, "report.ts"),
      manifestSource({
        version: 1,
        kind: "visual-report",
        documentName: options.documentName,
        title: `Visual Report · ${options.documentName}`,
        imageBrief: `${commonBrief} Komponiere das Motiv für einen hochwertigen, informationsdichten Entscheidungsreport mit Platz für Infografiken.`,
        editorialAlt: `Schlüsselmotiv des visuellen QA-Reports ${options.documentName}`,
        images: [
          {
            slot: "editorial",
            hook: "{{EDITORIAL_IMAGE}}",
            brief: `${commonBrief} Komponiere das Motiv als starkes horizontales Schlüsselbild für einen hochwertigen Entscheidungsreport.`,
            alt: `Schlüsselmotiv des visuellen QA-Reports ${options.documentName}`,
          },
          {
            slot: "evidence",
            hook: "{{REPORT_IMAGE_EVIDENCE}}",
            brief: `Erzeuge eine textfreie redaktionelle Infografik zu den stärksten belegten Befunden aus ${options.documentName}. Nutze klare räumliche Gruppierung und konkrete visuelle Metaphern statt dekorativer Abstraktion.`,
            alt: `Visuelle Evidenzkarte der wichtigsten Befunde aus ${options.documentName}`,
          },
          {
            slot: "roadmap",
            hook: "{{REPORT_IMAGE_ROADMAP}}",
            brief: `Erzeuge eine textfreie visuelle Roadmap zu den priorisierten nächsten Schritten für ${options.documentName}. Zeige Abhängigkeiten, Kontrollpunkte und Zielzustand als klar lesbare Illustration ohne Schrift.`,
            alt: `Visuelle Umsetzungsroute für ${options.documentName}`,
          },
        ],
      }),
    ),
  ]);

  return readReportWorkspace(options.runId);
}

async function readWorkspaceFile(root: string, name: (typeof WORKSPACE_FILES)[number]) {
  const filePath = path.join(root, name);
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Unsichere Report-Datei abgelehnt: ${name}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Report-Datei ist zu groß: ${name}`);
  }
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(filePath);
  if (path.dirname(canonicalFile) !== canonicalRoot) {
    throw new Error(`Report-Datei liegt außerhalb des Arbeitsbereichs: ${name}`);
  }
  return readFile(canonicalFile, "utf8");
}

export async function readReportWorkspace(runId: string): Promise<ReportWorkspaceFiles> {
  const root = reportWorkspacePath(runId);
  const newspaperRoot = path.join(root, "newspaper");
  const visualRoot = path.join(root, "visual-report");
  const [newspaperHtml, newspaperCss, newspaperManifest, visualHtml, visualCss, visualManifest] =
    await Promise.all([
      readWorkspaceFile(newspaperRoot, "index.html"),
      readWorkspaceFile(newspaperRoot, "styles.css"),
      readWorkspaceFile(newspaperRoot, "report.ts"),
      readWorkspaceFile(visualRoot, "index.html"),
      readWorkspaceFile(visualRoot, "styles.css"),
      readWorkspaceFile(visualRoot, "report.ts"),
    ]);
  return {
    root,
    newspaper: {
      root: newspaperRoot,
      html: newspaperHtml,
      css: newspaperCss,
      manifest: newspaperManifest,
    },
    visualReport: {
      root: visualRoot,
      html: visualHtml,
      css: visualCss,
      manifest: visualManifest,
    },
  };
}

function unwrapLiteralExpression(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return unwrapLiteralExpression(node.expression);
  }
  if (ts.isParenthesizedExpression(node)) return unwrapLiteralExpression(node.expression);
  return node;
}

function literalValue(node: ts.Expression): unknown {
  node = unwrapLiteralExpression(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((element) => literalValue(element));
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      ) {
        throw new Error(
          "Das Manifest darf nur einfache, nicht berechnete Eigenschaften enthalten.",
        );
      }
      const key = property.name.text;
      if (Object.hasOwn(value, key)) throw new Error(`Doppelte Manifest-Eigenschaft: ${key}`);
      value[key] = literalValue(property.initializer);
    }
    return value;
  }
  throw new Error(`Nicht erlaubter Ausdruck im Manifest: ${ts.SyntaxKind[node.kind]}`);
}

export function parseReportManifest(
  source: string,
  expectedKind?: ReportWorkspaceKind,
): ReportManifest {
  const sourceFile = ts.createSourceFile(
    "report.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;
  if (parseDiagnostics?.length) {
    throw new Error(
      `TypeScript-Syntaxfehler: ${ts.flattenDiagnosticMessageText(parseDiagnostics[0].messageText, "\n")}`,
    );
  }
  if (sourceFile.statements.length !== 1) {
    throw new Error("report.ts darf genau eine exportierte const-Deklaration enthalten.");
  }
  const statement = sourceFile.statements[0];
  if (
    !ts.isVariableStatement(statement) ||
    !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
    !(statement.declarationList.flags & ts.NodeFlags.Const) ||
    statement.declarationList.declarations.length !== 1
  ) {
    throw new Error("report.ts muss genau `export const reportManifest = …` enthalten.");
  }
  const declaration = statement.declarationList.declarations[0];
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "reportManifest" ||
    !declaration.initializer
  ) {
    throw new Error("Das exportierte Literal muss `reportManifest` heißen.");
  }
  const value = literalValue(declaration.initializer);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("reportManifest muss ein Objektliteral sein.");
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "version",
    "kind",
    "documentName",
    "title",
    "imageBrief",
    "editorialAlt",
    "images",
  ]);
  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length)
    throw new Error(`Unbekannte Manifest-Eigenschaften: ${unknownKeys.join(", ")}`);
  const strings = ["kind", "documentName", "title", "imageBrief", "editorialAlt"] as const;
  for (const key of strings) {
    if (typeof record[key] !== "string" || !(record[key] as string).trim()) {
      throw new Error(`Manifest-Eigenschaft "${key}" muss eine nicht leere Zeichenkette sein.`);
    }
  }
  if (record.version !== 1) throw new Error("Manifest-Version muss 1 sein.");
  if (record.kind !== "newspaper" && record.kind !== "visual-report") {
    throw new Error("Manifest-kind muss newspaper oder visual-report sein.");
  }
  if (expectedKind && record.kind !== expectedKind) {
    throw new Error(`Manifest-kind muss "${expectedKind}" sein.`);
  }
  for (const key of ["documentName", "title", "editorialAlt"] as const) {
    if ((record[key] as string).length > 300)
      throw new Error(`Manifest-Eigenschaft "${key}" ist zu lang.`);
  }
  if ((record.imageBrief as string).length > 4_000) {
    throw new Error('Manifest-Eigenschaft "imageBrief" ist zu lang.');
  }
  if (!Array.isArray(record.images) || record.images.length < 1 || record.images.length > 6) {
    throw new Error('Manifest-Eigenschaft "images" muss ein Array mit 1 bis 6 Bild-Slots sein.');
  }
  const seenSlots = new Set<string>();
  const seenHooks = new Set<string>();
  for (const candidate of record.images) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Jeder Bild-Slot muss ein Objektliteral sein.");
    }
    const image = candidate as Record<string, unknown>;
    const keys = Object.keys(image);
    if (keys.length !== 4 || !["slot", "hook", "brief", "alt"].every((key) => keys.includes(key))) {
      throw new Error("Jeder Bild-Slot braucht genau slot, hook, brief und alt.");
    }
    for (const key of ["slot", "hook", "brief", "alt"]) {
      if (typeof image[key] !== "string" || !(image[key] as string).trim()) {
        throw new Error(`Bild-Slot-Eigenschaft "${key}" muss eine nicht leere Zeichenkette sein.`);
      }
    }
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(image.slot as string)) {
      throw new Error(`Ungültiger Bild-Slot: ${image.slot as string}`);
    }
    if (!/^\{\{(?:EDITORIAL_IMAGE|REPORT_IMAGE_[A-Z0-9_]+)\}\}$/.test(image.hook as string)) {
      throw new Error(`Ungültiger Bild-Hook: ${image.hook as string}`);
    }
    if ((image.brief as string).length > 4_000 || (image.alt as string).length > 300) {
      throw new Error(`Bild-Slot "${image.slot as string}" enthält zu lange Texte.`);
    }
    if (seenSlots.has(image.slot as string) || seenHooks.has(image.hook as string)) {
      throw new Error("Bild-Slots und Bild-Hooks müssen eindeutig sein.");
    }
    seenSlots.add(image.slot as string);
    seenHooks.add(image.hook as string);
  }
  if (
    !record.images.some(
      (candidate) => (candidate as Record<string, unknown>).hook === "{{EDITORIAL_IMAGE}}",
    )
  ) {
    throw new Error("Jedes Manifest braucht den primären {{EDITORIAL_IMAGE}}-Bild-Slot.");
  }
  return record as unknown as ReportManifest;
}

function scanBalancedHtml(source: string, label: string, findings: string[]) {
  const stack: string[] = [];
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!--|-->/.test(withoutComments))
    findings.push(`HTML · ${label}: unvollständiger Kommentar.`);
  for (const match of withoutComments.matchAll(/<\/?([a-z][\w-]*)(?:\s[^<>]*?)?\/?>/gi)) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (FORBIDDEN_TAGS.has(tag))
      findings.push(`HTML/Sicherheit · ${label}: <${tag}> ist nicht erlaubt.`);
    if (VOID_TAGS.has(tag) || /\/>$/.test(full)) continue;
    if (!full.startsWith("</")) {
      stack.push(tag);
      continue;
    }
    const expected = stack.pop();
    if (expected !== tag) {
      findings.push(
        `HTML · ${label}: </${tag}> schließt ${expected ? `<${expected}>` : "kein Element"}.`,
      );
      return;
    }
  }
  if (stack.length)
    findings.push(`HTML · ${label}: nicht geschlossene Elemente: ${stack.join(", ")}.`);
}

function validateHtmlSafety(source: string, label: string) {
  const findings: string[] = [];
  if (source.length > MAX_FILE_BYTES) findings.push(`HTML · ${label}: Datei ist zu groß.`);
  if (/<!doctype|<html\b|<head\b|<body\b/i.test(source)) {
    findings.push(
      `HTML · ${label}: nur das Report-Fragment, kein vollständiges HTML-Dokument, ist erlaubt.`,
    );
  }
  if (/<\?xml|<!entity|<!\[cdata/i.test(source)) {
    findings.push(`HTML/Sicherheit · ${label}: XML- und Entity-Deklarationen sind nicht erlaubt.`);
  }
  if (/\son[a-z][\w-]*\s*=/i.test(source)) {
    findings.push(`HTML/Sicherheit · ${label}: Event-Handler-Attribute sind nicht erlaubt.`);
  }
  if (/\sstyle\s*=/i.test(source))
    findings.push(`HTML/CSS · ${label}: Inline-Styles sind nicht erlaubt.`);
  if (
    /\b(?:href|src|poster|action|formaction)\s*=\s*["']\s*(?:javascript|data|vbscript):/i.test(
      source,
    )
  ) {
    findings.push(`HTML/Sicherheit · ${label}: aktive oder eingebettete URLs sind nicht erlaubt.`);
  }
  if (/\b(?:src|poster|action|formaction|srcdoc)\s*=/i.test(source)) {
    findings.push(
      `HTML/Sicherheit · ${label}: externe Ressourcen und eingebettete Dokumente sind nicht erlaubt.`,
    );
  }
  for (const match of source.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (
      !match[1].startsWith("__RESULT_BASE__") &&
      !match[1].startsWith("#") &&
      !/^https:\/\/[a-z0-9.-]+(?:[/:?#]|$)/i.test(match[1])
    ) {
      findings.push(`HTML/Sicherheit · ${label}: nicht erlaubtes Linkziel "${match[1]}".`);
    }
  }
  for (const match of source.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^[-_a-zA-Z0-9:\s]+$/.test(match[1])) {
      findings.push(`HTML/CSS · ${label}: ungültiger Klassenwert.`);
    }
  }
  const templatePlaceholders = [
    "Diesen Vorspann anhand des finalen Council-Ergebnisses präzisieren.",
    "Den wichtigsten belegten Befund dieses Ressorts",
    "Konkrete Maßnahme mit Verantwortlichem ergänzen.",
    "Die wichtigste Entscheidung gehört hierher",
    "Die dringendste belegte Maßnahme einsetzen",
    "Die stärkste Aussage dieses Ressorts einsetzen",
  ];
  for (const placeholder of templatePlaceholders) {
    if (source.includes(placeholder)) {
      findings.push(`Inhalt · ${label}: unbearbeiteter Template-Platzhalter „${placeholder}“.`);
    }
  }
  scanBalancedHtml(source, label, findings);
  return [...new Set(findings)];
}

export function validateReportCss(source: string, label = "Report") {
  const findings: string[] = [];
  if (source.length > MAX_FILE_BYTES) findings.push(`CSS · ${label}: Datei ist zu groß.`);
  const prohibited: Array<[RegExp, string]> = [
    [/@import\b/i, "@import"],
    [/@charset\b/i, "@charset"],
    [/@font-face\b/i, "@font-face"],
    [/\burl\s*\(/i, "url()"],
    [/\bexpression\s*\(/i, "expression()"],
    [/\b(?:javascript|vbscript)\s*:/i, "aktive URL"],
    [/\bbehavior\s*:/i, "behavior"],
    [/-moz-binding\s*:/i, "-moz-binding"],
    [/<\/?style\b/i, "HTML-Style-Tag"],
  ];
  for (const [pattern, name] of prohibited) {
    if (pattern.test(source))
      findings.push(`CSS/Sicherheit · ${label}: ${name} ist nicht erlaubt.`);
  }
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/\/\*|\*\//.test(stripped)) findings.push(`CSS · ${label}: unvollständiger Kommentar.`);
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of stripped) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0 || quote)
    findings.push(`CSS · ${label}: Klammern oder Zeichenketten sind nicht ausgeglichen.`);
  if (!/[.#][-_a-zA-Z][-_a-zA-Z0-9]*/.test(stripped)) {
    findings.push(`CSS · ${label}: keine gestalteten Selektoren gefunden.`);
  }
  try {
    parseCss(source, { context: "stylesheet", positions: true });
  } catch (error) {
    findings.push(
      `CSS · ${label}: Parserfehler: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return [...new Set(findings)];
}

export function scopeReportCss(source: string, rootSelector: string) {
  const findings = validateReportCss(source);
  if (findings.length) throw new Error(findings.join("\n"));
  if (!/^\.[-_a-zA-Z][-_a-zA-Z0-9]*$/.test(rootSelector)) {
    throw new Error("Ungültiger CSS-Scope für den Report.");
  }
  return `@scope (${rootSelector}) {
${source.replaceAll(":root", ":scope")}
}`;
}

function transportContent(source: string, tag: string) {
  return source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
}

function pageSlugs(source: string) {
  return [...source.matchAll(/<page\s+([^>]+)>[\s\S]*?<\/page>/gi)].map(
    (match) => match[1].match(/\bslug\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? "",
  );
}

export function validateReportWorkspaceFiles(
  files: ReportWorkspaceFiles,
  expectedPageSlugs?: string[],
): ReportWorkspaceValidation {
  const findings = [
    ...validateHtmlSafety(files.newspaper.html, "Zeitung"),
    ...validateHtmlSafety(files.visualReport.html, "Visual Report"),
    ...validateReportCss(files.newspaper.css, "Zeitung"),
    ...validateReportCss(files.visualReport.css, "Visual Report"),
  ];
  const manifests: ReportWorkspaceValidation["manifests"] = {};
  for (const [kind, source] of [
    ["newspaper", files.newspaper.manifest],
    ["visual-report", files.visualReport.manifest],
  ] as const) {
    try {
      const manifest = parseReportManifest(source, kind);
      if (kind === "newspaper") manifests.newspaper = manifest;
      else manifests.visualReport = manifest;
    } catch (error) {
      findings.push(
        `TypeScript/Manifest · ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const [kind, source, manifest] of [
    ["newspaper", files.newspaper.html, manifests.newspaper],
    ["visual-report", files.visualReport.html, manifests.visualReport],
  ] as const) {
    if (!manifest) continue;
    for (const image of manifest.images) {
      const count = source.split(image.hook).length - 1;
      if (count !== 1) {
        findings.push(
          `Struktur · Bild-Hook ${image.hook} für ${kind} muss genau einmal vorkommen, gefunden: ${count}.`,
        );
      }
    }
    const knownHooks = new Set(manifest.images.map((image) => image.hook));
    for (const match of source.matchAll(/\{\{(?:EDITORIAL_IMAGE|REPORT_IMAGE_[A-Z0-9_]+)\}\}/g)) {
      if (!knownHooks.has(match[0])) {
        findings.push(`Struktur · Unbekannter Bild-Hook ${match[0]} in ${kind}.`);
      }
    }
  }

  if (!/^\s*<newspaper>[\s\S]*<\/newspaper>\s*$/i.test(files.newspaper.html)) {
    findings.push("Struktur · newspaper/index.html braucht genau eine <newspaper>-Außenhülle.");
  }
  const front = transportContent(files.newspaper.html, "front");
  if (!front.trim())
    findings.push("Struktur · Der Zeitung fehlt eine nicht leere <front>-Titelseite.");
  const newspaperImageHooks = (front.match(/\{\{EDITORIAL_IMAGE\}\}/g) ?? []).length;
  if (newspaperImageHooks !== 1) {
    findings.push(
      `Struktur · Die Titelseite braucht genau einen {{EDITORIAL_IMAGE}}-Hook, gefunden: ${newspaperImageHooks}.`,
    );
  }
  const slugs = pageSlugs(files.newspaper.html);
  if (slugs.some((slug) => !/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug))) {
    findings.push("Struktur · Jede Zeitungsseite braucht einen gültigen slug.");
  }
  if (new Set(slugs).size !== slugs.length)
    findings.push("Struktur · Zeitungs-Slugs müssen eindeutig sein.");
  for (const slug of expectedPageSlugs ?? []) {
    if (slugs.filter((candidate) => candidate === slug).length !== 1) {
      findings.push(`Struktur · Zeitungsseite "${slug}" muss genau einmal vorkommen.`);
    }
  }
  for (const match of files.newspaper.html.matchAll(/<page\s+([^>]+)>[\s\S]*?<\/page>/gi)) {
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(match[1])) {
      findings.push("Struktur · Jede Zeitungsseite braucht einen nicht leeren title.");
    }
  }

  if (!/^\s*<onepaper>[\s\S]*<\/onepaper>\s*$/i.test(files.visualReport.html)) {
    findings.push("Struktur · visual-report/index.html braucht genau eine <onepaper>-Außenhülle.");
  }
  const onepaper = transportContent(files.visualReport.html, "onepaper");
  const visualImageHooks = (onepaper.match(/\{\{EDITORIAL_IMAGE\}\}/g) ?? []).length;
  if (visualImageHooks !== 1) {
    findings.push(
      `Struktur · Der Visual Report braucht genau einen {{EDITORIAL_IMAGE}}-Hook, gefunden: ${visualImageHooks}.`,
    );
  }
  for (const className of [
    "onepaper-sheet",
    "visual-report",
    "onepaper-title",
    "onepaper-content",
    "onepaper-footer",
  ]) {
    if (!new RegExp(`class\\s*=\\s*["'][^"']*\\b${className}\\b`, "i").test(onepaper)) {
      findings.push(`Struktur · Dem Visual Report fehlt die erforderliche Klasse "${className}".`);
    }
  }

  return { valid: findings.length === 0, findings: [...new Set(findings)], manifests };
}

export function reportWorkspaceSnapshot(files: ReportWorkspaceFiles) {
  return [
    "===== newspaper/index.html =====",
    files.newspaper.html,
    "===== newspaper/styles.css =====",
    files.newspaper.css,
    "===== newspaper/report.ts =====",
    files.newspaper.manifest,
    "===== visual-report/index.html =====",
    files.visualReport.html,
    "===== visual-report/styles.css =====",
    files.visualReport.css,
    "===== visual-report/report.ts =====",
    files.visualReport.manifest,
  ].join("\n\n");
}

export async function validateReportWorkspace(runId: string, expectedPageSlugs?: string[]) {
  const files = await readReportWorkspace(runId);
  return validateReportWorkspaceFiles(files, expectedPageSlugs);
}

export async function assembleReportWorkspace(options: {
  runId: string;
  expectedPageSlugs?: string[];
}): Promise<ReportWorkspaceAssembly> {
  const files = await readReportWorkspace(options.runId);
  const validation = validateReportWorkspaceFiles(files, options.expectedPageSlugs);
  if (!validation.valid || !validation.manifests.newspaper || !validation.manifests.visualReport) {
    throw new Error(`Report-Arbeitsbereich ist ungültig:\n${validation.findings.join("\n")}`);
  }
  const newspaper = files.newspaper.html.trim();
  const onepaper = transportContent(files.visualReport.html, "onepaper").trim();
  const reportPackage = `<report-package>
  <image-brief>${escapeHtml(validation.manifests.visualReport.imageBrief)}</image-brief>
  ${newspaper}
  <onepaper>
    ${onepaper}
  </onepaper>
</report-package>`;
  return {
    reportPackage,
    styles: {
      newspaper: files.newspaper.css,
      visualReport: files.visualReport.css,
    },
    imageSlots: [
      ...validation.manifests.newspaper.images.map((image) => ({
        ...image,
        kind: "newspaper" as const,
      })),
      ...validation.manifests.visualReport.images.map((image) => ({
        ...image,
        kind: "visual-report" as const,
      })),
    ],
    snapshot: reportWorkspaceSnapshot(files),
    validation,
  };
}
