import { describe, expect, it } from "vitest";
import {
  createPresentation,
  finalSynthesisMarkdown,
  markdownHtml,
  reportDesignerPrompt,
  resultNewspaperSections,
  splitNewspaperSections,
} from "./presentation.js";

describe("Markdown-Ausgabe", () => {
  it("reduziert die Resultatansicht auf die finale Synthese", () => {
    expect(
      finalSynthesisMarkdown(
        "# Ergebnis\n\n## Finale Synthese\n\nEntscheidung.\n\n## Begründung\n\nSie trägt.\n\n## Triage und RACI\n\nIntern.",
      ),
    ).toBe("# Ergebnis\n\n## Finale Synthese\n\nEntscheidung.\n\n## Begründung\n\nSie trägt.\n");
  });
  it("formatiert Modelltext und entfernt aktive oder unsichere Inhalte", () => {
    const html = markdownHtml(
      '# Titel\n\n- **Punkt**\n\n<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">unsicher</a><a href="//evil.test">relativ</a>',
    );
    expect(html).toContain("<h1>Titel</h1>");
    expect(html).toContain("<strong>Punkt</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("//evil.test");
  });
});

const finalMarkdown = `# Ergebnis

## Finale Synthese

Freigabe nur mit Auflage.

## Interne Überschrift der Synthese

Diese Überschrift ist keine eigene Zeitungsroute.

## Cross-Reviews

Diese modellinterne Überschrift darf die spätere kanonische Seite nicht duplizieren.

## Triage und RACI

Security ist verantwortlich.

## Cross-Reviews

Kanonische Cross-Review-Sektion.`;

const reportPackage = `<report-package>
  <image-brief>Editorial lock and checkout ledger, restrained ink illustration.</image-brief>
  <newspaper>
    <front><article class="news-layout news-layout--lead"><h1>Die Freigabe bleibt bedingt</h1>{{EDITORIAL_IMAGE}}<a href="__RESULT_BASE__/urteil">Analyse</a></article></front>
    <page title="Das Urteil" slug="urteil"><article class="news-layout news-layout--split"><h1>Auflage vor Start</h1><p>Freigabe nur mit Auflage.</p></article></page>
    <page slug="staerken" title="Was trägt"><article class="news-layout news-layout--sidebar"><h1>Die Grundlage trägt</h1><p>Der Kern ist belastbar.</p></article></page>
    <page slug="risiken" title="Risiken und Lücken"><article class="news-layout news-layout--columns"><h1>Eine Lücke bleibt</h1><p>Der Nachweis fehlt.</p></article></page>
    <page slug="massnahmen" title="Was jetzt zu tun ist"><article class="news-layout news-layout--split"><h1>Nachweis schließen</h1><p>Die Auflage ist konkret.</p></article></page>
    <page slug="belege" title="Warum das Urteil trägt"><article class="news-layout news-layout--columns"><h1>Belegt entschieden</h1><p>Die Fundstellen tragen das Urteil.</p></article></page>
  </newspaper>
  <onepaper>
    <section class="onepaper-sheet visual-report"><header class="onepaper-title visual-hero"><strong>Decision Brief</strong></header>{{EDITORIAL_IMAGE}}<main class="onepaper-content"><div class="onepaper-decision">Freigabe nur mit Auflage.</div></main><footer class="onepaper-footer">QA Council</footer></section>
  </onepaper>
</report-package>`;

describe("Report-Designer-Ausgaben", () => {
  it("behält den Auditparser separat, baut die Zeitung aber aus fünf Ergebnisartikeln", async () => {
    const auditMarkdown = `# Ergebnis

## Finale Synthese
Synthese.
## Triage und RACI
Triage.
## Isolierte Einzelreviews
Einzelreviews.
## Cross-Reviews
Cross-Reviews.
## Gemeinsames Review
Gemeinsames Review.
## Debattenprotokoll
Debatte.
## Council-Runden
Council.
## Dissent-Audit
Dissens.
## Abdeckungsmanifest
Nachweis.`;
    const auditSlugs = [
      "synthese",
      "triage",
      "fachreviews",
      "cross-reviews",
      "gemeinsames-review",
      "debatte",
      "council-runden",
      "dissent-audit",
      "nachweis",
    ];

    expect(splitNewspaperSections(auditMarkdown).map((section) => section.slug)).toEqual(
      auditSlugs,
    );
    const sections = resultNewspaperSections(auditMarkdown);
    const expectedSlugs = ["urteil", "staerken", "risiken", "massnahmen", "belege"];
    expect(sections.map((section) => section.slug)).toEqual(expectedSlugs);
    expect(sections.every((section) => section.markdown.includes("Synthese."))).toBe(true);
    expect(sections.every((section) => !section.markdown.includes("Triage."))).toBe(true);
    const completeReportPackage = `<report-package>
      <image-brief>Das Ergebnis und seine Entscheidung</image-brief>
      <newspaper>
        <front><article><h1>Das Ergebnis</h1></article></front>
        ${sections
          .map(
            (section) =>
              `<page slug="${section.slug}" title="${section.title}"><article><h1>${section.title}</h1><p>${section.markdown}</p></article></page>`,
          )
          .join("\n")}
      </newspaper>
      <onepaper><section><h1>Das Ergebnis</h1></section></onepaper>
    </report-package>`;
    const result = await createPresentation({
      kind: "newspaper",
      finalMarkdown: auditMarkdown,
      reportPackage: completeReportPackage,
      documentName: "audit.md",
    });
    expect(result.pages?.map((page) => page.slug)).toEqual(expectedSlugs);
  });

  it("fordert beide direkten HTML-Ausgaben mit dokumentbezogenem Bildbriefing an", () => {
    const prompt = reportDesignerPrompt({
      finalMarkdown,
      documentName: "checkout.md",
      automaticLanguage: true,
    });

    expect(prompt).toContain("<report-package>");
    expect(prompt).toContain('slug="urteil"');
    expect(prompt).toContain('slug="staerken"');
    expect(prompt).toContain('slug="risiken"');
    expect(prompt).toContain('slug="massnahmen"');
    expect(prompt).toContain('slug="belege"');
    expect(prompt).not.toContain('slug="cross-reviews"');
    expect(prompt).not.toContain('slug="interne-uberschrift-der-synthese"');
    expect(prompt).toContain("Bildbriefing");
  });

  it("übernimmt das KI-HTML der Zeitung und erzeugt echte Unterseiten", async () => {
    const result = await createPresentation({
      kind: "newspaper",
      finalMarkdown,
      reportPackage,
      documentName: "checkout.md",
    });

    expect(result.html).toContain("Die Freigabe bleibt bedingt");
    expect(result.html).toContain("__RESULT_BASE__/urteil");
    expect(result.pages).toHaveLength(5);
    expect(result.pages?.[0].html).toContain("Auflage vor Start");
    expect(result.html).not.toContain("{{EDITORIAL_IMAGE}}");
  });

  it("escaped bereits codierte Seitentitel nicht doppelt", async () => {
    const result = await createPresentation({
      kind: "newspaper",
      finalMarkdown,
      reportPackage: reportPackage.replace('title="Das Urteil"', 'title="Urteil &amp; Freigabe"'),
      documentName: "checkout.md",
    });

    expect(result.html).toContain("Urteil &amp; Freigabe");
    expect(result.html).not.toContain("&amp;amp;");
  });

  it("übernimmt den frei gestalteten Visual Report in die PDF-Hülle", async () => {
    const result = await createPresentation({
      kind: "onepaper",
      finalMarkdown,
      reportPackage,
      documentName: "checkout.md",
    });

    expect(result.html).toContain("onepaper-sheet");
    expect(result.html).toContain("onepaper-decision");
    expect(result.html).toContain("Freigabe nur mit Auflage.");
    expect(result.html).not.toContain("{{EDITORIAL_IMAGE}}");
  });

  it("erhält belegte HTML-Meter für Visual-Report-Diagramme", async () => {
    const result = await createPresentation({
      kind: "onepaper",
      finalMarkdown,
      reportPackage: reportPackage.replace(
        '<div class="onepaper-decision">Freigabe nur mit Auflage.</div>',
        '<div class="visual-chart"><meter class="visual-chart__row" min="0" max="5" value="3">3 von 5</meter></div>',
      ),
      documentName: "checkout.md",
    });

    expect(result.html).toContain('<meter class="visual-chart__row" min="0" max="5" value="3">');
  });
});
