import { describe, expect, it } from "vitest";
import { validateReportPackage } from "./report-validation.js";

function packageWith(fragment = '<section class="news-block">Inhalt</section>') {
  return `<report-package>
    <image-brief>Editorial technical illustration without text.</image-brief>
    <newspaper>
      <front><main class="news-layout">${fragment}{{EDITORIAL_IMAGE}}</main></front>
      <page slug="synthese" title="Entscheidung">${fragment}</page>
    </newspaper>
    <onepaper>
      <section class="onepaper-sheet visual-report">
        <header class="onepaper-title visual-hero">Titel</header>
        {{EDITORIAL_IMAGE}}
        <main class="onepaper-content"><div class="onepaper-panel">Befund</div></main>
        <footer class="onepaper-footer">Quelle</footer>
      </section>
    </onepaper>
  </report-package>`;
}

describe("validateReportPackage", () => {
  it("akzeptiert ein vollständiges Package mit bekanntem CSS-Vokabular", () => {
    expect(validateReportPackage(packageWith(), ["synthese"])).toEqual({
      valid: true,
      findings: [],
    });
  });

  it.each(["html", "xml", ""])("normalisiert einen einzelnen äußeren %s-Fence", (language) => {
    expect(
      validateReportPackage(`\`\`\`${language}\n${packageWith()}\n\`\`\``, ["synthese"]).valid,
    ).toBe(true);
  });

  it("weist innere Markdown-Fences weiterhin zurück", () => {
    const result = validateReportPackage(packageWith("<pre>```js\nalert(1)\n```</pre>"), [
      "synthese",
    ]);
    expect(result.findings).toContain("Struktur · Markdown-Fences sind nicht erlaubt.");
  });

  it("meldet CSS- und JavaScript-Vertragsverletzungen für die Agent-Korrektur", () => {
    const result = validateReportPackage(
      packageWith('<section class="made-up" onclick="boom()"><script>boom()</script></section>'),
      ["synthese"],
    );
    expect(result.valid).toBe(false);
    expect(result.findings.join("\n")).toContain("made-up");
    expect(result.findings.join("\n")).toContain("Event-Handler");
    expect(result.findings.join("\n")).toContain("<script>");
  });

  it("meldet fehlende Ressortseiten und Bild-Hooks", () => {
    const value = packageWith().replace(
      '<page slug="synthese" title="Entscheidung"><section class="news-block">Inhalt</section></page>',
      "",
    );
    const result = validateReportPackage(value.replaceAll("{{EDITORIAL_IMAGE}}", ""), ["synthese"]);
    expect(result.valid).toBe(false);
    expect(result.findings.join("\n")).toContain('Zeitungsseite "synthese"');
    expect(result.findings.join("\n")).toContain("EDITORIAL_IMAGE");
  });

  it("weist doppelte Zeitungs-URLs zurück", () => {
    const duplicate = packageWith().replace(
      "</newspaper>",
      '<page slug="synthese" title="Duplikat"><section class="news-block">Zwei</section></page></newspaper>',
    );
    const result = validateReportPackage(duplicate, ["synthese"]);

    expect(result.valid).toBe(false);
    expect(result.findings.join("\n")).toContain('"synthese" kommt 2-mal');
  });

  it("erlaubt lange Visual Reports mit dem Infografik-Vokabular", () => {
    const report = packageWith(
      `<section class="visual-section">
        <div class="visual-grid">
          <article class="visual-metric">
            <strong class="visual-metric__value">3</strong>
            <span class="visual-metric__label">Belegte Blocker</span>
          </article>
        </div>
      </section>`,
    ).replace(
      '<main class="onepaper-content"><div class="onepaper-panel">Befund</div></main>',
      `<main class="onepaper-content">
        <section class="visual-section">
          <div class="visual-chart"><div class="visual-chart__row">Beleg</div></div>
          <ol class="visual-timeline"><li class="visual-timeline__step">${"Befund ".repeat(
            600,
          )}</li></ol>
        </section>
      </main>`,
    );

    expect(validateReportPackage(report, ["synthese"])).toEqual({
      valid: true,
      findings: [],
    });
  });
});
