import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateReportPackage } from "./report-validation.js";
import {
  assembleReportWorkspace,
  normalizeAuthoredReportHtml,
  parseReportManifest,
  readReportWorkspace,
  reportWorkspacePath,
  scaffoldReportWorkspace,
  scopeReportCss,
  validateReportCss,
  validateReportWorkspace,
} from "./report-workspace.js";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousDataDir = process.env.DATA_DIR;
  dataDir = await mkdtemp(path.join(os.tmpdir(), "qa-report-workspace-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("persistenter Report-Arbeitsbereich", () => {
  it("ersetzt Root-Selektoren innerhalb des CSS-Scopes durch :scope", () => {
    const scoped = scopeReportCss(
      `:root { --ink: #123; }
.result--newspaper { color: var(--ink); }
.result--newspaper h1 { font-size: 3rem; }
.news-card { padding: 1rem; }`,
      ".result--newspaper",
    );

    expect(scoped).toContain("@scope (.result--newspaper)");
    expect(scoped).toContain(":scope { --ink: #123; }");
    expect(scoped).toContain(":scope h1 { font-size: 3rem; }");
    expect(scoped).not.toContain(".result--newspaper { color");
  });

  it("repariert bereits gespeicherte Report-Styles beim Lesen", () => {
    const html =
      '<style data-report-workspace>@scope (.result--onepaper) { .result--onepaper { color: red; } .result--onepaper h1 { color: blue; } }</style><main class="result result--onepaper"><header class="result__masthead"><a>QA Council</a></header><section class="onepaper-sheet"></section></main>';
    const normalized = normalizeAuthoredReportHtml(html);

    expect(normalized).toContain(
      "@scope (.result--onepaper) { :scope { color: red; } :scope h1 { color: blue; } }",
    );
    expect(normalized).toContain('<main class="result result--onepaper">');
    expect(normalized).not.toContain('class="result__masthead"');
  });

  it("legt beide gestalteten Report-Templates als HTML, CSS und TS unter DATA_DIR an", async () => {
    const files = await scaffoldReportWorkspace({
      runId: "run-42",
      documentName: "checkout.md",
      newspaperPages: [
        { slug: "synthese", title: "Entscheidung" },
        { slug: "nachweis", title: "Nachweis" },
      ],
    });

    expect(files.root).toBe(path.join(dataDir, "report-workspaces", "run-42"));
    expect(reportWorkspacePath("run-42")).toBe(files.root);
    expect(files.newspaper.html).toContain("<newspaper>");
    expect(files.newspaper.html).toContain('slug="synthese"');
    expect(files.newspaper.html).toContain('class="news-pass"');
    expect(files.newspaper.css).toContain(".news-hero__headline");
    expect(files.newspaper.css).toContain("--news-pine: #1f362c");
    expect(files.newspaper.css).toContain("--news-ember: #d9704f");
    expect(files.newspaper.css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(files.newspaper.manifest).toContain("export const reportManifest");
    expect(files.visualReport.html).toContain("visual-matrix");
    expect(files.visualReport.html).toContain('class="visual-composer"');
    expect(files.visualReport.css).toContain(".visual-chart");
    expect(files.visualReport.css).toContain("--visual-oat: #fbf4ea");
    expect(files.visualReport.css).toContain("--visual-teal: #2ba394");
    expect(files.visualReport.css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(files.visualReport.manifest).toContain('kind: "visual-report"');
  });

  it("überschreibt bereits von einem Agenten bearbeitete Dateien beim erneuten Scaffold nicht", async () => {
    await scaffoldReportWorkspace({ runId: "stable", documentName: "original.md" });
    const filePath = path.join(reportWorkspacePath("stable"), "newspaper", "index.html");
    await writeFile(
      filePath,
      "<newspaper><front>agent edit {{EDITORIAL_IMAGE}}</front></newspaper>",
    );

    await scaffoldReportWorkspace({ runId: "stable", documentName: "second.md" });

    expect(await readFile(filePath, "utf8")).toContain("agent edit");
  });

  it("validiert und assembliert die Templates zum bestehenden Report-Package plus Styles und Snapshot", async () => {
    await scaffoldReportWorkspace({
      runId: "assemble",
      documentName: "release.md",
      newspaperPages: [{ slug: "synthese", title: "Entscheidung" }],
    });
    const newspaperPath = path.join(reportWorkspacePath("assemble"), "newspaper", "index.html");
    const completedNewspaper = (await readFile(newspaperPath, "utf8"))
      .replace(
        "Diesen Vorspann anhand des finalen Council-Ergebnisses präzisieren.",
        "Die Freigabe bleibt bis zum belegten Nachweis offen.",
      )
      .replace(
        "Den wichtigsten belegten Befund dieses Ressorts mit konkretem Nachweis einsetzen.",
        "Der konkrete Nachweis fehlt im geprüften Dokument.",
      )
      .replace(
        "Konkrete Maßnahme mit Verantwortlichem ergänzen.",
        "Abnahmekriterien dokumentieren.",
      )
      .replace(
        "Die wichtigste Entscheidung gehört hierher",
        "Freigabe erst nach geschlossenem Nachweis",
      )
      .replace("Die dringendste belegte Maßnahme einsetzen", "Fehlende Abnahmekriterien schließen")
      .replace(
        "Die stärkste Aussage dieses Ressorts einsetzen",
        "Der Nachweis entscheidet über die Freigabe",
      );
    await writeFile(newspaperPath, completedNewspaper);
    const visualPath = path.join(reportWorkspacePath("assemble"), "visual-report", "index.html");
    const completedVisual = (await readFile(visualPath, "utf8"))
      .replace(
        "Die finale Council-Entscheidung prägnant einsetzen",
        "Freigabe erst nach geschlossenem Nachweis",
      )
      .replace(
        "Begründung, Bedingungen und verbleibendes Restrisiko in drei Sätzen verdichten.",
        "Die Freigabe bleibt an messbare Nachweise gebunden.",
      )
      .replace(
        "Dringendste Maßnahme mit Owner, Frist und Abnahmekriterium.",
        "Abnahmekriterien bis Freitag durch das QA-Team dokumentieren.",
      )
      .replace(
        "Das stärkste Gegenargument sichtbar machen",
        "Der frühe Markttermin bleibt ein relevantes Gegenargument",
      )
      .replaceAll("Fundstelle und Aussage ergänzen.", "Review-Fundstelle mit Nachweis verknüpfen.")
      .replaceAll("Nicht bewertet", "0 von 5");
    await writeFile(visualPath, completedVisual);

    const result = await assembleReportWorkspace({
      runId: "assemble",
      expectedPageSlugs: ["synthese"],
    });

    expect(result.validation.valid).toBe(true);
    expect(result.reportPackage).toContain("<report-package>");
    expect(result.reportPackage).toContain("<newspaper>");
    expect(result.reportPackage).toContain("<onepaper>");
    expect(result.reportPackage.match(/\{\{EDITORIAL_IMAGE\}\}/g)).toHaveLength(2);
    expect(validateReportPackage(result.reportPackage, ["synthese"]).valid).toBe(true);
    expect(result.styles.newspaper).toContain("--news-pine");
    expect(result.styles.visualReport).toContain("--visual-oat");
    expect(result.imageSlots).toHaveLength(4);
    expect(result.imageSlots.filter((image) => image.kind === "visual-report")).toHaveLength(3);
    expect(result.reportPackage).toContain("{{REPORT_IMAGE_EVIDENCE}}");
    expect(result.snapshot).toContain("===== newspaper/index.html =====");
    expect(result.snapshot).toContain("===== visual-report/report.ts =====");
  });

  it("weist Pfad-Traversal in Run-IDs zurück", () => {
    expect(() => reportWorkspacePath("../secret")).toThrow("Ungültige Run-ID");
  });
});

describe("statisches TypeScript-Manifest", () => {
  it("liest ausschließlich ein exportiertes Literal per AST", () => {
    const manifest = parseReportManifest(
      `export const reportManifest = {
        version: 1,
        kind: "newspaper",
        documentName: "review.md",
        title: "QA Report",
        imageBrief: "Textfreie Illustration",
        editorialAlt: "QA Illustration",
        images: [{
          slot: "editorial",
          hook: "{{EDITORIAL_IMAGE}}",
          brief: "Textfreie Illustration",
          alt: "QA Illustration"
        }]
      } as const;`,
      "newspaper",
    );

    expect(manifest.title).toBe("QA Report");
    expect(manifest.images[0].slot).toBe("editorial");
  });

  it.each([
    `fetch("https://example.test"); export const reportManifest = {};`,
    `export const reportManifest = makeManifest();`,
    `export const reportManifest = { version: 1, kind: "newspaper", documentName: "x", title: "x", imageBrief: process.env.SECRET, editorialAlt: "x" } as const;`,
    `export function run() { return "x"; }`,
  ])("führt Agent-Code niemals aus und weist nicht-literalisches TS zurück", (source) => {
    expect(() => parseReportManifest(source)).toThrow();
  });
});

describe("statische HTML- und CSS-Prüfung", () => {
  it("meldet aktive HTML-Inhalte, fehlende Hooks und fehlende Ressortseiten", async () => {
    const files = await scaffoldReportWorkspace({
      runId: "unsafe",
      documentName: "unsafe.md",
      newspaperPages: [{ slug: "synthese", title: "Entscheidung" }],
    });
    await writeFile(
      path.join(files.newspaper.root, "index.html"),
      '<newspaper><front><script>alert(1)</script></front><page slug="x" title="X">X</page></newspaper>',
    );

    const result = await validateReportWorkspace("unsafe", ["synthese"]);

    expect(result.valid).toBe(false);
    expect(result.findings.join("\n")).toContain("<script>");
    expect(result.findings.join("\n")).toContain("EDITORIAL_IMAGE");
    expect(result.findings.join("\n")).toContain('"synthese"');
  });

  it("weist externe CSS-Ressourcen und beschädigte Syntax konservativ zurück", () => {
    const findings = validateReportCss(
      '.visual-report { background: url("https://tracker.invalid/pixel");',
      "Visual Report",
    );

    expect(findings.join("\n")).toContain("url()");
    expect(findings.join("\n")).toContain("nicht ausgeglichen");
  });

  it("weist Symlinks im Report-Arbeitsbereich zurück", async () => {
    const files = await scaffoldReportWorkspace({ runId: "symlink", documentName: "review.md" });
    const manifestPath = path.join(files.newspaper.root, "report.ts");
    await rm(manifestPath);
    const { symlink } = await import("node:fs/promises");
    await symlink(path.join(files.visualReport.root, "report.ts"), manifestPath);

    await expect(readReportWorkspace("symlink")).rejects.toThrow("Unsichere Report-Datei");
  });
});
