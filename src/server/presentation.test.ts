import { describe, expect, it } from "vitest";
import { createPresentation, markdownHtml, reportDesignerPrompt } from "./presentation.js";

describe("Markdown-Ausgabe", () => {
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

## Triage, Scope und RACI

Security ist verantwortlich.

## Cross-Reviews

Kanonische Cross-Review-Sektion.`;

const reportPackage = `<report-package>
  <image-brief>Editorial lock and checkout ledger, restrained ink illustration.</image-brief>
  <newspaper>
    <front><article class="news-layout news-layout--lead"><h1>Die Freigabe bleibt bedingt</h1>{{EDITORIAL_IMAGE}}<a href="__RESULT_BASE__/synthese">Analyse</a></article></front>
    <page title="Entscheidung" slug="synthese"><article class="news-layout news-layout--split"><h1>Auflage vor Start</h1><p>Freigabe nur mit Auflage.</p></article></page>
    <page slug="triage" title="Verantwortung"><article class="news-layout news-layout--sidebar"><h1>Security führt</h1><p>Security ist verantwortlich.</p></article></page>
    <page slug="cross-reviews" title="Cross-Reviews"><article class="news-layout news-layout--columns"><h1>Cross-Review</h1><p>Kanonische Sektion.</p></article></page>
  </newspaper>
  <onepaper>
    <section class="onepaper-sheet visual-report"><header class="onepaper-title visual-hero"><strong>Decision Brief</strong></header>{{EDITORIAL_IMAGE}}<main class="onepaper-content"><div class="onepaper-decision">Freigabe nur mit Auflage.</div></main><footer class="onepaper-footer">QA Council</footer></section>
  </onepaper>
</report-package>`;

describe("Report-Designer-Ausgaben", () => {
  it("fordert beide direkten HTML-Ausgaben mit dokumentbezogenem Bildbriefing an", () => {
    const prompt = reportDesignerPrompt({
      finalMarkdown,
      documentName: "checkout.md",
      automaticLanguage: true,
    });

    expect(prompt).toContain("<report-package>");
    expect(prompt).toContain('slug="synthese"');
    expect(prompt).toContain('slug="triage"');
    expect(prompt.match(/slug="cross-reviews"/g)).toHaveLength(1);
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
    expect(result.html).toContain("__RESULT_BASE__/synthese");
    expect(result.pages).toHaveLength(3);
    expect(result.pages?.[0].html).toContain("Auflage vor Start");
    expect(result.html).not.toContain("{{EDITORIAL_IMAGE}}");
  });

  it("escaped bereits codierte Seitentitel nicht doppelt", async () => {
    const result = await createPresentation({
      kind: "newspaper",
      finalMarkdown,
      reportPackage: reportPackage.replace(
        'title="Entscheidung"',
        'title="Entscheidung &amp; Freigabe"',
      ),
      documentName: "checkout.md",
    });

    expect(result.html).toContain("Entscheidung &amp; Freigabe");
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
