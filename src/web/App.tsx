/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Beide HTML-Ausgaben werden serverseitig per expliziter Tag-, Attribut- und URL-Allowlist sanitisiert. */
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  FileText,
  FlaskConical,
  FolderOpen,
  ListChecks,
  LoaderCircle,
  LogIn,
  Menu,
  Newspaper,
  Play,
  Search,
  Settings,
  Sheet,
  Square,
  Terminal,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AppSettings,
  ComparisonRecord,
  CouncilMode,
  DerivedAnalysisRecord,
  DocumentDetails,
  DocumentRecord,
  PresentationKind,
  ProviderId,
  ProviderModel,
  ReviewRecord,
  RunDetails,
  RunRecord,
} from "../shared/types";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: unknown;
    };
    throw new Error(typeof body.error === "string" ? body.error : JSON.stringify(body.error));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function useFileDrop(onFile: (file?: File) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  function preventBrowserOpen(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    dragging,
    onDragEnter(event: DragEvent<HTMLLabelElement>) {
      preventBrowserOpen(event);
      if (disabled) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver(event: DragEvent<HTMLLabelElement>) {
      preventBrowserOpen(event);
      if (!disabled) event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave(event: DragEvent<HTMLLabelElement>) {
      preventBrowserOpen(event);
      if (disabled) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop(event: DragEvent<HTMLLabelElement>) {
      preventBrowserOpen(event);
      dragDepth.current = 0;
      setDragging(false);
      if (!disabled) onFile(event.dataTransfer.files.item(0) ?? undefined);
    },
  };
}

const PROVIDER_NAMES: Record<ProviderId, string> = {
  codex: "Codex (serverseitig)",
  openrouter: "OpenRouter",
  aibox: "Lokale AI Box",
};

const FORMAT_NAMES: Record<PresentationKind, string> = {
  text: "HTML / Nur Text",
  newspaper: "QA-Tageszeitung",
  onepaper: "Visual Report",
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatModelPrice(value: number | undefined) {
  if (value === undefined) return "–";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

function routeFromPath(pathname = window.location.pathname) {
  const run = pathname.match(/^\/runs\/([^/]+)$/);
  const comparisonRun = pathname.match(/^\/tests\/([^/]+)\/runs\/([^/]+)$/);
  const comparison = pathname.match(/^\/tests\/([^/]+)$/);
  const document = pathname.match(/^\/documents\/([^/]+)$/);
  const result = pathname.match(/^\/results\/([^/]+)(?:\/([^/]+))?$/);
  return {
    runId: run?.[1] ?? comparisonRun?.[2] ?? null,
    comparisonId: comparisonRun?.[1] ?? comparison?.[1] ?? null,
    testMode: pathname === "/tests" || Boolean(comparisonRun || comparison),
    documentId: document?.[1] ?? null,
    presentationId: result?.[1] ?? null,
    presentationPage: result?.[2] ?? null,
  };
}

function Status({ run }: { run: RunRecord }) {
  if (run.status === "completed") return <span className="status status--done">Fertig</span>;
  if (run.status === "failed") return <span className="status status--error">Fehler</span>;
  if (run.status === "cancelling")
    return <span className="status status--cancelled">Wird abgebrochen …</span>;
  if (run.status === "cancelled")
    return <span className="status status--cancelled">Abgebrochen</span>;
  if (run.status === "waiting_for_input")
    return <span className="status status--wait">Rückfrage</span>;
  return <span className="status">{run.status === "queued" ? "Wartet" : `${run.progress} %`}</span>;
}

function SanitizedMarkdown({ html }: { html: string }) {
  return (
    <div
      className="model-output model-output--markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function VersionFooter() {
  return <footer className="app-version">Version: {__APP_VERSION__}</footer>;
}

const SYSTEM_EVENTS = new Set([
  "run_started",
  "council_composed",
  "input_required",
  "input_answered",
  "stage_retry",
  "debate_skipped",
  "compaction_start",
  "compaction_end",
  "final_created",
  "result_published",
  "report_workspace_scaffolded",
  "report_static_check_completed",
  "report_static_feedback_sent",
  "report_static_recheck_completed",
  "presentation_started",
  "presentation_completed",
  "image_generation_started",
  "image_generation_queued",
  "image_generation_reused",
  "image_generation_completed",
  "image_generation_failed",
  "image_generation_fallback",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "run_cancel_requested",
  "parallel_stage_group_started",
]);

function RunView({
  id,
  onBack,
  onResult,
  onChanged,
  backLabel = "Läufe",
}: {
  id: string;
  onBack: () => void;
  onResult: (presentationId: string) => void;
  onChanged: () => void;
  backLabel?: string;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [liveFollow, setLiveFollow] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    void api<RunDetails>(`/api/runs/${id}`)
      .then(setDetails)
      .catch((reason) => setError(reason.message));
  }, [id]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 750);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (
      !liveFollow ||
      !details ||
      ["completed", "failed", "cancelled"].includes(details.run.status)
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [details, liveFollow]);

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!details?.question || !answer.trim()) return;
    await api(`/api/runs/${id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: details.question.id, answer }),
    });
    setAnswer("");
    load();
  }

  async function toggleArchive() {
    if (!details) return;
    await api(`/api/runs/${id}/archive`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !details.run.archivedAt }),
    });
    await load();
    onChanged();
  }

  async function cancelActiveRun() {
    if (!activeRun) return;
    if (
      !window.confirm(
        "Diesen Lauf jetzt abbrechen? Bereits erzeugte Log-Ausgaben bleiben erhalten.",
      )
    )
      return;
    setCancelling(true);
    setError("");
    try {
      await api(`/api/runs/${id}/cancel`, { method: "POST" });
      load();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancelling(false);
    }
  }

  async function removeStoppedRun() {
    if (!details || !["failed", "cancelled"].includes(details.run.status)) return;
    const label = details.run.status === "failed" ? "fehlgeschlagenen" : "abgebrochenen";
    if (!window.confirm(`Diesen ${label} Lauf dauerhaft löschen?`)) return;
    await api(`/api/runs/${id}`, { method: "DELETE" });
    onChanged();
    onBack();
  }

  const councilEvent = details
    ? [...details.events].reverse().find((item) => item.type === "council_composed")
    : undefined;
  const roles =
    councilEvent?.data &&
    typeof councilEvent.data === "object" &&
    "roles" in councilEvent.data &&
    Array.isArray(councilEvent.data.roles)
      ? councilEvent.data.roles.filter((item): item is string => typeof item === "string")
      : [];
  const systemEvents = details?.events.filter((item) => SYSTEM_EVENTS.has(item.type)) ?? [];
  const activeRun =
    details?.run.status === "queued" ||
    details?.run.status === "running" ||
    details?.run.status === "waiting_for_input";

  return (
    <div className="run-page">
      <header className="run-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> {backLabel}
        </button>
        <div className="run-toolbar__title">
          <span>LIVE WORKLOG</span>
          <strong>{details?.run.documentName ?? "Lauf wird geladen …"}</strong>
        </div>
        <div className="run-toolbar__actions">
          {activeRun && (
            <button
              className="button button--danger"
              type="button"
              disabled={cancelling}
              onClick={() => void cancelActiveRun()}
            >
              <Square size={15} fill="currentColor" />
              {cancelling ? "Wird abgebrochen …" : "Lauf abbrechen"}
            </button>
          )}
          {details && ["completed", "failed", "cancelled"].includes(details.run.status) && (
            <button className="button button--quiet" type="button" onClick={toggleArchive}>
              <Archive size={16} />
              {details.run.archivedAt ? "Wiederherstellen" : "Archivieren"}
            </button>
          )}
          {details && ["failed", "cancelled"].includes(details.run.status) && (
            <button className="button button--danger" type="button" onClick={removeStoppedRun}>
              <Trash2 size={16} /> Löschen
            </button>
          )}
          {details?.presentations[0] && (
            <button
              className="button button--primary"
              type="button"
              onClick={() =>
                onResult(
                  details.presentations.find((item) => item.kind === "text")?.id ??
                    details.presentations[0].id,
                )
              }
            >
              {details.run.status === "completed" ? "Resultat öffnen" : "Text-Ergebnis öffnen"}
            </button>
          )}
        </div>
      </header>
      {error && <p className="notice notice--error">{error}</p>}
      {details && (
        <>
          <section className="run-overview">
            <div className="run-overview__summary">
              <Status run={details.run} />
              <div>
                <strong>{details.run.currentStage ?? "Initialisierung"}</strong>
                <span>
                  {PROVIDER_NAMES[details.run.provider]} · {details.run.model} ·{" "}
                  {details.run.resolvedMode ?? details.run.mode}
                  {details.run.imageProvider
                    ? ` · Bild: ${
                        details.run.imageProvider === "openai"
                          ? "OpenAI"
                          : details.run.imageProvider === "openrouter"
                            ? "OpenRouter"
                            : "ComfyUI"
                      }`
                    : ""}
                </span>
              </div>
              <b>{details.run.progress}%</b>
            </div>
            <progress max="100" value={details.run.progress} />
            <div className="agent-heading">
              <div>
                <Users size={17} />
                <strong>Council-Agenten</strong>
                <span>isolierte Fachrollen</span>
              </div>
              <small>{roles.length ? `${roles.length} Rollen` : "wird zusammengestellt"}</small>
            </div>
            <div className="agent-strip">
              {roles.map((role, index) => {
                const stage = details.stages.find((item) => item.role === role);
                const status = stage?.status ?? "queued";
                return (
                  <div className={`agent-card agent-card--${status}`} key={role}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{role}</strong>
                      <small>
                        {status === "running"
                          ? "arbeitet jetzt"
                          : status === "completed"
                            ? "Antwort vollständig"
                            : status === "failed"
                              ? "fehlgeschlagen"
                              : status === "cancelled"
                                ? "abgebrochen"
                                : "wartet"}
                      </small>
                    </div>
                  </div>
                );
              })}
              {roles.length === 0 && (
                <div className="agent-card agent-card--queued">
                  <span>··</span>
                  <div>
                    <strong>Triage läuft</strong>
                    <small>Rollen folgen nach der Risikoeinordnung</small>
                  </div>
                </div>
              )}
            </div>
          </section>

          {details.question && (
            <form className="run-question" onSubmit={submitAnswer}>
              <div>
                <strong>Der Council benötigt eine Angabe</strong>
                <p>{details.question.prompt}</p>
              </div>
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={3}
                required
                placeholder="Antwort für den laufenden Council"
              />
              <button className="button button--primary" type="submit">
                Antwort senden
              </button>
            </form>
          )}

          <div className="run-layout">
            <section className="live-console">
              <header>
                <div>
                  <Terminal size={17} />
                  <strong>Modellprotokoll</strong>
                  {activeRun && <span className="live-indicator">live</span>}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={liveFollow}
                    onChange={(event) => setLiveFollow(event.target.checked)}
                  />
                  Live folgen
                </label>
              </header>
              <div className="live-console__stream" ref={logRef}>
                {details.stages.length === 0 && (
                  <div className="console-empty">
                    <LoaderCircle className={activeRun ? "spin" : ""} size={18} />
                    Stage wird vorbereitet …
                  </div>
                )}
                {details.stages.map((stage, index) => (
                  <article
                    className={`stage-transcript stage-transcript--${stage.status}`}
                    key={stage.id}
                  >
                    <header>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{stage.name}</strong>
                        <small>
                          {stage.role ?? "Orchestrierung"} ·{" "}
                          {new Date(stage.startedAt).toLocaleTimeString("de-DE")}
                        </small>
                      </div>
                      <div className="stage-metrics">
                        {stage.outputTokens > 0 && <span>{stage.outputTokens} Tokens</span>}
                        <b>{stage.status}</b>
                      </div>
                    </header>
                    {stage.thinkingText && (
                      <details className="thinking-block">
                        <summary>Thinking / interne Verarbeitung anzeigen</summary>
                        <pre>{stage.thinkingText}</pre>
                      </details>
                    )}
                    {stage.outputHtml ? (
                      <SanitizedMarkdown html={stage.outputHtml} />
                    ) : (
                      <div className="model-output">
                        {stage.status === "running"
                          ? "Modell verarbeitet Dokument und Council-Kontext …"
                          : "Keine Textausgabe gespeichert."}
                      </div>
                    )}
                    {stage.status === "running" && <span className="stream-cursor">▋</span>}
                  </article>
                ))}
              </div>
            </section>

            <aside className="run-rail">
              <section>
                <h2>Systemprotokoll</h2>
                <div className="system-log">
                  {systemEvents.map((item) => (
                    <div
                      className={`system-log__item system-log__item--${item.level}`}
                      key={item.id}
                    >
                      <time>{new Date(item.createdAt).toLocaleTimeString("de-DE")}</time>
                      <span>{item.message}</span>
                    </div>
                  ))}
                  {systemEvents.length === 0 && <p className="muted">Noch keine Systemmeldung.</p>}
                </div>
              </section>
              <section className="run-files">
                <h2>Virtuelle Dateien</h2>
                {details.artifacts.map((item) => (
                  <details key={item.id}>
                    <summary>
                      <FileText size={15} />
                      <span>{item.title}</span>
                    </summary>
                    <div className="file-meta">
                      <code>{item.sha256.slice(0, 12)}</code>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`${item.title} kopieren`}
                        onClick={() => void navigator.clipboard.writeText(item.content)}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    {item.contentHtml ? (
                      <SanitizedMarkdown html={item.contentHtml} />
                    ) : (
                      <pre>{item.content}</pre>
                    )}
                  </details>
                ))}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function DocumentView({
  id,
  onBack,
  onReview,
  onRun,
}: {
  id: string;
  onBack: () => void;
  onReview: (id: string) => void;
  onRun: (id: string) => void;
}) {
  const [document, setDocument] = useState<DocumentDetails | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<DocumentDetails>(`/api/documents/${id}`), api<RunRecord[]>("/api/runs")])
      .then(([details, allRuns]) => {
        setDocument(details);
        setRuns(allRuns.filter((run) => run.documentId === id));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [id]);

  return (
    <div className="document-detail-page">
      <header className="document-detail-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Dokumente
        </button>
        <div>
          <span>DOKUMENT</span>
          <strong>{document?.name ?? "Wird geladen …"}</strong>
        </div>
        <div>
          <a className="button button--quiet" href={`/api/documents/${id}/download`}>
            <Download size={16} /> Original
          </a>
          <button className="button button--primary" type="button" onClick={() => onReview(id)}>
            <Play size={16} /> Erneut prüfen
          </button>
        </div>
      </header>
      {error && <p className="notice notice--error">{error}</p>}
      {document && (
        <main className="document-detail">
          <header>
            <div>
              <h1>{document.name}</h1>
              <p>
                {formatSize(document.size)} · {document.mimeType} · {shortDate(document.createdAt)}
              </p>
            </div>
            <code>{document.sha256}</code>
          </header>
          <section>
            <h2>Extrahierter Inhalt</h2>
            <pre>{document.extractedText || "Kein extrahierter Text vorhanden."}</pre>
          </section>
          <section>
            <h2>Bisherige Läufe</h2>
            <div className="document-runs">
              {runs.map((run) => (
                <button type="button" key={run.id} onClick={() => onRun(run.id)}>
                  <span>
                    <strong>{FORMAT_NAMES[run.presentation]}</strong>
                    <small>
                      {shortDate(run.createdAt)} · {run.model}
                    </small>
                  </span>
                  <Status run={run} />
                  <ChevronRight size={16} />
                </button>
              ))}
              {runs.length === 0 && <p className="muted">Noch kein Lauf für dieses Dokument.</p>}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function ResultView({
  presentationId,
  pageSlug,
  onBack,
  onPresentationChange,
}: {
  presentationId: string;
  pageSlug: string | null;
  onBack: () => void;
  onPresentationChange: (id: string) => void;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [kind, setKind] = useState<PresentationKind>("text");
  const [runId, setRunId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"presentation" | "reviews" | "top10">("presentation");
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [top10, setTop10] = useState<DerivedAnalysisRecord | null>(null);
  const [startingTop10, setStartingTop10] = useState(false);
  const load = useCallback(
    async (preferredKind?: PresentationKind) => {
      const reference = await api<{
        runId: string;
        kind: PresentationKind;
        pages: string[];
      }>(`/api/presentations/${presentationId}`);
      const value = await api<RunDetails>(`/api/runs/${reference.runId}`);
      setDetails(value);
      setRunId(reference.runId);
      setKind(preferredKind ?? reference.kind);
      const [reviewItems, latestTop10] = await Promise.all([
        api<ReviewRecord[]>(`/api/runs/${reference.runId}/reviews`),
        api<DerivedAnalysisRecord | null>(`/api/runs/${reference.runId}/derived-analyses/top10`),
      ]);
      setReviews(reviewItems);
      setTop10(latestTop10);
    },
    [presentationId],
  );

  useEffect(() => {
    void load().catch((reason) => setError(reason.message));
  }, [load]);
  useEffect(() => {
    if (
      !details ||
      (["completed", "failed", "cancelled"].includes(details.run.status) &&
        top10?.status !== "running" &&
        top10?.status !== "queued")
    )
      return;
    const timer = window.setInterval(() => {
      void load(kind).catch((reason) => setError(reason.message));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [details, kind, load, top10?.status]);
  const presentation = details?.presentations.find((item) => item.kind === kind);
  const newspaperPage = pageSlug
    ? presentation?.pages.find((page) => page.slug === pageSlug)
    : undefined;
  const renderedHtml = pageSlug ? newspaperPage?.html : presentation?.html;
  useEffect(() => {
    if (section === "presentation" && presentation && presentation.id !== presentationId) {
      onPresentationChange(presentation.id);
    }
  }, [onPresentationChange, presentation, presentationId, section]);

  async function selectPresentation(next: PresentationKind) {
    setSection("presentation");
    setKind(next);
    const existing = details?.presentations.find((item) => item.kind === next);
    if (existing) {
      onPresentationChange(existing.id);
      return;
    }
    const reportsAreBuilding =
      details?.artifacts.some((item) => item.kind === "final") &&
      details &&
      !["completed", "failed", "cancelled"].includes(details.run.status);
    if (reportsAreBuilding) return;
    setCreating(true);
    setError("");
    try {
      const created = await api<{ id: string }>(`/api/runs/${runId}/presentations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: next }),
      });
      onPresentationChange(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  }

  async function startTop10() {
    if (!runId) return;
    setStartingTop10(true);
    setError("");
    try {
      const analysis = await api<DerivedAnalysisRecord>(`/api/runs/${runId}/derived-analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "top10_next_steps" }),
      });
      setTop10(analysis);
      setSection("top10");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartingTop10(false);
    }
  }

  return (
    <div className="result-page">
      <div className="result-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Zurück
        </button>
        <div className="result-tabs" role="tablist" aria-label="Darstellung">
          {(Object.keys(FORMAT_NAMES) as PresentationKind[]).map((item) => (
            <button
              className={kind === item ? "active" : ""}
              type="button"
              key={item}
              onClick={() => void selectPresentation(item)}
            >
              {FORMAT_NAMES[item]}
            </button>
          ))}
        </div>
        <div className="result-toolbar__actions">
          <button
            className="button button--primary"
            type="button"
            disabled={startingTop10}
            onClick={() => void startTop10()}
          >
            <ListChecks size={16} />
            {startingTop10 ? "Wird gestartet …" : "Top 10 nächste Schritte"}
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => void navigator.clipboard.writeText(window.location.href)}
          >
            <Copy size={16} /> URL kopieren
          </button>
          {kind === "onepaper" && (
            <a className="button button--quiet" href={`/api/presentations/${presentationId}/pdf`}>
              <Download size={17} /> PDF
            </a>
          )}
          <a className="button button--quiet" href={`/api/runs/${runId}/download`}>
            <Download size={17} /> Markdown
          </a>
        </div>
      </div>
      <nav className="result-subnav" aria-label="Ergebnisbereiche">
        <button
          className={section === "presentation" ? "active" : ""}
          type="button"
          onClick={() => setSection("presentation")}
        >
          Ergebnis
        </button>
        <button
          className={section === "reviews" ? "active" : ""}
          type="button"
          onClick={() => setSection("reviews")}
        >
          Einzelreviews <span>{reviews.length}</span>
        </button>
        <button
          className={section === "top10" ? "active" : ""}
          type="button"
          onClick={() => setSection("top10")}
        >
          Top 10
        </button>
      </nav>
      {error && <p className="notice notice--error">{error}</p>}
      {section === "presentation" && pageSlug && presentation && !newspaperPage && (
        <p className="notice notice--error">Diese Zeitungsseite wurde nicht gefunden.</p>
      )}
      {section === "presentation" &&
        (creating ||
          (!presentation && details?.artifacts.some((item) => item.kind === "final"))) && (
          <div className="result-loading">
            <LoaderCircle className="spin" />{" "}
            {creating
              ? "Darstellung wird aus dem finalen Ergebnis erzeugt …"
              : `${FORMAT_NAMES[kind]} wird im Hintergrund gestaltet und geprüft …`}
          </div>
        )}
      {section === "presentation" && renderedHtml && (
        <div
          className="rendered-result"
          data-presentation-id={presentation?.id}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}
      {section === "reviews" && (
        <main className="result-support">
          <header>
            <span>PRÜFSPUREN</span>
            <h1>Isolierte Einzelreviews</h1>
            <p>Die unabhängigen Fachurteile, auf denen die finale Synthese aufbaut.</p>
          </header>
          <div className="result-review-list">
            {reviews.map((review) => (
              <details key={review.id}>
                <summary>
                  <span>{review.role}</span>
                  <strong>{review.title}</strong>
                  <code>{review.sha256.slice(0, 10)}</code>
                </summary>
                <SanitizedMarkdown html={review.contentHtml} />
              </details>
            ))}
          </div>
        </main>
      )}
      {section === "top10" && (
        <main className="result-support result-support--top10">
          <header>
            <span>HANDLUNGSPLAN</span>
            <h1>Top 10 nächste Schritte</h1>
            <p>
              Aus dem finalen Ergebnis abgeleitet und gegen die isolierten Einzelreviews geprüft.
            </p>
          </header>
          {!top10 && (
            <button
              className="button button--primary"
              type="button"
              disabled={startingTop10}
              onClick={() => void startTop10()}
            >
              <ListChecks size={16} /> Analyse starten
            </button>
          )}
          {top10 && ["queued", "running"].includes(top10.status) && (
            <div className="result-loading">
              <LoaderCircle className="spin" /> Empfehlungen werden belegt und priorisiert …
            </div>
          )}
          {top10?.status === "failed" && (
            <p className="notice notice--error">{top10.error ?? "Analyse fehlgeschlagen."}</p>
          )}
          {top10?.outputHtml && <SanitizedMarkdown html={top10.outputHtml} />}
        </main>
      )}
    </div>
  );
}

function ModelPicker({
  provider,
  value,
  onChange,
  onAvailabilityChange,
}: {
  provider: ProviderId;
  value: string;
  onChange: (value: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [replacedModel, setReplacedModel] = useState("");
  const availabilityCallback = useRef(onAvailabilityChange);

  useEffect(() => {
    availabilityCallback.current = onAvailabilityChange;
  }, [onAvailabilityChange]);

  useEffect(() => {
    setLoading(true);
    availabilityCallback.current?.(false);
    setLoadError("");
    setReplacedModel("");
    setSearch("");
    api<ProviderModel[]>(`/api/providers/${provider}/models`)
      .then((items) => setModels(items))
      .catch((reason) => {
        setModels([]);
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
  }, [provider]);

  useEffect(() => {
    if (loading || models.length === 0 || models.some((model) => model.id === value)) return;
    if (value) setReplacedModel(value);
    onChange(models[0].id);
  }, [loading, models, onChange, value]);

  useEffect(() => {
    availabilityCallback.current?.(
      !loading && models.some((model) => model.id === value && model.available !== false),
    );
  }, [loading, models, value]);

  const filtered = models.filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedModel = models.find((model) => model.id === value);
  const visibleModels =
    selectedModel && !filtered.some((model) => model.id === selectedModel.id)
      ? [selectedModel, ...filtered]
      : filtered;

  return (
    <div className="model-picker">
      <label>
        <span>Modell suchen</span>
        <div className="search-input">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name oder ID"
          />
        </div>
      </label>
      <label htmlFor={`model-${provider}`}>
        <span>Verfügbares Modell</span>
      </label>
      <select
        id={`model-${provider}`}
        value={value}
        disabled={loading || models.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {visibleModels.map((model) => (
          <option value={model.id} key={model.id}>
            {model.name}
            {provider === "openrouter"
              ? ` · ↑ ${formatModelPrice(model.inputPricePerMillion)} / ↓ ${formatModelPrice(
                  model.outputPricePerMillion,
                )} je 1M`
              : ""}
            {model.contextWindow
              ? ` · ${Math.round(model.contextWindow / 1024)}k Kontext${
                  model.maximumContextWindow && model.maximumContextWindow > model.contextWindow
                    ? ` effektiv / ${Math.round(model.maximumContextWindow / 1024)}k Modellmaximum`
                    : ""
                }`
              : ""}
          </option>
        ))}
      </select>
      {loading && <small>Modelle werden geladen …</small>}
      {provider === "aibox" && !loading && !loadError && (
        <small>
          Nur textfähige Modelle; Thinking wird bei kompatiblen Modellen automatisch auf hoch
          gesetzt.
        </small>
      )}
      {provider === "openrouter" && !loading && !loadError && (
        <small>↑ Eingabe · ↓ Ausgabe · aktuelle OpenRouter-Preise pro 1 Mio. Token.</small>
      )}
      {loadError && <small className="not-configured">Modelle nicht verfügbar: {loadError}</small>}
      {replacedModel && (
        <small className="model-replaced">
          „{replacedModel}“ ist nicht mehr verfügbar. Ein verfügbares Modell wurde ausgewählt.
        </small>
      )}
    </div>
  );
}

const TEST_PROVIDERS: ProviderId[] = ["codex", "openrouter", "aibox"];

function TestModeView({
  settings,
  comparisons,
  onChanged,
  onOpen,
}: {
  settings: AppSettings;
  comparisons: ComparisonRecord[];
  onChanged: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [models, setModels] = useState<Record<ProviderId, string>>({
    codex: settings.providers.codex.model,
    openrouter: settings.providers.openrouter.model,
    aibox: settings.providers.aibox.model,
  });
  const [enabled, setEnabled] = useState<Record<ProviderId, boolean>>({
    codex: settings.providers.codex.configured,
    openrouter: settings.providers.openrouter.configured,
    aibox: settings.providers.aibox.configured,
  });
  const [available, setAvailable] = useState<Record<ProviderId, boolean>>({
    codex: false,
    openrouter: false,
    aibox: false,
  });
  const [mode, setMode] = useState<CouncilMode>("standard");
  const [presentation, setPresentation] = useState<PresentationKind>("newspaper");
  const [focus, setFocus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  async function uploadTestFile(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage("");
    const body = new FormData();
    body.append("file", file);
    try {
      const uploaded = await api<DocumentRecord>("/api/documents", { method: "POST", body });
      setDocument(uploaded);
      if (uploaded.status !== "ready") {
        setMessage(uploaded.error ?? "Die Datei konnte nicht gelesen werden.");
      }
      await onChanged();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }
  const testFileDrop = useFileDrop((file) => void uploadTestFile(file), uploading);

  async function startComparison() {
    if (!document) return;
    const providers = TEST_PROVIDERS.filter(
      (provider) =>
        enabled[provider] && available[provider] && settings.providers[provider].configured,
    ).map((provider) => ({ provider, model: models[provider] }));
    if (!providers.length) {
      setMessage("Mindestens ein erreichbarer Anbieter muss ausgewählt sein.");
      return;
    }
    setStarting(true);
    setMessage("");
    try {
      const result = await api<{
        comparison: ComparisonRecord;
        skipped: Array<{ provider: ProviderId; reason: string }>;
      }>("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          providers,
          mode,
          presentation,
          focus: focus || undefined,
        }),
      });
      await onChanged();
      onOpen(result.comparison.id);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  const selectedCount = TEST_PROVIDERS.filter(
    (provider) => enabled[provider] && available[provider],
  ).length;

  return (
    <div className="test-mode-page">
      <header className="page-heading">
        <h1>Anbieter vergleichen</h1>
        <p>
          Ein Dokument wird mit denselben Einstellungen getrennt durch alle erreichbaren Anbieter
          geprüft. Diese Läufe erscheinen ausschließlich hier.
        </p>
      </header>
      {message && <p className="notice notice--error">{message}</p>}
      <section className="test-composer">
        <label
          className={`upload-zone ${uploading ? "upload-zone--busy" : ""} ${
            testFileDrop.dragging ? "upload-zone--dragging" : ""
          }`}
          onDragEnter={testFileDrop.onDragEnter}
          onDragOver={testFileDrop.onDragOver}
          onDragLeave={testFileDrop.onDragLeave}
          onDrop={testFileDrop.onDrop}
        >
          <input
            type="file"
            accept=".md,.txt,.pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.xls,.xlsx,.ods,.html,.htm"
            disabled={uploading}
            onChange={(event) => {
              void uploadTestFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          {uploading ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
          <span>
            <strong>{document?.name ?? "Vergleichsdokument hochladen"}</strong>
            <small>
              {document
                ? `${formatSize(document.size)} · bereit für den Vergleich`
                : "Auswählen oder hier ablegen · Markdown, Text, PDF, DOCX oder HTML · maximal 50 MB"}
            </small>
          </span>
          <span className="button button--quiet">
            {document ? "Datei wechseln" : "Datei wählen"}
          </span>
        </label>
        <div className="test-provider-list">
          {TEST_PROVIDERS.map((provider) => {
            const configured = settings.providers[provider].configured;
            return (
              <section
                className={`test-provider ${enabled[provider] ? "test-provider--selected" : ""}`}
                key={provider}
              >
                <header>
                  <label className="test-provider__toggle">
                    <input
                      type="checkbox"
                      checked={enabled[provider]}
                      disabled={!configured}
                      onChange={(event) =>
                        setEnabled((current) => ({
                          ...current,
                          [provider]: event.target.checked,
                        }))
                      }
                    />
                    <span>{PROVIDER_NAMES[provider]}</span>
                  </label>
                  <small
                    className={configured && available[provider] ? "configured" : "not-configured"}
                  >
                    {!configured
                      ? "nicht konfiguriert"
                      : available[provider]
                        ? "erreichbar"
                        : "wird geprüft"}
                  </small>
                </header>
                <ModelPicker
                  provider={provider}
                  value={models[provider]}
                  onChange={(model) => setModels((current) => ({ ...current, [provider]: model }))}
                  onAvailabilityChange={(value) =>
                    setAvailable((current) =>
                      current[provider] === value ? current : { ...current, [provider]: value },
                    )
                  }
                />
              </section>
            );
          })}
        </div>
        <div className="test-options">
          <label>
            <span>Council-Modus</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as CouncilMode)}>
              <option value="standard">Standard · 2 Council-Runden</option>
              <option value="quick">Quick · 1 Council-Runde</option>
              <option value="deep">Deep · 3 Council-Runden</option>
              <option value="auto">Automatisch · Architekten-Empfehlung</option>
            </select>
          </label>
          <label>
            <span>Startansicht</span>
            <select
              value={presentation}
              onChange={(event) => setPresentation(event.target.value as PresentationKind)}
            >
              <option value="newspaper">QA-Tageszeitung</option>
              <option value="onepaper">Visual Report</option>
              <option value="text">HTML / Nur Text</option>
            </select>
          </label>
          <label className="test-focus">
            <span>Optionaler gemeinsamer Fokus</span>
            <input
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="Für alle Anbieter identisch"
            />
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={document?.status !== "ready" || selectedCount === 0 || starting}
            onClick={() => void startComparison()}
          >
            {starting ? <LoaderCircle className="spin" size={17} /> : <FlaskConical size={17} />}
            {selectedCount} Anbieter starten
          </button>
        </div>
        <p className="test-check-note">
          Nach dem fertigen Report prüft der Server HTML, CSS-Klassen und unerlaubtes JavaScript
          statisch. Nur bei Befunden erhält der jeweilige Report-Agent einmalig eine Korrekturrunde.
        </p>
      </section>

      <section className="comparison-history">
        <header className="section-heading">
          <FlaskConical size={18} />
          <h2>Vergleichsläufe</h2>
          <span>{comparisons.length}</span>
        </header>
        {comparisons.map((comparison) => (
          <button
            className="comparison-row"
            type="button"
            key={comparison.id}
            onClick={() => onOpen(comparison.id)}
          >
            <div>
              <strong>{comparison.documentName}</strong>
              <small>
                {shortDate(comparison.createdAt)} · {comparison.mode} ·{" "}
                {FORMAT_NAMES[comparison.presentation]}
              </small>
            </div>
            <div className="comparison-row__providers">
              {comparison.runs.map((run) => (
                <span key={run.id}>
                  {PROVIDER_NAMES[run.provider]} <Status run={run} />
                </span>
              ))}
            </div>
            <ChevronRight size={18} />
          </button>
        ))}
        {!comparisons.length && (
          <div className="empty">
            <FlaskConical size={24} />
            <p>Noch kein Anbietervergleich.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ComparisonView({
  comparison,
  onBack,
  onRun,
  onResult,
}: {
  comparison: ComparisonRecord;
  onBack: () => void;
  onRun: (runId: string) => void;
  onResult: (runId: string) => void;
}) {
  return (
    <div className="comparison-page">
      <header className="comparison-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Testmodus
        </button>
        <div>
          <span>ANBIETERVERGLEICH</span>
          <strong>{comparison.documentName}</strong>
        </div>
        <small>{shortDate(comparison.createdAt)}</small>
      </header>
      <section className="comparison-summary">
        <span>Gleiche Quelle</span>
        <strong>{comparison.mode}</strong>
        <span>{FORMAT_NAMES[comparison.presentation]}</span>
        <span>{comparison.runs.length} erreichbare Anbieter</span>
      </section>
      <div className="comparison-columns">
        {comparison.runs.map((run) => (
          <article className="comparison-provider" key={run.id}>
            <header>
              <div>
                <strong>{PROVIDER_NAMES[run.provider]}</strong>
                <small>{run.model}</small>
              </div>
              <Status run={run} />
            </header>
            <div className="comparison-provider__stage">
              <span>{run.currentStage ?? "Initialisierung"}</span>
              <b>{run.progress}%</b>
            </div>
            <progress max="100" value={run.progress} />
            {run.error && <p className="comparison-error">{run.error}</p>}
            <footer>
              <button className="button button--quiet" type="button" onClick={() => onRun(run.id)}>
                Worklog
              </button>
              <button
                className="button button--primary"
                type="button"
                disabled={run.status !== "completed"}
                onClick={() => onResult(run.id)}
              >
                Resultat
              </button>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [keys, setKeys] = useState({ openrouter: "", openaiImage: "" });
  const [message, setMessage] = useState("");
  const [comfyCheck, setComfyCheck] = useState<{
    loading: boolean;
    message: string;
    checkpoints: string[];
  }>({ loading: false, message: "", checkpoints: [] });
  const [login, setLogin] = useState<{
    id: string;
    status?: string;
    message?: string;
    url?: string;
    userCode?: string;
  } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await api<AppSettings>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        providers: {
          codex: {
            model: draft.providers.codex.model,
            apiKey: keys.openaiImage || undefined,
          },
          openrouter: { ...draft.providers.openrouter, apiKey: keys.openrouter || undefined },
          aibox: draft.providers.aibox,
        },
      }),
    });
    onSaved(saved);
    setKeys({ openrouter: "", openaiImage: "" });
    setMessage("Einstellungen gespeichert.");
  }

  async function beginLogin() {
    const started = await api<{ id: string }>("/api/auth/codex/start", { method: "POST" });
    setLogin(started);
    const timer = window.setInterval(async () => {
      const state = await api<{ status: string; message: string; url?: string; userCode?: string }>(
        `/api/auth/codex/${started.id}`,
      );
      setLogin({ id: started.id, ...state });
      if (state.url && state.status === "waiting") window.open(state.url, "qa-council-codex-login");
      if (state.status === "completed" || state.status === "failed") window.clearInterval(timer);
    }, 1_500);
  }

  async function checkComfyUi() {
    setComfyCheck({ loading: true, message: "Verbindung wird geprüft …", checkpoints: [] });
    try {
      const discovered = await api<{
        reachable: true;
        checkpoints: string[];
        device?: string;
      }>("/api/comfyui/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: draft.comfyui.baseUrl }),
      });
      setDraft((current) => ({
        ...current,
        comfyui: {
          ...current.comfyui,
          checkpoint: discovered.checkpoints.includes(current.comfyui.checkpoint)
            ? current.comfyui.checkpoint
            : (discovered.checkpoints[0] ?? current.comfyui.checkpoint),
        },
      }));
      setComfyCheck({
        loading: false,
        checkpoints: discovered.checkpoints,
        message: discovered.checkpoints.length
          ? `Verbunden${discovered.device ? ` · ${discovered.device}` : ""} · ${discovered.checkpoints.length} Modell(e)`
          : "Verbunden, aber keine Checkpoint-Modelle gefunden.",
      });
    } catch (reason) {
      setComfyCheck({
        loading: false,
        checkpoints: [],
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  function updateProvider(
    provider: ProviderId,
    patch: Partial<AppSettings["providers"][ProviderId]>,
  ) {
    setDraft((current) => ({
      ...current,
      providers: { ...current.providers, [provider]: { ...current.providers[provider], ...patch } },
    }));
  }

  return (
    <form className="settings-page" onSubmit={save}>
      <header className="page-heading">
        <h1>Einstellungen</h1>
        <p>Anbieterzugänge und Standardmodelle für neue Prüfungen.</p>
      </header>
      <section className="settings-section">
        <div>
          <h2>Codex</h2>
          <p>Serverseitige OpenAI-Anmeldung über den Pi-Auth-Speicher.</p>
        </div>
        <div className="settings-fields">
          <div className="auth-row">
            <span className={draft.providers.codex.configured ? "auth-ok" : "auth-missing"}>
              {draft.providers.codex.configured ? <Check size={15} /> : <CircleAlert size={15} />}
              {draft.providers.codex.configured ? "Angemeldet" : "Nicht angemeldet"}
            </span>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => void beginLogin()}
            >
              <LogIn size={16} /> Anmelden
            </button>
          </div>
          {login?.message && (
            <p className="notice">
              {login.message}
              {login.userCode ? <code>{login.userCode}</code> : null}
            </p>
          )}
          <ModelPicker
            provider="codex"
            value={draft.providers.codex.model}
            onChange={(model) => updateProvider("codex", { model })}
          />
          <label>
            <span>
              OpenAI API-Key für GPT Image{" "}
              {draft.providers.codex.imageConfigured && <em>bereits hinterlegt</em>}
            </span>
            <input
              type="password"
              value={keys.openaiImage}
              onChange={(event) => setKeys({ ...keys, openaiImage: event.target.value })}
              placeholder={
                draft.providers.codex.imageConfigured ? "Unverändert lassen" : "sk-proj-…"
              }
              autoComplete="new-password"
            />
            <small>Codex-OAuth bleibt für Text; native Bilder verwenden die OpenAI Bild-API.</small>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>OpenRouter</h2>
          <p>API-Key verschlüsselt auf dem persistenten Datenträger.</p>
        </div>
        <div className="settings-fields">
          <label>
            <span>
              API-Key {draft.providers.openrouter.configured && <em>bereits hinterlegt</em>}
            </span>
            <input
              type="password"
              value={keys.openrouter}
              onChange={(event) => setKeys({ ...keys, openrouter: event.target.value })}
              placeholder={draft.providers.openrouter.configured ? "Unverändert lassen" : "sk-or-…"}
              autoComplete="new-password"
            />
          </label>
          <ModelPicker
            provider="openrouter"
            value={draft.providers.openrouter.model}
            onChange={(model) => updateProvider("openrouter", { model })}
          />
          <label>
            <span>Provider-Routing</span>
            <select
              value={draft.openRouterRouting}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  openRouterRouting: event.target.value as AppSettings["openRouterRouting"],
                })
              }
            >
              <option value="balanced">Ausgewogen · OpenRouter-Standard</option>
              <option value="lowest">Günstigster Anbieter · Preis</option>
              <option value="fastest">Schnellster Anbieter · Durchsatz</option>
            </select>
            <small>
              Ausgewogen nutzt OpenRouters Verfügbarkeits- und Preisgewichtung; schnell priorisiert
              Tokens pro Sekunde.
            </small>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Lokale AI Box</h2>
          <p>Ollama-Modellliste und OpenAI-kompatible Inferenz.</p>
        </div>
        <div className="settings-fields">
          <label>
            <span>Serveradresse</span>
            <input
              value={draft.providers.aibox.baseUrl ?? ""}
              onChange={(event) => updateProvider("aibox", { baseUrl: event.target.value })}
            />
          </label>
          <ModelPicker
            provider="aibox"
            value={draft.providers.aibox.model}
            onChange={(model) => updateProvider("aibox", { model })}
          />
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>ComfyUI-Bilder</h2>
          <p>
            Lokales Titelbild für die AI Box und Rückfall für OpenRouter-Modelle ohne native
            Bildausgabe. Codex verwendet ausschließlich OpenAI GPT Image.
          </p>
        </div>
        <div className="settings-fields">
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.comfyui.enabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  comfyui: { ...draft.comfyui, enabled: event.target.checked },
                })
              }
            />
            Für AI-Box-Läufe und OpenRouter-Fallback aktivieren
          </label>
          <label>
            <span>ComfyUI-Serveradresse</span>
            <div className="field-action">
              <input
                value={draft.comfyui.baseUrl}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    comfyui: { ...draft.comfyui, baseUrl: event.target.value },
                  })
                }
                placeholder="http://192.168.10.120:8188"
              />
              <button
                className="button button--quiet"
                type="button"
                disabled={comfyCheck.loading}
                onClick={() => void checkComfyUi()}
              >
                {comfyCheck.loading ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Verbindung testen
              </button>
            </div>
            {comfyCheck.message && (
              <small className={comfyCheck.checkpoints.length ? "configured" : "not-configured"}>
                {comfyCheck.message}
              </small>
            )}
          </label>
          <label>
            <span>Bildmodell / Checkpoint</span>
            <input
              list="comfyui-checkpoints"
              value={draft.comfyui.checkpoint}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  comfyui: { ...draft.comfyui, checkpoint: event.target.value },
                })
              }
            />
            <datalist id="comfyui-checkpoints">
              {comfyCheck.checkpoints.map((checkpoint) => (
                <option value={checkpoint} key={checkpoint} />
              ))}
            </datalist>
            <small>
              Anima wird mit dem lokal vorhandenen Qwen-Encoder und Qwen-Image-VAE ausgeführt.
            </small>
          </label>
        </div>
      </section>
      <section className="settings-section settings-section--compact">
        <div>
          <h2>Ausgabesprache</h2>
          <p>Standardmäßig folgt das Ergebnis der Dokumentsprache.</p>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.automaticLanguage}
            onChange={(event) => setDraft({ ...draft, automaticLanguage: event.target.checked })}
          />{" "}
          Sprache automatisch erkennen
        </label>
      </section>
      <footer className="settings-actions">
        <span>{message}</span>
        <button className="button button--primary" type="submit">
          Einstellungen speichern
        </button>
      </footer>
    </form>
  );
}

export function App() {
  const initialRoute = routeFromPath();
  const [view, setView] = useState<
    "review" | "documents" | "runs" | "tests" | "archive" | "settings"
  >(initialRoute.testMode ? "tests" : "review");
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
    setSelected((current) => current || docs.find((doc) => doc.status === "ready")?.id || "");
  }, []);

  useEffect(() => {
    void load().catch((reason) => setMessage(reason.message));
    const timer = window.setInterval(() => {
      void Promise.all([
        api<RunRecord[]>("/api/runs"),
        api<ComparisonRecord[]>("/api/comparisons"),
      ]).then(([runItems, comparisonItems]) => {
        setRuns(runItems);
        setComparisons(comparisonItems);
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const handlePopState = () => {
      const route = routeFromPath();
      setDocumentId(route.documentId);
      setDetailId(route.runId);
      setComparisonId(route.comparisonId);
      setResultId(route.presentationId);
      setResultPage(route.presentationPage);
      if (route.testMode) setView("tests");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openRun = useCallback((id: string) => {
    window.history.pushState({}, "", `/runs/${id}`);
    setDocumentId(null);
    setResultId(null);
    setResultPage(null);
    setDetailId(id);
    setComparisonId(null);
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
  }, []);

  const openDocument = useCallback((id: string) => {
    window.history.pushState({}, "", `/documents/${id}`);
    setDetailId(null);
    setComparisonId(null);
    setResultId(null);
    setResultPage(null);
    setComparisonId(null);
    setDocumentId(id);
  }, []);

  const closePage = useCallback(() => {
    window.history.pushState({}, "", "/");
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setComparisonId(null);
  }, []);

  const closeDocument = useCallback(() => {
    window.history.pushState({}, "", "/");
    setDocumentId(null);
    setDetailId(null);
    setResultId(null);
    setResultPage(null);
    setView("documents");
  }, []);

  const reviewDocument = useCallback((id: string) => {
    window.history.pushState({}, "", "/");
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
      if (document.status === "ready") setSelected(document.id);
      else setMessage(document.error ?? "Die Datei konnte nicht gelesen werden.");
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
            onClick={() => {
              setView("review");
              setMobileNav(false);
            }}
          >
            <Sheet size={18} /> Prüfen
          </button>
          <button
            type="button"
            className={view === "documents" ? "active" : ""}
            onClick={() => {
              setView("documents");
              setMobileNav(false);
            }}
          >
            <FolderOpen size={18} /> Dokumente
          </button>
          <button
            type="button"
            className={view === "runs" ? "active" : ""}
            onClick={() => {
              setView("runs");
              setMobileNav(false);
            }}
          >
            <Newspaper size={18} /> Läufe
          </button>
          <button
            type="button"
            className={view === "tests" ? "active" : ""}
            onClick={() => {
              window.history.pushState({}, "", "/tests");
              setView("tests");
              setMobileNav(false);
            }}
          >
            <FlaskConical size={18} /> Testmodus
          </button>
          <button
            type="button"
            className={view === "archive" ? "active" : ""}
            onClick={() => {
              setView("archive");
              setMobileNav(false);
            }}
          >
            <Archive size={18} /> Archiv
          </button>
          <button
            type="button"
            className={view === "settings" ? "active" : ""}
            onClick={() => {
              setView("settings");
              setMobileNav(false);
            }}
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
            comparisons={comparisons}
            onChanged={load}
            onOpen={openComparison}
          />
        ) : null}
        {view === "documents" && (
          <div className="documents-page">
            <header className="page-heading">
              <h1>Dokumente</h1>
              <p>Hochgeladene Quellen öffnen, erneut prüfen oder entfernen.</p>
            </header>
            <div className="documents-table">
              {documents.map((document) => {
                const latestRun = latestRunByDocument.get(document.id);
                return (
                  <div className="documents-row" key={document.id}>
                    <FileText size={19} />
                    <div>
                      <strong>{document.name}</strong>
                      <small>
                        {formatSize(document.size)} · {shortDate(document.createdAt)}
                        {latestRun ? ` · letzter Lauf ${shortDate(latestRun.createdAt)}` : ""}
                      </small>
                    </div>
                    <span className={`file-state file-state--${document.status}`}>
                      {document.status === "ready"
                        ? "Bereit"
                        : document.status === "extracting"
                          ? "Wird gelesen"
                          : "Fehler"}
                    </span>
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() => openDocument(document.id)}
                    >
                      Öffnen
                    </button>
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={document.status !== "ready"}
                      onClick={() => reviewDocument(document.id)}
                    >
                      Erneut prüfen
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`${document.name} löschen`}
                      onClick={() => void removeDocument(document.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
              {documents.length === 0 && (
                <div className="empty">
                  <FolderOpen size={24} />
                  <p>Noch keine Dokumente hochgeladen.</p>
                </div>
              )}
            </div>
          </div>
        )}
        {view === "review" && (
          <div className="review-page">
            <header className="page-heading">
              <h1>Dokument prüfen</h1>
              <p>
                Ein Council-Lauf erzeugt zuerst das vollständige Fachresultat und danach die
                gewählte Darstellung.
              </p>
            </header>
            <label
              className={`upload-zone ${uploading ? "upload-zone--busy" : ""} ${
                reviewFileDrop.dragging ? "upload-zone--dragging" : ""
              }`}
              onDragEnter={reviewFileDrop.onDragEnter}
              onDragOver={reviewFileDrop.onDragOver}
              onDragLeave={reviewFileDrop.onDragLeave}
              onDrop={reviewFileDrop.onDrop}
            >
              <input
                type="file"
                onChange={(event) => {
                  void uploadFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                disabled={uploading}
              />
              {uploading ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
              <span>
                <strong>{uploading ? "Datei wird gelesen …" : "Datei hochladen"}</strong>
                <small>
                  Auswählen oder hier ablegen · Text, Markdown, PDF, Office, OpenDocument, RTF oder
                  MSG · maximal 50 MB
                </small>
              </span>
              <span className="button button--quiet">Auswählen</span>
            </label>
            {message && <p className="notice notice--error">{message}</p>}
            <section className="run-composer">
              <div className="section-heading">
                <h2>Prüfung konfigurieren</h2>
              </div>
              <div className="selected-document">
                <FileText size={18} />
                <div>
                  <span>Ausgewähltes Dokument</span>
                  <strong>{selectedDocument?.name ?? "Noch kein Dokument ausgewählt"}</strong>
                </div>
                <div className="selected-document__actions">
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => setView("documents")}
                  >
                    {selectedDocument ? "Ändern" : "Dokument wählen"}
                  </button>
                  {selectedDocument && (
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() => setSelected("")}
                    >
                      Auswahl leeren
                    </button>
                  )}
                </div>
              </div>
              <div className="control-grid">
                <label>
                  <span>Anbieter</span>
                  <select
                    value={provider}
                    onChange={(event) => {
                      setModelAvailable(false);
                      setProvider(event.target.value as ProviderId);
                    }}
                  >
                    {(Object.keys(PROVIDER_NAMES) as ProviderId[]).map((id) => (
                      <option value={id} key={id}>
                        {PROVIDER_NAMES[id]}
                      </option>
                    ))}
                  </select>
                  <small className={providerConfigured ? "configured" : "not-configured"}>
                    {providerConfigured ? "Zugang konfiguriert" : "Zugang in Einstellungen fehlt"}
                  </small>
                </label>
                <ModelPicker
                  provider={provider}
                  value={model}
                  onChange={setModel}
                  onAvailabilityChange={setModelAvailable}
                />
                <label>
                  <span>Council-Modus</span>
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as CouncilMode)}
                  >
                    <option value="auto">Automatisch · Architekten-Empfehlung</option>
                    <option value="quick">Quick · 1 Council-Runde</option>
                    <option value="standard">Standard · 2 Council-Runden</option>
                    <option value="deep">Deep · 3 Council-Runden</option>
                  </select>
                  <small>
                    Der QA-Architekt wählt die RACI-Mitglieder; der Modus steuert nur die
                    Abschlussrunden.
                  </small>
                </label>
                <label>
                  <span>Erste Darstellung</span>
                  <select
                    value={format}
                    onChange={(event) => setFormat(event.target.value as PresentationKind)}
                  >
                    <option value="text">HTML / Nur Text</option>
                    <option value="newspaper">QA-Tageszeitung</option>
                    <option value="onepaper">Visual Report</option>
                  </select>
                  <small>
                    Tageszeitung und Visual Report entstehen immer; hier wählst du die Startansicht.
                  </small>
                </label>
              </div>
              <label className="focus-field">
                <span>Optionaler Fokus</span>
                <textarea
                  rows={3}
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  placeholder="Zum Beispiel: besondere regulatorische Risiken oder Release-Entscheidung"
                />
              </label>
              {provider === "aibox" && (
                <label
                  className={`image-option ${canUseComfyUiImage ? "" : "image-option--disabled"}`}
                >
                  <input
                    type="checkbox"
                    checked={useComfyUiImage}
                    disabled={!canUseComfyUiImage}
                    onChange={(event) => setUseComfyUiImage(event.target.checked)}
                  />
                  <span>
                    <strong>Titelbild mit ComfyUI erzeugen</strong>
                    <small>
                      {canUseComfyUiImage
                        ? `${settings?.comfyui.checkpoint} · wird im Live-Log protokolliert`
                        : "ComfyUI zuerst in den Einstellungen aktivieren und konfigurieren."}
                    </small>
                  </span>
                </label>
              )}
              {provider !== "aibox" && (
                <div className="image-option">
                  <span>
                    <strong>
                      {provider === "codex"
                        ? "Editorialmotiv mit OpenAI GPT Image"
                        : "Editorialmotiv über OpenRouter"}
                    </strong>
                    <small>
                      {provider === "codex"
                        ? settings?.providers.codex.imageConfigured
                          ? "OpenAI Bild-API ist konfiguriert; ComfyUI wird nicht verwendet."
                          : "OpenAI API-Key fehlt; der Lauf bleibt möglich und protokolliert das fehlende Bild."
                        : "Native Bildausgabe bei geeignetem Modell, andernfalls ComfyUI-Fallback."}
                    </small>
                  </span>
                </div>
              )}
              <footer className="composer-actions">
                <span>
                  {selectedDocument
                    ? `${selectedDocument.name} wird geprüft`
                    : "Bitte eine bereite Datei auswählen"}
                </span>
                <button
                  className="button button--primary button--go"
                  type="button"
                  disabled={!selected || !providerConfigured || !modelAvailable}
                  onClick={() => void startRun()}
                >
                  <Play size={17} fill="currentColor" /> Go
                </button>
              </footer>
            </section>
          </div>
        )}
        {view === "runs" && (
          <div className="runs-page">
            <header className="page-heading page-heading--actions">
              <div>
                <h1>Läufe</h1>
                <p>Aktive und noch nicht archivierte Prüfungen in zeitlicher Reihenfolge.</p>
              </div>
              <button
                className="button button--quiet"
                type="button"
                disabled={
                  !runs.some(
                    (run) =>
                      !run.archivedAt && ["completed", "failed", "cancelled"].includes(run.status),
                  )
                }
                onClick={() => void archiveAllRuns()}
              >
                <Archive size={16} /> Alle abgeschlossenen archivieren
              </button>
            </header>
            {message && <p className="notice">{message}</p>}
            <div className="runs-table">
              <div className="runs-table__head">
                <span>Dokument</span>
                <span>Anbieter / Modell</span>
                <span>Format</span>
                <span>Status</span>
                <span></span>
              </div>
              {runs
                .filter((run) => !run.archivedAt)
                .map((run) => (
                  <div className="runs-row" key={run.id}>
                    <div>
                      <strong>{run.documentName}</strong>
                      <small>{shortDate(run.createdAt)}</small>
                    </div>
                    <div>
                      <span>{PROVIDER_NAMES[run.provider]}</span>
                      <small>{run.model}</small>
                    </div>
                    <span>{FORMAT_NAMES[run.presentation]}</span>
                    <div>
                      <Status run={run} />
                      <small>{run.currentStage}</small>
                    </div>
                    <div className="row-actions">
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={() => openRun(run.id)}
                      >
                        Details
                      </button>
                      {run.status === "completed" && (
                        <button
                          className="button button--primary"
                          type="button"
                          onClick={() => void openRunResult(run.id)}
                        >
                          Resultat
                        </button>
                      )}
                      {["completed", "failed", "cancelled"].includes(run.status) && (
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="Lauf archivieren"
                          title="Archivieren"
                          onClick={() => void archiveRun(run, true)}
                        >
                          <Archive size={16} />
                        </button>
                      )}
                      {["failed", "cancelled"].includes(run.status) && (
                        <button
                          className="icon-button icon-button--danger"
                          type="button"
                          aria-label="Beendeten Lauf löschen"
                          title="Löschen"
                          onClick={() => void deleteStoppedRun(run)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              {runs.filter((run) => !run.archivedAt).length === 0 && (
                <div className="empty">
                  <Newspaper size={24} />
                  <p>Noch kein Council-Lauf.</p>
                </div>
              )}
            </div>
          </div>
        )}
        {view === "archive" && (
          <div className="archive-page">
            <header className="page-heading">
              <h1>Archiv</h1>
              <p>Abgelegte Läufe öffnen, wiederherstellen oder fehlgeschlagene Läufe löschen.</p>
            </header>
            <div className="archive-list">
              {runs
                .filter((run) => run.archivedAt)
                .map((run) => (
                  <div className="archive-row" key={run.id}>
                    <div>
                      <strong>{run.documentName}</strong>
                      <small>
                        {shortDate(run.createdAt)} · {PROVIDER_NAMES[run.provider]} · {run.model}
                      </small>
                    </div>
                    <span>{FORMAT_NAMES[run.presentation]}</span>
                    <Status run={run} />
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() => openRun(run.id)}
                    >
                      Öffnen
                    </button>
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() => void archiveRun(run, false)}
                    >
                      Wiederherstellen
                    </button>
                    {["failed", "cancelled"].includes(run.status) && (
                      <button
                        className="icon-button icon-button--danger"
                        type="button"
                        aria-label="Beendeten Lauf löschen"
                        onClick={() => void deleteStoppedRun(run)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              {!runs.some((run) => run.archivedAt) && (
                <div className="empty">
                  <Archive size={24} />
                  <p>Das Archiv ist leer.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <VersionFooter />
    </div>
  );
}
