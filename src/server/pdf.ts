import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

const baseDocumentCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { color: #171713; background: #e9e4d9; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .rendered-result { margin: 0 auto; }
`;

const printCss = `
  .result__masthead, .result-appendix, .result--onepaper > .result__full { display: none !important; }
  @media print {
    @page { size: A4; margin: 10mm; }
    body { background: #fff; }
    .onepaper-sheet, .visual-section, .visual-panel, .visual-metric,
    .visual-timeline__step, .visual-flow__step { break-inside: avoid; }
    .onepaper-sheet { box-shadow: none !important; }
  }
`;

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderedResultClassFor(html: string) {
  return html.includes("data-report-workspace")
    ? "rendered-result rendered-result--authored"
    : "rendered-result";
}

async function loadApplicationCss() {
  const sourcePath = path.resolve("src/web/styles.css");
  try {
    return await fs.readFile(sourcePath, "utf8");
  } catch {
    const assetDirectory = path.resolve("dist/web/assets");
    const assets = await fs.readdir(assetDirectory);
    const cssFile = assets.find((file) => file.endsWith(".css"));
    return cssFile ? await fs.readFile(path.join(assetDirectory, cssFile), "utf8") : "";
  }
}

async function temporaryDocument(html: string, title: string, prefix: string, extraCss = "") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const inputPath = path.join(directory, "presentation.html");
  const css = await loadApplicationCss();
  const renderedResultClass = renderedResultClassFor(html);
  await fs.writeFile(
    inputPath,
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title><style>${css}\n${baseDocumentCss}\n${extraCss}</style></head><body><div class="${renderedResultClass}">${html}</div></body></html>`,
    "utf8",
  );
  return { directory, inputPath };
}

function chromium() {
  return process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
}

export async function createPresentationPdf(html: string, title: string) {
  const { directory, inputPath } = await temporaryDocument(
    html,
    title,
    "qa-council-pdf-",
    printCss,
  );
  const outputPath = path.join(directory, "presentation.pdf");
  try {
    await execute(
      chromium(),
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-crash-reporter",
        "--disable-breakpad",
        "--print-to-pdf-no-header",
        `--print-to-pdf=${outputPath}`,
        pathToFileURL(inputPath).href,
      ],
      { env: { ...process.env, HOME: directory }, maxBuffer: 10 * 1024 * 1024 },
    );
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function createPresentationScreenshot(
  html: string,
  title: string,
  viewport: { width: number; height: number },
  signal?: AbortSignal,
) {
  const { directory, inputPath } = await temporaryDocument(html, title, "qa-council-shot-");
  const outputPath = path.join(directory, "presentation.png");
  try {
    await execute(
      chromium(),
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-crash-reporter",
        "--disable-breakpad",
        "--hide-scrollbars",
        `--window-size=${viewport.width},${viewport.height}`,
        `--screenshot=${outputPath}`,
        pathToFileURL(inputPath).href,
      ],
      {
        env: { ...process.env, HOME: directory },
        maxBuffer: 10 * 1024 * 1024,
        signal,
        timeout: 60_000,
      },
    );
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
