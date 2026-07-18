import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  { slug: "gemeinsames-review", title: "Gemeinsames Review" },
  { slug: "debatte", title: "Debatte" },
  { slug: "council-runden", title: "Council-Runden" },
  { slug: "dissent-audit", title: "Dissent-Audit" },
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

export async function removeReportWorkspace(runId: string) {
  await rm(reportWorkspacePath(runId), { recursive: true, force: true });
}

export async function cleanupOrphanedReportWorkspaces() {
  const root = path.join(dataRoot(), "report-workspaces");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  await Promise.all(
    entries.map((entry) => rm(path.join(root, entry), { recursive: true, force: true })),
  );
  return entries.length;
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
    <header class="news-wide news-section-head">
      <span class="news-kicker">${escapeHtml(page.title)}</span>
      <h1>${index === 0 ? "Die Entscheidung im <em>Detail</em>" : `${escapeHtml(page.title)}: die belastbaren <em>Befunde</em>`}</h1>
      <p class="news-summary">Diesen Vorspann anhand des finalen Council-Ergebnisses präzisieren.</p>
    </header>
    <section class="news-block">
      <span class="news-kicker">Was trägt</span>
      <h2>Der belastbare Kern</h2>
      <p>Den wichtigsten belegten Befund dieses Ressorts mit konkretem Nachweis einsetzen.</p>
    </section>
    <aside class="news-card">
      <span class="news-kicker">Der Schlüsselbund</span>
      <h2>Was jetzt zählt</h2>
      <ol class="news-list">
        <li>Konkrete Maßnahme mit Verantwortlichem ergänzen.</li>
        <li>Prüfbaren Abschlussnachweis benennen.</li>
      </ol>
    </aside>
    <blockquote class="news-pullquote">
      <span>Eine kurze, belegte Aussage aus dem Council-Ergebnis einsetzen.</span>
    </blockquote>
  </article>
</page>`,
    )
    .join("\n\n");

  return `<newspaper>
<front>
  <article class="news-layout news-layout--lead">
    <header class="news-hero">
      <span class="news-kicker">Der Prüfplan</span>
      <h1 class="news-hero__headline">${safeName}: Was die Prüfung <em>jetzt</em> verlangt</h1>
      <p class="news-hero__deck">Entscheidung, Gegenpositionen und nächste Schritte — ruhig geordnet, vollständig belegt.</p>
      <a class="news-pass" href="__RESULT_BASE__/synthese">
        <span class="news-pass__clip" aria-hidden="true"></span>
        <span class="news-pass__eyebrow">Prüfzugang</span>
        <strong>Zur Entscheidung</strong>
        <small>QA Council · Nachweis inklusive</small>
      </a>
    </header>
    <figure class="news-wide news-feature">
      {{EDITORIAL_IMAGE}}
      <figcaption class="news-byline">Ihr Platz ist reserviert · dokumentbezogenes Editorialmotiv</figcaption>
    </figure>
    <section class="news-layout news-layout--split">
      <article class="news-block news-block--lead">
        <span class="news-kicker">Im Entscheidungsraum</span>
        <h2>Die wichtigste Entscheidung gehört hierher</h2>
        <p class="news-summary">Finale Synthese verdichten: Entscheidung, Begründung und verbleibendes Risiko.</p>
      </article>
      <aside class="news-card news-priority">
        <span class="news-kicker">Der nächste Schlüssel</span>
        <strong>Die dringendste belegte Maßnahme einsetzen</strong>
        <p>Owner, Frist und Abnahmekriterium konkret benennen.</p>
      </aside>
    </section>
    <blockquote class="news-pullquote news-wide">
      <span>Die Prüfung bleibt ruhig. Der Nachweis spricht.</span>
    </blockquote>
    <nav class="news-teaser-grid" aria-label="Ressorts">
      ${pages
        .slice(0, 4)
        .map(
          (page, index) => `<a class="news-teaser" href="__RESULT_BASE__/${escapeHtml(page.slug)}">
        <span class="news-teaser__number">${String(index + 1).padStart(2, "0")}</span>
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
  --news-pine: #1f362c;
  --news-billiard: #2c4a3c;
  --news-cream: #f2e9d8;
  --news-brass: #c69a58;
  --news-ember: #d9704f;
  --news-muted: #cfc4af;
  --news-shadow: rgba(9, 21, 16, 0.34);
}

.result--newspaper {
  min-height: 100%;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background:
    radial-gradient(circle at 28% -4%, rgba(198, 154, 88, 0.22), transparent 34rem),
    var(--news-pine);
  color: var(--news-cream);
  font-family: "Trebuchet MS", "Segoe UI", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.68;
}

.result--newspaper::before {
  content: "";
  position: absolute;
  z-index: 0;
  top: -18rem;
  left: -12rem;
  width: min(78rem, 118vw);
  height: 58rem;
  pointer-events: none;
  opacity: 0.85;
  background: radial-gradient(circle, rgba(198, 154, 88, 0.24), transparent 67%);
  animation: news-lights 1.2s ease-out both;
}

.result--newspaper::after {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0;
  pointer-events: none;
  opacity: 0.16;
  background:
    repeating-linear-gradient(97deg, rgba(242, 233, 216, 0.025) 0 1px, transparent 1px 5px),
    repeating-linear-gradient(7deg, transparent 0 3px, rgba(10, 24, 18, 0.08) 3px 4px);
}

.result--newspaper > * {
  position: relative;
  z-index: 1;
}

.result--newspaper h1,
.result--newspaper h2,
.result--newspaper h3,
.result--newspaper strong {
  color: var(--news-cream);
  font-family: Georgia, "Times New Roman", serif;
}

.result--newspaper h1 em,
.result--newspaper h2 em {
  color: var(--news-brass);
  font-weight: inherit;
}

.result--newspaper a {
  color: inherit;
}

.newspaper-masthead {
  min-height: auto;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: baseline;
  gap: 1.5rem;
  padding: 1.7rem clamp(1.25rem, 4vw, 3.75rem) 1rem;
  border: 0;
  border-bottom: 1px solid rgba(198, 154, 88, 0.68);
  background: transparent;
}

.newspaper-masthead a {
  justify-self: start;
  color: var(--news-cream);
  font: 400 clamp(1.35rem, 3vw, 2rem) / 1 Georgia, "Times New Roman", serif;
  letter-spacing: -0.025em;
  text-decoration: none;
  text-transform: none;
}

.newspaper-masthead span,
.newspaper-masthead time {
  padding: 0;
  color: var(--news-brass);
  font: italic 0.76rem/1.35 Georgia, "Times New Roman", serif;
  letter-spacing: 0.025em;
  text-transform: none;
}

.newspaper-masthead time {
  justify-self: end;
}

.newspaper-nav {
  min-height: 3rem;
  display: flex;
  align-items: center;
  gap: 1.6rem;
  overflow-x: auto;
  padding: 0 clamp(1.25rem, 4vw, 3.75rem);
  border-bottom: 1px solid rgba(198, 154, 88, 0.22);
  background: rgba(31, 54, 44, 0.72);
  scrollbar-color: var(--news-brass) transparent;
}

.newspaper-nav a {
  min-height: 3rem;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  color: var(--news-muted);
  font-size: 0.78rem;
  font-weight: 500;
  text-decoration: none;
  text-transform: none;
}

.newspaper-nav a:hover,
.newspaper-nav a:focus-visible,
.newspaper-nav a.active {
  color: var(--news-cream);
  box-shadow: inset 0 -1px var(--news-brass);
}

.newspaper-context {
  overflow: hidden;
  padding: 0.7rem clamp(1.25rem, 4vw, 3.75rem);
  border-bottom: 1px solid rgba(198, 154, 88, 0.16);
  background: rgba(44, 74, 60, 0.42);
  color: var(--news-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.news-layout {
  display: grid;
  gap: clamp(2.5rem, 6vw, 6.5rem);
  min-width: 0;
  padding: clamp(3.5rem, 8vw, 8rem) clamp(1.25rem, 7vw, 7rem);
  animation: news-rise 700ms ease-out both;
}

.news-layout > * {
  animation: news-rise 650ms ease-out both;
}

.news-layout > :nth-child(2) { animation-delay: 90ms; }
.news-layout > :nth-child(3) { animation-delay: 170ms; }
.news-layout > :nth-child(4) { animation-delay: 250ms; }
.news-layout > :nth-child(5) { animation-delay: 330ms; }

.news-layout--lead { grid-template-columns: minmax(0, 1fr); }
.news-layout--lead { padding-top: clamp(4.5rem, 10vw, 10rem); }
.news-layout--split {
  grid-template-columns: minmax(0, 1.55fr) minmax(16rem, 0.7fr);
  padding: 0;
}
.news-layout--columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.news-layout--sidebar { grid-template-columns: minmax(0, 1fr) minmax(15rem, 0.42fr); }
.news-wide { grid-column: 1 / -1; }

.news-hero {
  max-width: 72rem;
  padding-bottom: clamp(1rem, 3vw, 3rem);
}

.news-breaking,
.news-kicker {
  color: var(--news-brass);
  font: italic 0.88rem/1.35 Georgia, "Times New Roman", serif;
  letter-spacing: 0.01em;
  text-transform: none;
}

.news-hero__headline {
  max-width: 16ch;
  margin: 0.8rem 0 1.4rem;
  font-size: clamp(3rem, 7.5vw, 7.25rem);
  font-weight: 400;
  letter-spacing: -0.045em;
  line-height: 0.95;
  overflow-wrap: break-word;
}

.news-hero__deck,
.news-summary {
  color: var(--news-muted);
  font-size: clamp(1.05rem, 2vw, 1.35rem);
  line-height: 1.58;
  margin: 0;
  max-width: 62ch;
}

.news-pass {
  width: min(16.5rem, calc(100% - 2rem));
  position: relative;
  display: grid;
  gap: 0.15rem;
  margin: 5rem 0 0 2.25rem;
  padding: 2.2rem 1.35rem 1.2rem;
  border: 1px solid var(--news-brass);
  border-radius: 0.65rem;
  background: var(--news-cream);
  box-shadow: 0 1.1rem 2.2rem var(--news-shadow);
  color: var(--news-pine);
  text-decoration: none;
  transform-origin: 50% -3.5rem;
  animation: news-pass-sway 6s ease-in-out 900ms infinite;
}

.news-pass::before {
  content: "";
  width: 0.38rem;
  height: 4.8rem;
  position: absolute;
  left: 50%;
  bottom: calc(100% + 0.55rem);
  border-radius: 1rem;
  background: var(--news-ember);
  transform: translateX(-50%);
}

.news-pass::after {
  content: "";
  position: absolute;
  right: 1.25rem;
  bottom: 1rem;
  left: 1.25rem;
  border-bottom: 1px dashed rgba(31, 54, 44, 0.34);
}

.news-pass__clip {
  width: 2rem;
  height: 1.1rem;
  position: absolute;
  top: -0.62rem;
  left: 50%;
  border: 2px solid var(--news-brass);
  border-radius: 0.5rem;
  background: var(--news-pine);
  transform: translateX(-50%);
}

.news-pass__eyebrow {
  color: var(--news-brass);
  font: italic 0.76rem/1.2 Georgia, "Times New Roman", serif;
}

.news-pass strong {
  color: var(--news-pine);
  font-size: 1.5rem;
  font-weight: 400;
}

.news-pass small {
  padding-bottom: 0.8rem;
  color: #52685e;
  font-size: 0.68rem;
}

.news-pass:hover,
.news-pass:focus-visible {
  outline: 2px solid var(--news-brass);
  outline-offset: 0.35rem;
}

.news-section-head {
  max-width: 64rem;
  padding-bottom: clamp(1rem, 3vw, 2.5rem);
  border-bottom: 1px solid rgba(198, 154, 88, 0.46);
}

.news-section-head h1 {
  max-width: 18ch;
  margin: 0.65rem 0 1.1rem;
  font-size: clamp(2.7rem, 6vw, 5.7rem);
  font-weight: 400;
  letter-spacing: -0.04em;
  line-height: 1;
}

.news-block,
.news-card,
.news-priority {
  min-width: 0;
}

.news-block h1,
.news-block h2,
.news-card h2 {
  margin: 0.5rem 0 1rem;
  font-size: clamp(1.8rem, 4vw, 3.25rem);
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1.04;
}

.news-card,
.news-priority {
  padding: clamp(1.5rem, 4vw, 2.5rem);
  border: 1px solid rgba(198, 154, 88, 0.7);
  border-radius: 1.1rem;
  background: var(--news-billiard);
  box-shadow: 0 1.1rem 2.8rem var(--news-shadow);
}

.news-priority {
  align-self: start;
  color: var(--news-muted);
}

.news-priority strong {
  display: block;
  margin-top: 0.8rem;
  font-size: 1.7rem;
  font-weight: 400;
  line-height: 1.12;
}

.news-pullquote {
  position: relative;
  grid-column: 1 / -1;
  max-width: 47rem;
  margin: 0 auto;
  padding: 0;
  border: 0;
  color: var(--news-cream);
  font: italic 400 clamp(1.55rem, 3vw, 2.65rem) / 1.28 Georgia, "Times New Roman", serif;
  text-align: center;
}

.news-pullquote::before {
  content: "“";
  display: block;
  height: 2rem;
  color: var(--news-brass);
  font-size: 4rem;
  line-height: 1;
}

.news-list {
  display: grid;
  gap: 1.5rem;
  margin: 1.5rem 0 0;
  padding: 0;
  list-style: none;
  counter-reset: key-step;
}

.news-list li {
  display: grid;
  grid-template-columns: 3.75rem 1fr;
  gap: 1rem;
  align-items: start;
  counter-increment: key-step;
}

.news-list li::before {
  content: "0" counter(key-step);
  color: var(--news-brass);
  font: italic 2.5rem/0.9 Georgia, "Times New Roman", serif;
}

.news-feature {
  max-width: 66rem;
  justify-self: center;
  margin: 0;
  padding: 0.55rem;
  border: 1px solid var(--news-brass);
  background: rgba(44, 74, 60, 0.55);
  box-shadow: 0 1.5rem 3.5rem var(--news-shadow);
}

.news-feature .editorial-image,
.news-feature > img {
  width: 100%;
  min-height: 18rem;
  display: block;
  object-fit: cover;
}

.news-byline {
  display: block;
  padding: 0.8rem 0.35rem 0.25rem;
  color: var(--news-cream);
  font: italic 0.8rem/1.4 Georgia, "Times New Roman", serif;
}

.news-teaser-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.news-teaser {
  min-height: 14rem;
  align-content: start;
  border-top: 1px solid rgba(198, 154, 88, 0.65);
  color: inherit;
  display: grid;
  gap: 0.65rem;
  padding: 1.25rem 0;
  text-decoration: none;
}

.news-teaser:hover,
.news-teaser:focus-visible {
  border-color: var(--news-cream);
}

.news-teaser__number {
  color: var(--news-brass);
  font: italic 2.7rem/1 Georgia, "Times New Roman", serif;
}

.news-teaser strong {
  font-size: 1.2rem;
  font-weight: 400;
  line-height: 1.2;
}

.newspaper-page-footer {
  min-height: 5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem clamp(1.25rem, 4vw, 3.75rem);
  border-top: 1px solid rgba(198, 154, 88, 0.45);
  background: var(--news-pine);
  color: var(--news-muted);
  font-size: 0.72rem;
  letter-spacing: 0;
  text-transform: none;
}

.newspaper-page-footer a {
  color: var(--news-cream);
}

@keyframes news-rise {
  from { opacity: 0; transform: translateY(1.25rem); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes news-lights {
  from { opacity: 0; transform: scale(0.78); }
  to { opacity: 0.85; transform: scale(1); }
}

@keyframes news-pass-sway {
  0%, 100% { transform: rotate(-1deg); }
  50% { transform: rotate(1deg); }
}

@media (max-width: 760px) {
  .newspaper-masthead {
    grid-template-columns: 1fr auto;
    gap: 0.5rem 1rem;
    padding: 1.25rem;
  }
  .newspaper-masthead span { grid-column: 1 / -1; grid-row: 2; }
  .newspaper-masthead time { grid-column: 2; grid-row: 1; }
  .newspaper-nav,
  .newspaper-context { padding-inline: 1.25rem; }
  .news-layout--split,
  .news-layout--columns,
  .news-layout--sidebar { grid-template-columns: minmax(0, 1fr); }
  .news-teaser-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .news-hero__headline { font-size: clamp(2.7rem, 14vw, 4.8rem); }
  .news-pass { margin-top: 4.5rem; }
}

@media (max-width: 480px) {
  .news-layout { padding-inline: 1.25rem; }
  .news-teaser-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .result--newspaper::before,
  .news-layout,
  .news-layout > *,
  .news-pass { animation: none; }
}

@media print {
  .result--newspaper {
    background: var(--news-pine);
    print-color-adjust: exact;
  }
  .news-card,
  .news-feature,
  .news-teaser { break-inside: avoid; }
}
`;

function visualReportHtml(documentName: string) {
  const issueDate = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date());
  return `<onepaper>
<section class="onepaper-sheet visual-report">
  <header class="onepaper-title visual-hero">
    <div class="visual-chat-header">
      <span class="visual-avatar" aria-hidden="true">Q</span>
      <div>
        <strong>QA Council</strong>
        <span>Prüfbericht · ${escapeHtml(issueDate)}</span>
      </div>
      <span class="visual-online" aria-label="Bericht ist verfügbar">•</span>
    </div>
    <div class="visual-message visual-message--coral">
      <strong>council</strong>
      <p>Synthese, Fachreviews und Gegenpositionen sind für diese Entscheidungsansicht zusammengeführt.</p>
    </div>
    <div class="visual-message visual-message--teal">
      <strong>nachweis</strong>
      <p>Jede Aussage bleibt mit ihrem Beleg und ihrer offenen Unsicherheit verbunden.</p>
    </div>
    <div class="visual-headline">
      <span class="onepaper-kicker">Die große Nachricht</span>
      <strong><span>${escapeHtml(documentName)}</span></strong>
      <p>Ein disziplinierter Gesprächsfaden aus Entscheidung, Risiko, Gegenposition und nächsten Schritten.</p>
    </div>
    <a class="visual-composer" href="#next-steps">
      <span>Direkt zu den nächsten Schritten</span>
      <strong class="visual-send" aria-hidden="true">→</strong>
    </a>
  </header>

  <main class="onepaper-content">
    <section id="decision" class="visual-section visual-grid visual-grid--wide">
      <article class="onepaper-decision visual-panel visual-panel--dark">
        <span class="onepaper-kicker">council · Entscheidung</span>
        <h1>Die finale Council-Entscheidung prägnant einsetzen</h1>
        <p>Begründung, Bedingungen und verbleibendes Restrisiko in drei Sätzen verdichten.</p>
      </article>
      <figure class="visual-image visual-image--dark">
        {{EDITORIAL_IMAGE}}
        <figcaption class="visual-caption">das Schlüsselmotiv zum geprüften Dokument</figcaption>
      </figure>
    </section>

    <section class="visual-section">
      <span class="visual-spark" aria-hidden="true">✦</span>
      <h2>Was der Thread zur Risikolage sagt</h2>
      <div class="visual-grid visual-emote-grid">
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
        <label><span>Produktqualität</span><meter class="visual-chart__row" min="0" max="5" value="0">Nicht bewertet</meter></label>
        <label><span>Betriebsrisiko</span><meter class="visual-chart__row" min="0" max="5" value="0">Nicht bewertet</meter></label>
        <label><span>Nachweisreife</span><meter class="visual-chart__row" min="0" max="5" value="0">Nicht bewertet</meter></label>
      </div>
    </section>

    <section id="next-steps" class="visual-section visual-grid visual-grid--wide">
      <article class="visual-panel">
        <span class="onepaper-kicker">die crew · Nächste Schritte</span>
        <ol class="onepaper-actions visual-timeline">
          <li class="visual-timeline__step"><strong>01</strong><span>Dringendste Maßnahme mit Owner, Frist und Abnahmekriterium.</span></li>
          <li class="visual-timeline__step"><strong>02</strong><span>Zweiten priorisierten Schritt und dessen Nachweis ergänzen.</span></li>
          <li class="visual-timeline__step"><strong>03</strong><span>Entscheidungspunkt für den nächsten Council-Termin nennen.</span></li>
        </ol>
      </article>
      <aside class="visual-callout">
        <span class="onepaper-kicker">gegenstimme</span>
        <h2>Das stärkste Gegenargument sichtbar machen</h2>
        <p>Warum es nicht vollständig überzeugt und welche Unsicherheit dennoch bleibt.</p>
      </aside>
    </section>

    <section class="visual-section visual-evidence">
      <span class="onepaper-kicker">nachweis · angeheftet</span>
      <h2>Die drei belastbarsten Belege</h2>
      <div class="visual-matrix">
        <article class="visual-matrix__item"><strong><span aria-hidden="true">✦</span> Beleg 01</strong><span>Fundstelle und Aussage ergänzen.</span></article>
        <article class="visual-matrix__item"><strong><span aria-hidden="true">↗</span> Beleg 02</strong><span>Fundstelle und Aussage ergänzen.</span></article>
        <article class="visual-matrix__item"><strong><span aria-hidden="true">●</span> Beleg 03</strong><span>Fundstelle und Aussage ergänzen.</span></article>
      </div>
    </section>

    <section class="visual-section visual-grid visual-grid--wide visual-image-thread">
      <figure class="visual-image">
        {{REPORT_IMAGE_EVIDENCE}}
        <figcaption class="visual-caption">die Evidenzkarte aus den stärksten Fachreview-Nachweisen</figcaption>
      </figure>
      <figure class="visual-image">
        {{REPORT_IMAGE_ROADMAP}}
        <figcaption class="visual-caption">die Umsetzungsroute für die priorisierten nächsten Schritte</figcaption>
      </figure>
    </section>
  </main>

  <footer class="onepaper-footer">
    <span>Der vollständige Council-Nachweis bleibt die Faktenquelle.</span>
    <b>QA Council <span aria-hidden="true">♡</span></b>
  </footer>
</section>
</onepaper>
`;
}

const VISUAL_REPORT_CSS = `:root {
  --visual-oat: #fbf4ea;
  --visual-plum: #2e2440;
  --visual-coral: #f4715f;
  --visual-teal: #2ba394;
  --visual-marigold: #ffb938;
  --visual-muted: #6d6478;
  --visual-shadow: rgba(46, 36, 64, 0.12);
}

.onepaper-sheet.visual-report {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: var(--visual-oat);
  color: var(--visual-plum);
  font-family: "Trebuchet MS", Verdana, sans-serif;
  font-size: 16px;
  line-height: 1.65;
  margin: 0 auto;
  max-width: 1180px;
  min-width: 0;
}

.onepaper-sheet.visual-report,
.onepaper-sheet.visual-report *,
.onepaper-sheet.visual-report::before,
.onepaper-sheet.visual-report::after {
  box-sizing: border-box;
}

.onepaper-sheet.visual-report::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  pointer-events: none;
  opacity: 0.18;
  background:
    repeating-linear-gradient(11deg, transparent 0 4px, rgba(46, 36, 64, 0.028) 4px 5px),
    repeating-linear-gradient(101deg, rgba(255, 185, 56, 0.025) 0 1px, transparent 1px 6px);
}

.onepaper-sheet.visual-report > * {
  position: relative;
  z-index: 1;
}

.visual-report h1,
.visual-report h2,
.visual-report h3,
.visual-report strong {
  font-family: "Trebuchet MS", "Arial Rounded MT Bold", Arial, sans-serif;
}

.visual-hero {
  display: grid;
  gap: 1.25rem;
  min-height: 0;
  padding: clamp(1.5rem, 5vw, 4.5rem) clamp(1.25rem, 7vw, 6.5rem) clamp(4rem, 9vw, 8rem);
  border: 0;
  background:
    radial-gradient(circle at 92% 5%, rgba(255, 185, 56, 0.22), transparent 20rem),
    var(--visual-oat);
  color: var(--visual-plum);
}

.visual-chat-header {
  display: grid;
  grid-template-columns: 3rem 1fr auto;
  gap: 0.85rem;
  align-items: center;
  margin-bottom: clamp(1.5rem, 4vw, 3.5rem);
}

.visual-avatar {
  width: 3rem;
  height: 3rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--visual-plum);
  color: var(--visual-oat);
  font-size: 1.3rem;
  font-weight: 800;
  box-shadow: 0 0.55rem 1.2rem var(--visual-shadow);
}

.visual-chat-header div {
  display: grid;
  gap: 0.05rem;
}

.visual-chat-header div > strong {
  color: var(--visual-plum);
  font-size: 1rem;
}

.visual-chat-header div > span {
  color: var(--visual-muted);
  font-size: 0.76rem;
}

.visual-online {
  color: var(--visual-coral);
  font-size: 2rem;
  line-height: 1;
}

.visual-message {
  width: min(31rem, 82%);
  display: grid;
  gap: 0.25rem;
  padding: 1rem 1.25rem;
  border-radius: 1.35rem 1.35rem 1.35rem 0.45rem;
  box-shadow: 0 0.75rem 1.7rem var(--visual-shadow);
  animation: visual-pop 620ms cubic-bezier(0.2, 1.25, 0.35, 1) both;
}

.visual-message--coral {
  background: rgba(244, 113, 95, 0.17);
}

.visual-message--teal {
  justify-self: end;
  border-radius: 1.35rem 1.35rem 0.45rem 1.35rem;
  background: rgba(43, 163, 148, 0.17);
  animation-delay: 90ms;
}

.visual-message strong {
  color: var(--visual-coral);
  font-size: 0.78rem;
}

.visual-message--teal strong {
  color: var(--visual-teal);
}

.visual-message p {
  margin: 0;
}

.visual-headline {
  max-width: 55rem;
  display: grid;
  gap: 0.9rem;
  margin-top: clamp(2rem, 6vw, 5rem);
  animation: visual-pop 650ms cubic-bezier(0.2, 1.15, 0.35, 1) 220ms both;
}

.visual-headline > strong {
  min-width: 0;
  color: var(--visual-plum);
  font-size: clamp(3rem, 8vw, 7.2rem);
  font-weight: 800;
  letter-spacing: -0.065em;
  line-height: 0.9;
  overflow-wrap: anywhere;
}

.visual-headline > strong span {
  text-decoration: underline;
  text-decoration-color: var(--visual-coral);
  text-decoration-style: wavy;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.13em;
}

.visual-headline > p {
  color: var(--visual-muted);
  font-size: clamp(1.05rem, 2vw, 1.3rem);
  line-height: 1.55;
  margin: 0;
  max-width: 62ch;
}

.onepaper-kicker {
  color: var(--visual-coral);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: none;
}

.visual-composer {
  width: min(38rem, 100%);
  display: grid;
  grid-template-columns: 1fr 2.8rem;
  gap: 0.75rem;
  align-items: center;
  margin-top: 2.5rem;
  padding: 0.55rem 0.6rem 0.55rem 1.25rem;
  border-radius: 999px;
  background: rgba(46, 36, 64, 0.07);
  color: var(--visual-muted);
  text-decoration: none;
  box-shadow: inset 0 0 0 1px rgba(46, 36, 64, 0.06);
  animation: visual-composer-in 600ms ease-out 320ms both;
}

.visual-composer:hover,
.visual-composer:focus-visible {
  color: var(--visual-teal);
  box-shadow: inset 0 0 0 2px var(--visual-teal);
  outline: 0;
}

.visual-send {
  width: 2.8rem;
  height: 2.8rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--visual-coral);
  color: var(--visual-oat);
  font-size: 1.4rem;
}

.onepaper-content {
  display: grid;
  gap: 0;
  padding: 0 clamp(1.25rem, 7vw, 6.5rem);
  overflow: visible;
}

.visual-section {
  position: relative;
  padding: clamp(4rem, 9vw, 8rem) 0;
}

.visual-section + .visual-section {
  border-top: 1px dashed rgba(46, 36, 64, 0.14);
}

.visual-section > h2 {
  max-width: 18ch;
  margin: 0 0 2rem;
  color: var(--visual-plum);
  font-size: clamp(2.2rem, 5vw, 4.8rem);
  font-weight: 800;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.visual-grid {
  display: grid;
  gap: clamp(1rem, 2.5vw, 2rem);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.visual-grid--wide { grid-template-columns: minmax(0, 1.55fr) minmax(16rem, 0.8fr); }

.visual-panel,
.visual-callout {
  border: 0;
  border-radius: 1.5rem;
  padding: clamp(1.2rem, 3vw, 2.2rem);
  box-shadow: 0 1rem 2.5rem var(--visual-shadow);
}

.visual-panel {
  background: rgba(244, 113, 95, 0.13);
}

.visual-panel--dark {
  align-self: start;
  border-radius: 1.5rem 1.5rem 0.45rem 1.5rem;
  background: rgba(244, 113, 95, 0.16);
  color: var(--visual-plum);
}

.visual-panel h1 {
  margin: 1rem 0;
  color: var(--visual-plum);
  font-size: clamp(2rem, 4.5vw, 4.4rem);
  font-weight: 800;
  letter-spacing: -0.055em;
  line-height: 0.96;
}

.visual-callout {
  align-self: end;
  border-radius: 1.5rem 1.5rem 1.5rem 0.45rem;
  background: rgba(43, 163, 148, 0.17);
}

.visual-callout .onepaper-kicker {
  color: var(--visual-teal);
}

.visual-callout h2 {
  margin-bottom: 0.8rem;
  color: var(--visual-plum);
  font-size: clamp(1.6rem, 3vw, 2.8rem);
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1;
}

.visual-image {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 0;
  min-height: 18rem;
  padding: 0.65rem;
  border-radius: 1.6rem;
  background: var(--visual-oat);
  box-shadow: 0 1rem 2.5rem var(--visual-shadow);
  overflow: hidden;
}

.visual-image--dark {
  background: var(--visual-plum);
}

.visual-image img,
.visual-image .editorial-image {
  width: 100%;
  min-height: 17rem;
  flex: 1;
  border: 0;
  border-radius: 1.15rem;
  object-fit: cover;
  overflow: hidden;
}

.visual-caption {
  max-width: calc(100% - 2rem);
  align-self: flex-start;
  position: relative;
  z-index: 1;
  margin: -1.35rem 0 0 1rem;
  padding: 0.65rem 0.9rem;
  border-radius: 1rem 1rem 1rem 0.3rem;
  background: var(--visual-oat);
  color: var(--visual-plum);
  font-size: 0.72rem;
  text-transform: none;
  box-shadow: 0 0.55rem 1.1rem var(--visual-shadow);
}

.visual-metric {
  min-height: 11rem;
  display: grid;
  align-content: space-between;
  gap: 1rem;
  padding: 1.4rem;
  border: 0;
  border-radius: 1.35rem;
  background: rgba(244, 113, 95, 0.14);
  box-shadow: 0 0.7rem 1.7rem var(--visual-shadow);
  transition: transform 180ms ease, background 180ms ease;
}

.visual-metric:nth-child(2) {
  background: rgba(43, 163, 148, 0.14);
}

.visual-metric:nth-child(3) {
  background: rgba(255, 185, 56, 0.2);
}

.visual-metric:hover {
  background: rgba(43, 163, 148, 0.19);
  transform: rotate(-0.6deg) translateY(-0.25rem);
}

.visual-metric__value {
  color: var(--visual-plum);
  font-size: clamp(3rem, 7vw, 5.5rem);
  font-weight: 800;
  letter-spacing: -0.08em;
  line-height: 0.85;
}

.visual-metric__label {
  color: var(--visual-muted);
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: none;
}

.visual-chart {
  display: grid;
  gap: 0.8rem;
  margin-top: 2rem;
  padding: 1.25rem;
  border-radius: 1.35rem;
  background: rgba(46, 36, 64, 0.045);
}

.visual-chart label {
  display: grid;
  grid-template-columns: minmax(8rem, 0.35fr) 1fr;
  align-items: center;
  gap: 1rem;
  color: var(--visual-muted);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: none;
}

.visual-chart__row {
  width: 100%;
  height: 1.2rem;
  accent-color: var(--visual-coral);
}

.visual-timeline {
  display: grid;
  gap: 1.25rem;
  margin: 1.5rem 0 0;
  padding: 0;
  list-style: none;
}

.visual-timeline__step {
  display: grid;
  grid-template-columns: 3.2rem 1fr;
  gap: 1rem;
  align-items: start;
  padding: 1rem 1.1rem;
  border: 0;
  border-radius: 1.2rem 1.2rem 1.2rem 0.35rem;
  background: var(--visual-oat);
  box-shadow: 0 0.55rem 1.2rem var(--visual-shadow);
}

.visual-timeline__step strong {
  width: 3rem;
  height: 3rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--visual-marigold);
  color: var(--visual-plum);
  font-size: 0.9rem;
}

.visual-evidence {
  padding-inline: clamp(1.25rem, 4vw, 3.5rem);
  border: 0;
  border-radius: 2rem;
  background: rgba(255, 185, 56, 0.09);
}

.visual-matrix {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 0;
}

.visual-matrix__item {
  min-height: 11rem;
  display: grid;
  align-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border: 0;
  border-radius: 1.25rem;
  background: rgba(244, 113, 95, 0.13);
  box-shadow: 0 0.7rem 1.7rem var(--visual-shadow);
  transition: transform 180ms ease;
}

.visual-matrix__item:nth-child(2) {
  background: rgba(43, 163, 148, 0.14);
}

.visual-matrix__item:nth-child(3) {
  background: rgba(255, 185, 56, 0.22);
}

.visual-matrix__item:hover {
  transform: rotate(0.7deg) translateY(-0.25rem);
}

.visual-matrix__item strong {
  color: var(--visual-plum);
  font-size: 0.78rem;
  letter-spacing: 0;
  text-transform: none;
}

.visual-matrix__item strong > span {
  color: var(--visual-marigold);
}

.visual-matrix__item > span {
  color: var(--visual-plum);
  font-size: 1.05rem;
  line-height: 1.45;
}

.visual-spark {
  position: absolute;
  top: 3rem;
  right: 3%;
  color: var(--visual-marigold);
  font-size: 1.6rem;
  transform: rotate(12deg);
}

.visual-image-thread .visual-image:nth-child(2) {
  margin-top: 3rem;
}

.onepaper-footer {
  align-items: center;
  display: flex;
  font-size: 0.72rem;
  justify-content: space-between;
  gap: 1rem;
  min-height: 0;
  padding: 1.4rem clamp(1.25rem, 7vw, 6.5rem);
  border-top: 1px dashed rgba(46, 36, 64, 0.16);
  background: var(--visual-oat);
  color: var(--visual-muted);
  letter-spacing: 0;
  text-transform: none;
}

.onepaper-footer b {
  color: var(--visual-coral);
}

@keyframes visual-pop {
  from { opacity: 0; transform: scale(0.92) translateY(0.8rem); }
  70% { transform: scale(1.015) translateY(-0.1rem); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes visual-composer-in {
  from { opacity: 0; transform: translateY(1rem); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 760px) {
  .visual-grid,
  .visual-grid--wide,
  .visual-matrix { grid-template-columns: minmax(0, 1fr); }
  .visual-hero { padding-inline: 1.25rem; }
  .visual-message { width: min(34rem, 88%); }
  .visual-headline > strong { font-size: clamp(2.65rem, 12vw, 4.5rem); }
  .visual-chart label { grid-template-columns: minmax(0, 1fr); gap: 0.35rem; }
  .visual-image { min-height: 15rem; }
  .visual-image-thread .visual-image:nth-child(2) { margin-top: 0; }
  .onepaper-footer { align-items: flex-start; flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .visual-message,
  .visual-headline,
  .visual-composer { animation: none; }
  .visual-metric,
  .visual-matrix__item { transition: none; }
}

@media print {
  .onepaper-sheet.visual-report {
    background: var(--visual-oat);
    print-color-adjust: exact;
  }
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
  const newspaperBrief = `${commonBrief} Inszeniere das Motiv warm, gedämpft und malerisch wie in einem privaten Backstage-Salon: Flaschengrün, Messinglicht und dunkles Holz, ohne Hochglanz-Stockfoto, Neon oder flache Vektorästhetik.`;
  const visualReportBrief = `${commonBrief} Gestalte es als warmes, hochwertiges Papier-Cutout-Key-Visual für einen „Group Chat“-Entscheidungsreport: Plum Roast auf Oat Cream mit gezielten Coral-, Teal- und Marigold-Akzenten, weich gerundet und gemeinschaftlich, aber nicht kindlich oder meme-artig.`;
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
        imageBrief: newspaperBrief,
        editorialAlt: `Editorial-Illustration zum QA-Bericht ${options.documentName}`,
        images: [
          {
            slot: "editorial",
            hook: "{{EDITORIAL_IMAGE}}",
            brief: newspaperBrief,
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
        imageBrief: visualReportBrief,
        editorialAlt: `Schlüsselmotiv des visuellen QA-Reports ${options.documentName}`,
        images: [
          {
            slot: "editorial",
            hook: "{{EDITORIAL_IMAGE}}",
            brief: `${visualReportBrief} Komponiere es als einziges dunkles, horizontales Bildmodul auf Plum Roast.`,
            alt: `Schlüsselmotiv des visuellen QA-Reports ${options.documentName}`,
          },
          {
            slot: "evidence",
            hook: "{{REPORT_IMAGE_EVIDENCE}}",
            brief: `Erzeuge eine textfreie, helle Papier-Cutout-Infografik zu den stärksten belegten Befunden aus ${options.documentName}. Nutze Oat Cream, Coral und Teal, klare räumliche Gruppierung und konkrete visuelle Metaphern statt dekorativer Abstraktion.`,
            alt: `Visuelle Evidenzkarte der wichtigsten Befunde aus ${options.documentName}`,
          },
          {
            slot: "roadmap",
            hook: "{{REPORT_IMAGE_ROADMAP}}",
            brief: `Erzeuge eine textfreie, helle Papier-Cutout-Roadmap zu den priorisierten nächsten Schritten für ${options.documentName}. Zeige Abhängigkeiten, Kontrollpunkte und Zielzustand auf Oat Cream mit kleinen Coral-, Teal- und Marigold-Akzenten.`,
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
    "Die finale Council-Entscheidung prägnant einsetzen",
    "Begründung, Bedingungen und verbleibendes Restrisiko in drei Sätzen verdichten.",
    "Dringendste Maßnahme mit Owner, Frist und Abnahmekriterium.",
    "Das stärkste Gegenargument sichtbar machen",
    "Fundstelle und Aussage ergänzen.",
    "Nicht bewertet",
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
  for (const hook of ["{{REPORT_IMAGE_EVIDENCE}}", "{{REPORT_IMAGE_ROADMAP}}"]) {
    const count = (onepaper.match(new RegExp(hook.replace(/[{}]/g, "\\$&"), "g")) ?? []).length;
    if (count !== 1) {
      findings.push(
        `Struktur · Der Visual Report braucht genau einen ${hook}-Hook, gefunden: ${count}.`,
      );
    }
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
