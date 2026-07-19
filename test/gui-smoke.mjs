import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.GUI_BASE_URL ?? "http://qa-council.localhost:1355";
const documentId = process.env.GUI_DOCUMENT_ID;
const runId = process.env.GUI_RUN_ID;
const cancelRunId = process.env.GUI_CANCEL_RUN_ID;
const newspaperId = process.env.GUI_NEWSPAPER_ID;
const onepaperId = process.env.GUI_ONEPAPER_ID;
const comparisonId = process.env.GUI_COMPARISON_ID;
const comparisonRunId = process.env.GUI_COMPARISON_RUN_ID;
const port = 9339;
const profile = await mkdtemp(path.join(os.tmpdir(), "qa-council-chromium-"));
const browser = spawn(
  process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--ignore-certificate-errors",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browserErrors = "";
browser.stderr.on("data", (data) => {
  browserErrors += String(data);
});

async function waitForBrowser() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chromium DevTools wurde nicht erreichbar.");
}

await waitForBrowser();
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
  method: "PUT",
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    errors.push(message.params.entry.text);
  }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(pathname) {
  await send("Page.navigate", { url: `${baseUrl}${pathname}` });
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  return evaluate(`({
    title: document.title,
    url: location.href,
    text: document.body.innerText,
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  })`);
}

async function waitFor(expression, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function screenshot(filename) {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path.join(os.tmpdir(), filename), Buffer.from(result.data, "base64")),
  );
}

const checks = [];
let archivedForTest = [];
let droppedDocumentId;
try {
  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
  let page = await navigate("/");
  for (const label of ["Prüfen", "Dokumente", "Läufe", "Testmodus", "Archiv", "Einstellungen"]) {
    assert(page.text.includes(label), `Menüpunkt ${label} fehlt.`);
  }
  assert(page.text.includes("Prüfung konfigurieren"), "Prüfkonfiguration fehlt.");
  checks.push("review");

  const droppedFileName = `drag-drop-smoke-${Date.now()}.md`;
  await evaluate(`(() => {
    const zone = document.querySelector(".review-page .upload-zone");
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      ["# Drag-and-drop smoke\\n\\n" + ${JSON.stringify(droppedFileName)}],
      ${JSON.stringify(droppedFileName)},
      {type: "text/markdown"}
    ));
    zone.dispatchEvent(new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
    window.__qaDropTransfer = transfer;
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const dragState = await evaluate(
    `document.querySelector(".review-page .upload-zone").classList.contains("upload-zone--dragging")`,
  );
  await evaluate(`(() => {
    const zone = document.querySelector(".review-page .upload-zone");
    zone.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__qaDropTransfer
    }));
    delete window.__qaDropTransfer;
    return true;
  })()`);
  assert(dragState, "Die Upload-Fläche zeigt beim Ziehen keinen aktiven Zustand.");
  await waitFor(
    `document.querySelector(".selected-document")?.textContent.includes(${JSON.stringify(
      droppedFileName,
    )})`,
    "Die abgelegte Markdown-Datei wurde nicht hochgeladen und ausgewählt.",
  );
  droppedDocumentId = await evaluate(
    `fetch("/api/documents").then((response) => response.json()).then(
      (documents) => documents.find((document) => document.name === ${JSON.stringify(
        droppedFileName,
      )})?.id
    )`,
  );
  assert(Boolean(droppedDocumentId), "Das abgelegte Testdokument fehlt in der API.");
  checks.push("document-drag-and-drop");

  page = await navigate("/tests");
  await waitFor(
    "document.querySelectorAll('.test-provider').length === 3",
    "Die drei Anbieter-Konfigurationen des Testmodus fehlen.",
  );
  assert(page.text.includes("Anbieter vergleichen"), "Testmodus-Seite fehlt.");
  assert(
    (await evaluate(
      "document.querySelectorAll('.test-provider .search-input[role=\\'combobox\\']').length",
    )) === 3,
    "Die durchsuchbare Modellauswahl fehlt bei mindestens einem Anbieter.",
  );
  checks.push("comparison-mode-model-search");

  if (comparisonId) {
    page = await navigate(`/tests/${comparisonId}`);
    await waitFor(
      "Boolean(document.querySelector('.comparison-columns'))",
      "Vergleichsdetail wurde nicht geladen.",
    );
    assert(
      (await evaluate("document.querySelectorAll('.comparison-provider').length")) >= 1,
      "Vergleich enthält keine Providerläufe.",
    );
    assert(page.url.endsWith(`/tests/${comparisonId}`), "Vergleichs-Direktreload verlor die URL.");
    checks.push("comparison-detail");
  }

  if (comparisonId && comparisonRunId) {
    page = await navigate(`/tests/${comparisonId}/runs/${comparisonRunId}`);
    await waitFor(
      "Boolean(document.querySelector('.run-layout'))",
      "Test-Worklog wurde nicht geladen.",
    );
    assert(page.text.includes("Vergleich"), "Test-Worklog hat keinen Rückweg zum Vergleich.");
    assert(
      page.url.endsWith(`/tests/${comparisonId}/runs/${comparisonRunId}`),
      "Test-Worklog liegt nicht unter der Testmodus-URL.",
    );
    checks.push("comparison-run-detail");
  }

  await navigate("/");
  await evaluate(`[...document.querySelectorAll(".sidebar nav a")]
    .find((button) => button.textContent.includes("Dokumente")).click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(
    (await evaluate("document.body.innerText")).includes("Hochgeladene Quellen"),
    "Dokumentseite fehlt.",
  );
  checks.push("documents-menu");

  await evaluate(`[...document.querySelectorAll(".sidebar nav a")]
    .find((button) => button.textContent.includes("Archiv")).click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(
    (await evaluate("document.body.innerText")).includes("Abgelegte Läufe"),
    "Archivseite fehlt.",
  );
  checks.push("archive-menu");

  await evaluate(`[...document.querySelectorAll(".sidebar nav a")]
    .find((button) => button.textContent.includes("Läufe")).click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(
    (await evaluate("document.body.innerText")).includes("Alle abgeschlossenen archivieren"),
    "Archivieren-Alle-Schaltfläche fehlt.",
  );
  checks.push("archive-all-button");
  if (process.env.GUI_TEST_ARCHIVE_ALL === "1") {
    archivedForTest = await evaluate(`fetch("/api/runs").then((response) => response.json()).then(
      (runs) => runs
        .filter((run) =>
          !run.archivedAt && ["completed", "failed", "cancelled"].includes(run.status)
        )
        .map((run) => run.id)
    )`);
    await evaluate(`[...document.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Alle abgeschlossenen archivieren")).click()`);
    await waitFor(
      "document.body.innerText.includes('archiviert')",
      "Die Oberfläche bestätigte das gemeinsame Archivieren nicht.",
    );
    await evaluate(`[...document.querySelectorAll(".sidebar nav a")]
      .find((button) => button.textContent.includes("Archiv")).click()`);
    await waitFor(
      `document.querySelectorAll(".archive-row").length >= ${archivedForTest.length}`,
      "Die gemeinsam archivierten Läufe fehlen im Archiv.",
    );
    checks.push("archive-all-action");
  }

  if (documentId) {
    page = await navigate(`/documents/${documentId}`);
    await waitFor(
      "Boolean(document.querySelector('.document-detail'))",
      "Dokumentdetail wurde nicht geladen.",
    );
    assert(
      page.text.includes("Extrahierter Inhalt"),
      "Dokumentdetail zeigt keinen extrahierten Inhalt.",
    );
    assert(page.text.includes("Erneut prüfen"), "Erneut-Prüfen-Aktion fehlt.");
    page = await navigate(`/documents/${documentId}`);
    assert(page.url.endsWith(`/documents/${documentId}`), "Dokument-Direktreload verlor die URL.");
    checks.push("document-detail-reload");
  }

  if (runId) {
    page = await navigate(`/runs/${runId}`);
    await waitFor("Boolean(document.querySelector('.run-layout'))", "Worklog wurde nicht geladen.");
    assert(page.text.includes("Report-Design ·"), "Report-Design-Stage fehlt im Worklog.");
    assert(
      await evaluate("document.body.textContent.includes('<report-package>')"),
      "Vollständige HTML-Modellausgabe fehlt im Worklog.",
    );
    checks.push("live-report-stage");
  }

  if (cancelRunId) {
    page = await navigate(`/runs/${cancelRunId}`);
    await waitFor("Boolean(document.querySelector('.run-layout'))", "Abbruch-Testlauf fehlt.");
    assert(page.text.includes("Lauf abbrechen"), "Abbruch-Aktion fehlt auf der Laufdetailseite.");
    await evaluate(`(() => {
      window.confirm = () => true;
      [...document.querySelectorAll(".run-toolbar__actions button")]
        .find((button) => button.textContent.includes("Lauf abbrechen")).click();
      return true;
    })()`);
    await waitFor(
      `document.body.innerText.includes("Abgebrochen")`,
      "Der Lauf wechselte nach dem Abbruch nicht in den terminalen Zustand.",
    );
    checks.push("cancel-run-detail");
  }

  if (newspaperId) {
    page = await navigate(`/results/${newspaperId}`);
    await waitFor(
      "Boolean(document.querySelector('.result--newspaper'))",
      "Zeitungs-Titelseite wurde nicht geladen.",
    );
    assert(page.text.includes("QA Council"), "Zeitungs-Masthead fehlt.");
    const links = await evaluate(
      `[...document.querySelectorAll(".newspaper-nav a")].map((link) => link.getAttribute("href"))`,
    );
    assert(
      links.length === 9,
      `Erwartet wurden 9 Zeitungsnavigationen, erhalten: ${links.length}.`,
    );
    assert(page.width <= page.viewport + 1, "Zeitungs-Titelseite hat horizontalen Overflow.");
    await screenshot("qa-council-newspaper-desktop.png");
    page = await navigate(`/results/${newspaperId}/synthese`);
    await waitFor(
      "Boolean(document.querySelector('.newspaper-page-footer'))",
      "Zeitungs-Unterseite wurde nicht geladen.",
    );
    assert(page.url.endsWith("/synthese"), "Zeitungs-Unterseite verlor ihren Slug.");
    const backLink = await evaluate(`({
      text: document.querySelector(".newspaper-page-footer a").textContent,
      href: document.querySelector(".newspaper-page-footer a").getAttribute("href")
    })`);
    assert(backLink.text.includes("Titelseite"), "Rücklink der Zeitungs-Unterseite fehlt.");
    assert(
      backLink.href === `/results/${newspaperId}`,
      "Rücklink verweist nicht auf die stabile Titelseiten-URL.",
    );
    checks.push("newspaper-routes");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    page = await navigate(`/results/${newspaperId}`);
    await waitFor(
      "Boolean(document.querySelector('.result--newspaper'))",
      "Mobile Zeitung wurde nicht geladen.",
    );
    assert(page.width <= page.viewport + 1, "Mobile Zeitung hat horizontalen Overflow.");
    await screenshot("qa-council-newspaper-mobile.png");
    await send("Emulation.clearDeviceMetricsOverride");
    checks.push("newspaper-mobile");
  }

  if (onepaperId) {
    page = await navigate(`/results/${onepaperId}`);
    await waitFor(
      "Boolean(document.querySelector('.onepaper-sheet'))",
      "One-Pager wurde nicht geladen.",
    );
    assert(
      page.text.includes("Decision") || page.text.includes("Entscheid"),
      "One-Pager-Inhalt fehlt.",
    );
    assert(
      Boolean(await evaluate("document.querySelector('.onepaper-sheet')")),
      "One-Paper-Sheet fehlt.",
    );
    await screenshot("qa-council-onepaper-desktop.png");
    checks.push("onepaper");
  }

  assert(errors.length === 0, `Browserfehler: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify({ ok: true, checks, errors, browserErrors: browserErrors.trim() }, null, 2),
  );
} finally {
  if (droppedDocumentId) {
    await evaluate(`fetch("/api/documents/${droppedDocumentId}", {method: "DELETE"})`).catch(
      () => {},
    );
  }
  if (cancelRunId) {
    await evaluate(`fetch("/api/runs/${cancelRunId}", {method: "DELETE"})`).catch(() => {});
  }
  if (archivedForTest.length) {
    await evaluate(`Promise.all(${JSON.stringify(archivedForTest)}.map((id) =>
      fetch("/api/runs/" + id + "/archive", {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({archived: false})
      })
    ))`).catch(() => {});
  }
  socket.close();
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
