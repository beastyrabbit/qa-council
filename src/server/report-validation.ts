const REPORT_CLASSES = new Set([
  "news-layout",
  "news-layout--lead",
  "news-layout--split",
  "news-layout--columns",
  "news-layout--sidebar",
  "news-block",
  "news-block--lead",
  "news-card",
  "news-wide",
  "news-section-head",
  "news-kicker",
  "news-summary",
  "news-pullquote",
  "news-list",
  "news-data",
  "news-priority",
  "news-evidence",
  "news-byline",
  "news-article",
  "news-article__header",
  "news-article__body",
  "news-article__lede",
  "news-article__aside",
  "news-article__figure",
  "news-article__footer",
  "news-breaking",
  "news-hero",
  "news-hero__headline",
  "news-hero__deck",
  "news-pass",
  "news-pass__clip",
  "news-pass__eyebrow",
  "news-feature",
  "news-ribbon",
  "news-ticker",
  "news-teaser-grid",
  "news-teaser",
  "news-teaser__number",
  "news-signal",
  "news-score",
  "news-score--critical",
  "onepaper-sheet",
  "onepaper-title",
  "onepaper-content",
  "onepaper-grid",
  "onepaper-grid--asymmetric",
  "onepaper-panel",
  "onepaper-priority",
  "onepaper-kicker",
  "onepaper-decision",
  "onepaper-actions",
  "onepaper-meta",
  "onepaper-footer",
  "visual-report",
  "visual-hero",
  "visual-chat-header",
  "visual-avatar",
  "visual-online",
  "visual-message",
  "visual-message--coral",
  "visual-message--teal",
  "visual-thread",
  "visual-headline",
  "visual-composer",
  "visual-send",
  "visual-section",
  "visual-grid",
  "visual-grid--wide",
  "visual-panel",
  "visual-panel--dark",
  "visual-metric",
  "visual-metric__value",
  "visual-metric__label",
  "visual-chart",
  "visual-chart__row",
  "visual-timeline",
  "visual-timeline__step",
  "visual-matrix",
  "visual-matrix__item",
  "visual-flow",
  "visual-flow__step",
  "visual-callout",
  "visual-evidence",
  "visual-image",
  "visual-image--dark",
  "visual-image-thread",
  "visual-caption",
  "visual-spark",
  "visual-emote-grid",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr"]);
const FORBIDDEN_TAGS = ["script", "style", "svg", "canvas", "iframe", "form", "input"];

export interface ReportValidationResult {
  valid: boolean;
  findings: string[];
}

export function normalizeReportPackage(source: string) {
  const trimmed = source.trim();
  return trimmed.match(/^```(?:[a-z0-9_-]+)?\s*\n([\s\S]*?)\n```$/i)?.[1]?.trim() ?? trimmed;
}

function transportContent(source: string, tag: string) {
  return source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
}

function checkBalancedHtml(fragment: string, label: string, findings: string[]) {
  const stack: string[] = [];
  for (const match of fragment.matchAll(/<\/?([a-z][\w-]*)(?:\s[^<>]*?)?\/?>/gi)) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (VOID_TAGS.has(tag) || full.endsWith("/>")) continue;
    if (!full.startsWith("</")) {
      stack.push(tag);
      continue;
    }
    const expected = stack.pop();
    if (expected !== tag) {
      findings.push(
        `HTML · ${label}: schließendes </${tag}> passt nicht zu ${
          expected ? `<${expected}>` : "einem geöffneten Element"
        }.`,
      );
      return;
    }
  }
  if (stack.length) {
    findings.push(`HTML · ${label}: nicht geschlossene Elemente: ${stack.join(", ")}.`);
  }
}

function checkFragment(fragment: string, label: string, findings: string[]) {
  checkBalancedHtml(fragment, label, findings);
  for (const tag of FORBIDDEN_TAGS) {
    if (new RegExp(`<\\/?${tag}\\b`, "i").test(fragment)) {
      findings.push(`JavaScript/Sicherheit · ${label}: <${tag}> ist nicht erlaubt.`);
    }
  }
  if (/\son[a-z]+\s*=/i.test(fragment)) {
    findings.push(`JavaScript/Sicherheit · ${label}: Event-Handler-Attribute sind nicht erlaubt.`);
  }
  if (/\b(?:href|src)\s*=\s*["']\s*javascript:/i.test(fragment)) {
    findings.push(`JavaScript/Sicherheit · ${label}: javascript:-URLs sind nicht erlaubt.`);
  }
  if (/\sstyle\s*=/i.test(fragment)) {
    findings.push(`CSS · ${label}: Inline-Styles sind nicht erlaubt.`);
  }
  const unknownClasses = new Set<string>();
  for (const match of fragment.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)) {
    for (const className of match[1].split(/\s+/).filter(Boolean)) {
      if (!REPORT_CLASSES.has(className)) unknownClasses.add(className);
    }
  }
  if (unknownClasses.size) {
    findings.push(
      `CSS · ${label}: unbekannte oder nicht gestaltete Klassen: ${[...unknownClasses].join(", ")}.`,
    );
  }
}

export function validateReportPackage(
  source: string,
  expectedPageSlugs: string[],
): ReportValidationResult {
  source = normalizeReportPackage(source);
  const findings: string[] = [];
  if (/```/.test(source)) findings.push("Struktur · Markdown-Fences sind nicht erlaubt.");
  if (!/<report-package>[\s\S]*<\/report-package>/i.test(source)) {
    findings.push("Struktur · <report-package> fehlt oder ist nicht geschlossen.");
  }
  const imageBrief = transportContent(source, "image-brief").trim();
  const newspaper = transportContent(source, "newspaper");
  const front = transportContent(newspaper, "front").trim();
  const onepaper = transportContent(source, "onepaper").trim();
  if (!imageBrief) findings.push("Struktur · Das dokumentbezogene <image-brief> fehlt.");
  if (!front) findings.push("Struktur · Die Zeitungs-Titelseite <front> fehlt.");
  if (!onepaper) findings.push("Struktur · Der visuelle HTML-Report fehlt.");

  const pages = [...newspaper.matchAll(/<page\s+([^>]+)>([\s\S]*?)<\/page>/gi)].map((match) => ({
    slug: match[1].match(/\bslug\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? "",
    title: match[1].match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? "",
    html: match[2].trim(),
  }));
  const actualSlugs = pages.map((page) => page.slug);
  for (const slug of new Set(actualSlugs.filter(Boolean))) {
    const count = actualSlugs.filter((candidate) => candidate === slug).length;
    if (count > 1) {
      findings.push(`Struktur · Zeitungsseite "${slug}" kommt ${count}-mal statt einmal vor.`);
    }
  }
  for (const slug of expectedPageSlugs) {
    const count = actualSlugs.filter((candidate) => candidate === slug).length;
    if (count !== 1) {
      findings.push(
        `Struktur · Zeitungsseite "${slug}" muss genau einmal vorkommen, gefunden: ${count}.`,
      );
    }
  }
  for (const page of pages) {
    if (!expectedPageSlugs.includes(page.slug)) {
      findings.push(`Struktur · Unerwartete Zeitungsseite "${page.slug || "(ohne Slug)"}".`);
    }
    if (!page.title) findings.push(`Struktur · Seite "${page.slug}" hat keinen title.`);
    if (!page.html) findings.push(`Struktur · Seite "${page.slug}" enthält kein HTML.`);
  }

  const frontImages = (front.match(/\{\{EDITORIAL_IMAGE\}\}/g) ?? []).length;
  const onepaperImages = (onepaper.match(/\{\{EDITORIAL_IMAGE\}\}/g) ?? []).length;
  if (frontImages !== 1) {
    findings.push(
      `Struktur · Die Titelseite braucht genau einen {{EDITORIAL_IMAGE}}-Hook, gefunden: ${frontImages}.`,
    );
  }
  if (onepaperImages !== 1) {
    findings.push(
      `Struktur · Der Visual Report braucht genau einen {{EDITORIAL_IMAGE}}-Hook, gefunden: ${onepaperImages}.`,
    );
  }
  for (const hook of [
    "onepaper-sheet",
    "visual-report",
    "onepaper-title",
    "onepaper-content",
    "onepaper-footer",
  ]) {
    if (!new RegExp(`class\\s*=\\s*["'][^"']*\\b${hook}\\b`, "i").test(onepaper)) {
      findings.push(`CSS/Struktur · Dem Visual Report fehlt die erforderliche Klasse "${hook}".`);
    }
  }

  if (front) checkFragment(front, "Titelseite", findings);
  for (const page of pages) checkFragment(page.html, `Zeitungsseite ${page.slug}`, findings);
  if (onepaper) checkFragment(onepaper, "Visual Report", findings);

  return { valid: findings.length === 0, findings: [...new Set(findings)] };
}
