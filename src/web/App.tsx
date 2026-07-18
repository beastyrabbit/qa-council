/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { Archive, FlaskConical, FolderOpen, Menu, Newspaper, Settings, Sheet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  ComparisonRecord,
  CouncilMode,
  DocumentRecord,
  PresentationKind,
  ProviderId,
  RunDetails,
  RunRecord,
} from "../shared/types";
import {
  ComparisonView,
  DocumentView,
  ResultView,
  RunView,
  SettingsView,
  TestModeView,
  useFileDrop,
} from "./components/AppViews";
import { FileReader } from "./components/FileReader";
import {
  ArchiveView,
  DocumentsListView,
  ReviewComposerView,
  RunsListView,
} from "./components/WorkspaceViews";
import { api } from "./lib/api";

type MainView = "review" | "documents" | "runs" | "tests" | "archive" | "settings";

const VIEW_PATHS: Record<MainView, string> = {
  review: "/pruefen",
  documents: "/dokumente",
  runs: "/laeufe",
  tests: "/tests",
  archive: "/archiv",
  settings: "/einstellungen",
};

export function routeFromPath(
  pathname = typeof window === "undefined" ? "/" : window.location.pathname,
  search = typeof window === "undefined" ? "" : window.location.search,
) {
  const file = pathname.match(/^\/(?:laeufe|runs)\/([^/]+)\/dateien\/([^/]+)$/);
  const run = pathname.match(/^\/(?:laeufe|runs)\/([^/]+)$/);
  const comparisonRun = pathname.match(/^\/tests\/([^/]+)\/runs\/([^/]+)$/);
  const comparison = pathname.match(/^\/tests\/([^/]+)$/);
  const document = pathname.match(/^\/(?:dokumente|documents)\/([^/]+)$/);
  const result = pathname.match(/^\/results\/([^/]+)(?:\/([^/]+))?$/);
  const view: MainView =
    pathname === "/dokumente" || pathname === "/documents" || document
      ? "documents"
      : pathname === "/laeufe" || pathname === "/runs" || run
        ? "runs"
        : pathname === "/tests" || comparisonRun || comparison
          ? "tests"
          : pathname === "/archiv"
            ? "archive"
            : pathname === "/einstellungen"
              ? "settings"
              : "review";
  return {
    view,
    runId: run?.[1] ?? comparisonRun?.[2] ?? null,
    comparisonId: comparisonRun?.[1] ?? comparison?.[1] ?? null,
    documentId: document?.[1] ?? null,
    presentationId: result?.[1] ?? null,
    presentationPage: result?.[2] ?? null,
    fileRunId: file?.[1] ?? null,
    artifactId: file?.[2] ?? null,
    fileAttempt: Number(new URLSearchParams(search).get("attempt")) || null,
  };
}

function VersionFooter() {
  return <footer className="app-version">Version: {__APP_VERSION__}</footer>;
}

export function App() {
  const initialRoute = routeFromPath();
  const [view, setView] = useState<MainView>(initialRoute.view);
  const [mobileNav, setMobileNav] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState<ProviderId>("codex");
  const [model, setModel] = useState("");
  const [modelAvailable, setModelAvailable] = useState(false);
  const [format, setFormat] = useState<PresentationKind>("text");
  const [mode, setMode] = useState<CouncilMode>("auto");
  const [focus, setFocus] = useState("");
  const [useComfyUiImage, setUseComfyUiImage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(initialRoute.documentId);
  const [detailId, setDetailId] = useState<string | null>(initialRoute.runId);
  const [comparisonId, setComparisonId] = useState<string | null>(initialRoute.comparisonId);
  const [resultId, setResultId] = useState<string | null>(initialRoute.presentationId);
  const [resultPage, setResultPage] = useState<string | null>(initialRoute.presentationPage);
  const [fileRunId, setFileRunId] = useState<string | null>(initialRoute.fileRunId);
  const [artifactId, setArtifactId] = useState<string | null>(initialRoute.artifactId);
  const [fileAttempt, setFileAttempt] = useState<number | null>(initialRoute.fileAttempt);

  const load = useCallback(async () => {
    const [docs, runItems, comparisonItems, appSettings] = await Promise.all([
      api<DocumentRecord[]>("/api/documents"),
      api<RunRecord[]>("/api/runs"),
      api<ComparisonRecord[]>("/api/comparisons"),
      api<AppSettings>("/api/settings"),
    ]);
    setDocuments(docs);
    setRuns(runItems);
    setComparisons(comparisonItems);
    setSettings(appSettings);
    setSelected((current) => current || docs.find((doc) => doc.status !== "extracting")?.id || "");
  }, []);

  useEffect(() => {
    void load().catch((reason) => setMessage(reason.message));
    const timer = window.setInterval(() => {
      void Promise.all([
        api<DocumentRecord[]>("/api/documents"),
        api<RunRecord[]>("/api/runs"),
        api<ComparisonRecord[]>("/api/comparisons"),
      ])
        .then(([documentItems, runItems, comparisonItems]) => {
          setDocuments(documentItems);
          setRuns(runItems);
          setComparisons(comparisonItems);
        })
        .catch((reason) => setMessage(reason instanceof Error ? reason.message : String(reason)));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState({}, "", VIEW_PATHS.review);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const route = routeFromPath();
      setDocumentId(route.documentId);
      setDetailId(route.runId);
      setComparisonId(route.comparisonId);
      setResultId(route.presentationId);
      setResultPage(route.presentationPage);
      setFileRunId(route.fileRunId);
      setArtifactId(route.artifactId);
      setFileAttempt(route.fileAttempt);
      setView(route.view);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateView = useCallback((nextView: MainView) => {
    window.history.pushState({}, "", VIEW_PATHS[nextView]);
    setDocumentId(null);
    setDetailId(null);
    setComparisonId(null);
    setResultId(null);
    setResultPage(null);
    setFileRunId(null);
    setArtifactId(null);
    setFileAttempt(null);
    setView(nextView);
    setMobileNav(false);
  }, []);

  const openRun = useCallback((id: string) => {
    window.history.pushState({}, "", `/laeufe/${id}`);
    setDocumentId(null);
    setResultId(null);
    setResultPage(null);
    setDetailId(id);
    setComparisonId(null);
    setFileRunId(null);
    setArtifactId(null);
    setFileAttempt(null);
  }, []);

  const openFile = useCallback((runId: string, nextArtifactId: string, attempt: number) => {
    window.history.pushState(
      {},
      "",
      `/laeufe/${runId}/dateien/${nextArtifactId}?attempt=${attempt}`,
    );
    setDocumentId(null);
    setDetailId(null);
    setComparisonId(null);
    setResultId(null);
    setResultPage(null);
    setFileRunId(runId);
    setArtifactId(nextArtifactId);
    setFileAttempt(attempt);
  }, []);

  const openComparison = useCallback((id: string) => {
    window.history.pushState({}, "", `/tests/${id}`);
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setComparisonId(id);
    setView("tests");
  }, []);

  const openComparisonRun = useCallback(
    (runId: string) => {
      if (!comparisonId) return;
      window.history.pushState({}, "", `/tests/${comparisonId}/runs/${runId}`);
      setDocumentId(null);
      setResultId(null);
      setResultPage(null);
      setDetailId(runId);
    },
    [comparisonId],
  );

  const openResult = useCallback((id: string) => {
    window.history.pushState({}, "", `/results/${id}`);
    setDocumentId(null);
    setDetailId(null);
    setResultId(id);
    setResultPage(null);
    setComparisonId(null);
    setFileRunId(null);
    setArtifactId(null);
    setFileAttempt(null);
  }, []);

  const openDocument = useCallback((id: string) => {
    window.history.pushState({}, "", `/dokumente/${id}`);
    setDetailId(null);
    setComparisonId(null);
    setResultId(null);
    setResultPage(null);
    setDocumentId(id);
  }, []);

  const closePage = useCallback(() => {
    window.history.pushState({}, "", VIEW_PATHS.runs);
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setComparisonId(null);
    setView("runs");
  }, []);

  const closeDocument = useCallback(() => {
    window.history.pushState({}, "", VIEW_PATHS.documents);
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setView("documents");
  }, []);

  const reviewDocument = useCallback((id: string) => {
    window.history.pushState({}, "", VIEW_PATHS.review);
    setSelected(id);
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setView("review");
  }, []);

  const closeComparison = useCallback(() => {
    window.history.pushState({}, "", "/tests");
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setComparisonId(null);
    setView("tests");
  }, []);

  useEffect(() => {
    if (settings) setModel(settings.providers[provider].model);
  }, [provider, settings]);

  const canUseComfyUiImage =
    provider === "aibox" && Boolean(settings?.comfyui.enabled && settings.comfyui.configured);

  useEffect(() => {
    if (!canUseComfyUiImage) setUseComfyUiImage(false);
  }, [canUseComfyUiImage]);

  async function uploadFile(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage("");
    const body = new FormData();
    body.append("file", file);
    try {
      const document = await api<DocumentRecord>("/api/documents", { method: "POST", body });
      await load();
      setSelected(document.id);
      if (document.status === "failed") {
        setMessage(document.error ?? "Die vorherige Extraktion war fehlgeschlagen.");
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }
  const reviewFileDrop = useFileDrop((file) => void uploadFile(file), uploading);

  async function startRun() {
    if (!selected || !model) return;
    setMessage("");
    try {
      const run = await api<{ id: string }>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: selected,
          provider,
          model,
          mode,
          presentation: format,
          imageProvider:
            provider === "codex"
              ? "openai"
              : provider === "openrouter"
                ? "openrouter"
                : useComfyUiImage
                  ? "comfyui"
                  : null,
          focus: focus || undefined,
        }),
      });
      openRun(run.id);
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function removeDocument(id: string) {
    await api(`/api/documents/${id}`, { method: "DELETE" });
    if (selected === id) setSelected("");
    await load();
  }

  async function openRunResult(id: string) {
    try {
      const details = await api<RunDetails>(`/api/runs/${id}`);
      const presentation = details.presentations[0];
      if (presentation) openResult(presentation.id);
      else openRun(id);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function archiveRun(run: RunRecord, archived: boolean) {
    await api(`/api/runs/${run.id}/archive`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    await load();
  }

  async function archiveAllRuns() {
    const result = await api<{ archived: number }>("/api/runs/archive-all", { method: "PUT" });
    setMessage(
      result.archived
        ? `${result.archived} abgeschlossene Läufe archiviert.`
        : "Keine weiteren abgeschlossenen Läufe zum Archivieren.",
    );
    await load();
  }

  async function deleteStoppedRun(run: RunRecord) {
    if (!["failed", "cancelled"].includes(run.status)) return;
    const label = run.status === "failed" ? "Fehlgeschlagenen" : "Abgebrochenen";
    if (!window.confirm(`${label} Lauf für „${run.documentName}“ dauerhaft löschen?`)) return;
    await api(`/api/runs/${run.id}`, { method: "DELETE" });
    await load();
  }

  const selectedDocument = documents.find((doc) => doc.id === selected);
  const providerConfigured = settings?.providers[provider].configured ?? false;
  const latestRunByDocument = useMemo(
    () => new Map(runs.filter((run) => !run.archivedAt).map((run) => [run.documentId, run])),
    [runs],
  );

  if (resultId) {
    return (
      <>
        <ResultView
          presentationId={resultId}
          pageSlug={resultPage}
          onBack={closePage}
          onPresentationChange={openResult}
        />
        <VersionFooter />
      </>
    );
  }
  if (fileRunId && artifactId) {
    return (
      <>
        <FileReader
          runId={fileRunId}
          artifactId={artifactId}
          initialAttempt={fileAttempt ?? undefined}
          onBack={() => openRun(fileRunId)}
          onFileChange={(nextArtifactId, nextAttempt) =>
            openFile(fileRunId, nextArtifactId, nextAttempt)
          }
        />
        <VersionFooter />
      </>
    );
  }
  if (documentId) {
    return (
      <>
        <DocumentView
          id={documentId}
          onBack={closeDocument}
          onReview={reviewDocument}
          onRun={openRun}
        />
        <VersionFooter />
      </>
    );
  }
  if (detailId) {
    return (
      <>
        <RunView
          id={detailId}
          onBack={comparisonId ? () => openComparison(comparisonId) : closePage}
          onChanged={() => void load()}
          onResult={openResult}
          onFile={(nextArtifactId, nextAttempt) => openFile(detailId, nextArtifactId, nextAttempt)}
          backLabel={comparisonId ? "Vergleich" : "Läufe"}
        />
        <VersionFooter />
      </>
    );
  }
  if (comparisonId) {
    const comparison = comparisons.find((item) => item.id === comparisonId);
    if (comparison) {
      return (
        <>
          <ComparisonView
            comparison={comparison}
            onBack={closeComparison}
            onRun={openComparisonRun}
            onResult={(runId) => void openRunResult(runId)}
          />
          <VersionFooter />
        </>
      );
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar--open" : ""}`}>
        <div className="brand">
          <div className="brand__mark">QC</div>
          <div>
            <strong>QA Council</strong>
            <span>Prüfwerkstatt</span>
          </div>
        </div>
        <nav>
          <button
            type="button"
            className={view === "review" ? "active" : ""}
            onClick={() => navigateView("review")}
          >
            <Sheet size={18} /> Prüfen
          </button>
          <button
            type="button"
            className={view === "documents" ? "active" : ""}
            onClick={() => navigateView("documents")}
          >
            <FolderOpen size={18} /> Dokumente
          </button>
          <button
            type="button"
            className={view === "runs" ? "active" : ""}
            onClick={() => navigateView("runs")}
          >
            <Newspaper size={18} /> Läufe
          </button>
          <button
            type="button"
            className={view === "tests" ? "active" : ""}
            onClick={() => navigateView("tests")}
          >
            <FlaskConical size={18} /> Testmodus
          </button>
          <button
            type="button"
            className={view === "archive" ? "active" : ""}
            onClick={() => navigateView("archive")}
          >
            <Archive size={18} /> Archiv
          </button>
          <button
            type="button"
            className={view === "settings" ? "active" : ""}
            onClick={() => navigateView("settings")}
          >
            <Settings size={18} /> Einstellungen
          </button>
        </nav>
        <div className="sidebar__foot">Skill-Quellen werden bei jedem Lauf hash-geprüft.</div>
      </aside>
      <main className="workspace">
        <button className="mobile-menu" type="button" onClick={() => setMobileNav(!mobileNav)}>
          <Menu size={20} /> QA Council
        </button>
        {view === "settings" && settings ? (
          <SettingsView settings={settings} onSaved={setSettings} />
        ) : null}
        {view === "tests" && settings ? (
          <TestModeView
            settings={settings}
            documents={documents}
            comparisons={comparisons}
            onChanged={load}
            onOpen={openComparison}
          />
        ) : null}
        {view === "documents" && (
          <DocumentsListView
            documents={documents}
            latestRunByDocument={latestRunByDocument}
            openDocument={openDocument}
            reviewDocument={reviewDocument}
            removeDocument={removeDocument}
          />
        )}
        {view === "review" && (
          <ReviewComposerView
            uploading={uploading}
            reviewFileDrop={reviewFileDrop}
            uploadFile={uploadFile}
            message={message}
            selectedDocument={selectedDocument}
            navigateDocuments={() => navigateView("documents")}
            clearSelected={() => setSelected("")}
            provider={provider}
            setProvider={setProvider}
            setModelAvailable={setModelAvailable}
            providerConfigured={providerConfigured}
            model={model}
            setModel={setModel}
            mode={mode}
            setMode={setMode}
            format={format}
            setFormat={setFormat}
            focus={focus}
            setFocus={setFocus}
            canUseComfyUiImage={canUseComfyUiImage}
            useComfyUiImage={useComfyUiImage}
            setUseComfyUiImage={setUseComfyUiImage}
            settings={settings}
            selected={selected}
            modelAvailable={modelAvailable}
            startRun={startRun}
          />
        )}
        {view === "runs" && (
          <RunsListView
            runs={runs}
            message={message}
            archiveAllRuns={archiveAllRuns}
            openRun={openRun}
            openRunResult={openRunResult}
            archiveRun={archiveRun}
            deleteStoppedRun={deleteStoppedRun}
          />
        )}
        {view === "archive" && (
          <ArchiveView
            runs={runs}
            openRun={openRun}
            archiveRun={archiveRun}
            deleteStoppedRun={deleteStoppedRun}
          />
        )}
      </main>
      <VersionFooter />
    </div>
  );
}
