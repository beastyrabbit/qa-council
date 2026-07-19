/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import {
  Archive,
  CircleAlert,
  FlaskConical,
  FolderOpen,
  type LucideIcon,
  Newspaper,
  Settings,
  Sheet,
  WifiOff,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import { ConfirmDialog, type ConfirmRequest } from "./components/ViewShared";
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
  return (
    <footer className="fixed right-2.5 bottom-2 z-50">
      <Badge variant="outline" className="bg-background/90 font-mono text-[10px] tracking-wide">
        Version: {__APP_VERSION__}
      </Badge>
    </footer>
  );
}

const NAV_GROUPS: {
  label: string;
  items: { view: MainView; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: "Arbeit",
    items: [
      { view: "review", label: "Prüfen", icon: Sheet },
      { view: "documents", label: "Dokumente", icon: FolderOpen },
      { view: "runs", label: "Läufe", icon: Newspaper },
      { view: "archive", label: "Archiv", icon: Archive },
    ],
  },
  {
    label: "System",
    items: [
      { view: "tests", label: "Testmodus", icon: FlaskConical },
      { view: "settings", label: "Einstellungen", icon: Settings },
    ],
  },
];

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "cancelling", "waiting_for_input"]);

function AppSidebar({
  view,
  runs,
  navigateView,
  openRun,
}: {
  view: MainView;
  runs: RunRecord[];
  navigateView: (view: MainView) => void;
  openRun: (id: string) => void;
}) {
  const { setOpenMobile } = useSidebar();
  const activeRuns = runs.filter((run) => !run.archivedAt && ACTIVE_RUN_STATUSES.has(run.status));
  return (
    <Sidebar collapsible="offcanvas" className="sidebar">
      <SidebarHeader>
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">
            QC
          </div>
          <div className="flex flex-col">
            <strong className="font-heading text-sm leading-tight">QA Council</strong>
            <span className="text-xs text-muted-foreground">Prüfwerkstatt</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.view}>
                      <SidebarMenuButton
                        isActive={view === item.view}
                        render={
                          <a
                            href={VIEW_PATHS[item.view]}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                              event.preventDefault();
                              navigateView(item.view);
                              setOpenMobile(false);
                            }}
                          />
                        }
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
        {activeRuns.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Aktive Läufe</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {activeRuns.slice(0, 4).map((run) => {
                  const waiting = run.status === "waiting_for_input";
                  return (
                    <SidebarMenuItem key={run.id}>
                      <SidebarMenuButton
                        render={
                          <a
                            href={`/laeufe/${run.id}`}
                            title={run.documentName}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                              event.preventDefault();
                              openRun(run.id);
                              setOpenMobile(false);
                            }}
                          />
                        }
                      >
                        {waiting ? (
                          <CircleAlert className="animate-pulse text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Spinner />
                        )}
                        <span>{run.documentName}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge>
                        {waiting ? "Rückfrage" : `${run.progress} %`}
                      </SidebarMenuBadge>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-xs text-muted-foreground">
          Skill-Quellen werden bei jedem Lauf hash-geprüft.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

export function App() {
  const initialRoute = routeFromPath();
  const [view, setView] = useState<MainView>(initialRoute.view);
  const [connectionLost, setConnectionLost] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
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
          setConnectionLost(false);
        })
        .catch(() => setConnectionLost(true));
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

  function removeDocument(id: string) {
    const name = documents.find((doc) => doc.id === id)?.name ?? "Dokument";
    setConfirmRequest({
      title: "Dokument löschen?",
      description: `„${name}“ wird mitsamt zugehörigen Läufen dauerhaft entfernt.`,
      confirmLabel: "Dauerhaft löschen",
      action: async () => {
        await api(`/api/documents/${id}`, { method: "DELETE" });
        if (selected === id) setSelected("");
        await load();
      },
    });
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
    if (result.archived) {
      toast.success(`${result.archived} abgeschlossene Läufe archiviert.`);
    } else {
      toast.info("Keine weiteren abgeschlossenen Läufe zum Archivieren.");
    }
    await load();
  }

  function deleteStoppedRun(run: RunRecord) {
    if (!["failed", "cancelled"].includes(run.status)) return;
    const label = run.status === "failed" ? "Fehlgeschlagenen" : "Abgebrochenen";
    setConfirmRequest({
      title: `${label} Lauf löschen?`,
      description: `Der Lauf für „${run.documentName}“ wird dauerhaft gelöscht.`,
      confirmLabel: "Dauerhaft löschen",
      action: async () => {
        await api(`/api/runs/${run.id}`, { method: "DELETE" });
        await load();
      },
    });
  }

  const selectedDocument = documents.find((doc) => doc.id === selected);
  const providerConfigured = settings?.providers[provider].configured ?? false;
  const latestRunByDocument = useMemo(
    () => new Map(runs.filter((run) => !run.archivedAt).map((run) => [run.documentId, run])),
    [runs],
  );

  const overlays = (
    <>
      <Toaster position="bottom-right" />
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      {connectionLost && (
        <div className="fixed bottom-2 left-2 z-50">
          <Badge variant="destructive" className="gap-1.5">
            <WifiOff className="size-3" /> Verbindung unterbrochen
          </Badge>
        </div>
      )}
      <VersionFooter />
    </>
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
        {overlays}
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
        {overlays}
      </>
    );
  }

  const openComparisonRecord = comparisonId
    ? comparisons.find((item) => item.id === comparisonId)
    : undefined;

  let content: ReactNode = null;
  if (documentId) {
    content = (
      <DocumentView
        id={documentId}
        onBack={closeDocument}
        onReview={reviewDocument}
        onRun={openRun}
      />
    );
  } else if (detailId) {
    content = (
      <RunView
        id={detailId}
        onBack={comparisonId ? () => openComparison(comparisonId) : closePage}
        onChanged={() => void load()}
        onResult={openResult}
        onFile={(nextArtifactId, nextAttempt) => openFile(detailId, nextArtifactId, nextAttempt)}
        backLabel={comparisonId ? "Vergleich" : "Läufe"}
      />
    );
  } else if (openComparisonRecord) {
    content = (
      <ComparisonView
        comparison={openComparisonRecord}
        onBack={closeComparison}
        onRun={openComparisonRun}
        onResult={(runId) => void openRunResult(runId)}
      />
    );
  } else {
    content = (
      <>
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
      </>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar view={view} runs={runs} navigateView={navigateView} openRun={openRun} />
        <SidebarInset className="min-w-0">
          <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
            <SidebarTrigger />
            <span className="font-heading text-sm font-semibold">QA Council</span>
          </header>
          {content}
        </SidebarInset>
        {overlays}
      </SidebarProvider>
    </TooltipProvider>
  );
}
