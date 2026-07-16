import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  LoaderCircle,
  LogIn,
  Menu,
  Newspaper,
  Play,
  Search,
  Settings,
  Sheet,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  CouncilMode,
  DocumentRecord,
  PresentationKind,
  ProviderId,
  ProviderModel,
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

const PROVIDER_NAMES: Record<ProviderId, string> = {
  codex: "Codex (serverseitig)",
  openrouter: "OpenRouter",
  aibox: "Lokale AI Box",
};

const FORMAT_NAMES: Record<PresentationKind, string> = {
  text: "HTML / Nur Text",
  newspaper: "QA-Zeitung",
  onepaper: "One-Paper",
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

function Status({ run }: { run: RunRecord }) {
  if (run.status === "completed") return <span className="status status--done">Fertig</span>;
  if (run.status === "failed") return <span className="status status--error">Fehler</span>;
  if (run.status === "waiting_for_input")
    return <span className="status status--wait">Rückfrage</span>;
  return <span className="status">{run.status === "queued" ? "Wartet" : `${run.progress} %`}</span>;
}

function DetailsDrawer({
  id,
  onClose,
  onResult,
}: {
  id: string;
  onClose: () => void;
  onResult: () => void;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const load = useCallback(() => {
    void api<RunDetails>(`/api/runs/${id}`)
      .then(setDetails)
      .catch((reason) => setError(reason.message));
  }, [id]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 1_500);
    return () => window.clearInterval(timer);
  }, [load]);

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

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Laufdetails"
      onMouseDown={onClose}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <aside
        className="drawer"
        aria-label="Laufdetails"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer__header">
          <div>
            <h2>Ausführliches Protokoll</h2>
            <p>{details?.run.documentName ?? "Lauf wird geladen …"}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Schließen" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {error && <p className="notice notice--error">{error}</p>}
        {details && (
          <>
            <div className="run-progress">
              <div>
                <Status run={details.run} />
                <strong>{details.run.currentStage}</strong>
              </div>
              <progress max="100" value={details.run.progress} />
              <small>
                {PROVIDER_NAMES[details.run.provider]} · {details.run.model} ·{" "}
                {details.run.resolvedMode ?? details.run.mode}
              </small>
            </div>
            {details.question && (
              <form className="question" onSubmit={submitAnswer}>
                <strong>Die Prüfung benötigt eine Angabe</strong>
                <p>{details.question.prompt}</p>
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={3}
                  required
                />
                <button className="button button--primary" type="submit">
                  Antwort senden
                </button>
              </form>
            )}
            <section className="timeline">
              <h3>Aktivitäten</h3>
              {details.events.length === 0 && <p className="muted">Noch keine Ereignisse.</p>}
              {details.events.map((item) => (
                <div className={`timeline__item timeline__item--${item.level}`} key={item.id}>
                  <time>{new Date(item.createdAt).toLocaleTimeString("de-DE")}</time>
                  <div>
                    <strong>{item.message}</strong>
                    <small>{item.type}</small>
                  </div>
                </div>
              ))}
            </section>
            <section className="artifacts">
              <h3>Virtuelle Dateien</h3>
              {details.artifacts.map((item) => (
                <details key={item.id}>
                  <summary>
                    <FileText size={16} /> <span>{item.title}</span>
                    <code>{item.sha256.slice(0, 10)}</code>
                  </summary>
                  <pre>{item.content}</pre>
                </details>
              ))}
            </section>
            {details.run.status === "completed" && (
              <footer className="drawer__footer">
                <button className="button button--primary" type="button" onClick={onResult}>
                  Resultat öffnen
                </button>
              </footer>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function ResultView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [kind, setKind] = useState<PresentationKind>("text");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const value = await api<RunDetails>(`/api/runs/${runId}`);
    setDetails(value);
    if (value.presentations.length && !value.presentations.some((item) => item.kind === kind)) {
      setKind(value.presentations[0].kind);
    }
  }, [kind, runId]);

  useEffect(() => {
    void load().catch((reason) => setError(reason.message));
  }, [load]);
  const presentation = details?.presentations.find((item) => item.kind === kind);

  async function selectPresentation(next: PresentationKind) {
    setKind(next);
    if (details?.presentations.some((item) => item.kind === next)) return;
    setCreating(true);
    setError("");
    try {
      await api(`/api/runs/${runId}/presentations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: next }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
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
        <a className="button button--quiet" href={`/api/runs/${runId}/download`}>
          <Download size={17} /> Markdown
        </a>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {creating && (
        <div className="result-loading">
          <LoaderCircle className="spin" /> Darstellung wird aus dem finalen Ergebnis erzeugt …
        </div>
      )}
      {presentation && (
        /* biome-ignore lint/security/noDangerouslySetInnerHtml: Der Server sanitisiert Modell-Markdown mit einer Tag- und Attribut-Allowlist. */
        <div className="rendered-result" dangerouslySetInnerHTML={{ __html: presentation.html }} />
      )}
    </div>
  );
}

function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: ProviderId;
  value: string;
  onChange: (value: string) => void;
}) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<ProviderModel[]>(`/api/providers/${provider}/models`)
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [provider]);
  const filtered = models.filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(search.toLowerCase()),
  );

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
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!models.some((model) => model.id === value) && <option value={value}>{value}</option>}
        {filtered.map((model) => (
          <option value={model.id} key={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      {loading && <small>Modelle werden geladen …</small>}
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
  const [keys, setKeys] = useState({ openrouter: "" });
  const [message, setMessage] = useState("");
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
          codex: { model: draft.providers.codex.model },
          openrouter: { ...draft.providers.openrouter, apiKey: keys.openrouter || undefined },
          aibox: draft.providers.aibox,
        },
      }),
    });
    onSaved(saved);
    setKeys({ openrouter: "" });
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
              onChange={(event) => setKeys({ openrouter: event.target.value })}
              placeholder={draft.providers.openrouter.configured ? "Unverändert lassen" : "sk-or-…"}
              autoComplete="new-password"
            />
          </label>
          <ModelPicker
            provider="openrouter"
            value={draft.providers.openrouter.model}
            onChange={(model) => updateProvider("openrouter", { model })}
          />
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
  const [view, setView] = useState<"review" | "runs" | "settings">("review");
  const [mobileNav, setMobileNav] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState<ProviderId>("codex");
  const [model, setModel] = useState("");
  const [format, setFormat] = useState<PresentationKind>("text");
  const [mode, setMode] = useState<CouncilMode>("auto");
  const [focus, setFocus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [docs, runItems, appSettings] = await Promise.all([
      api<DocumentRecord[]>("/api/documents"),
      api<RunRecord[]>("/api/runs"),
      api<AppSettings>("/api/settings"),
    ]);
    setDocuments(docs);
    setRuns(runItems);
    setSettings(appSettings);
    setSelected((current) => current || docs.find((doc) => doc.status === "ready")?.id || "");
  }, []);

  useEffect(() => {
    void load().catch((reason) => setMessage(reason.message));
    const timer = window.setInterval(() => {
      void api<RunRecord[]>("/api/runs").then(setRuns);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (settings) setModel(settings.providers[provider].model);
  }, [provider, settings]);

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
          focus: focus || undefined,
        }),
      });
      setDetailId(run.id);
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

  const selectedDocument = documents.find((doc) => doc.id === selected);
  const providerConfigured = settings?.providers[provider].configured ?? false;
  const latestRunByDocument = useMemo(
    () => new Map(runs.map((run) => [run.documentId, run])),
    [runs],
  );

  if (resultId) return <ResultView runId={resultId} onBack={() => setResultId(null)} />;

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
        {view === "review" && (
          <div className="review-page">
            <header className="page-heading">
              <h1>Dokument prüfen</h1>
              <p>
                Ein Council-Lauf erzeugt zuerst das vollständige Fachresultat und danach die
                gewählte Darstellung.
              </p>
            </header>
            <label className={`upload-zone ${uploading ? "upload-zone--busy" : ""}`}>
              <input
                type="file"
                onChange={(event) => void uploadFile(event.target.files?.[0])}
                disabled={uploading}
              />
              {uploading ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
              <span>
                <strong>{uploading ? "Datei wird gelesen …" : "Datei hochladen"}</strong>
                <small>
                  Text, Markdown, PDF, Office, OpenDocument, RTF oder MSG · maximal 50 MB
                </small>
              </span>
              <span className="button button--quiet">Auswählen</span>
            </label>
            {message && <p className="notice notice--error">{message}</p>}
            <section className="document-section">
              <div className="section-heading">
                <h2>Hochgeladene Dateien</h2>
                <span>{documents.length}</span>
              </div>
              <div className="document-table">
                {documents.length === 0 && (
                  <div className="empty">
                    <FileText size={24} />
                    <p>Noch keine Datei hochgeladen.</p>
                  </div>
                )}
                {documents.map((document) => {
                  const run = latestRunByDocument.get(document.id);
                  return (
                    <div
                      className={`document-row ${selected === document.id ? "selected" : ""}`}
                      key={document.id}
                    >
                      <input
                        type="radio"
                        name="document"
                        checked={selected === document.id}
                        disabled={document.status !== "ready"}
                        onChange={() => setSelected(document.id)}
                        aria-label={`${document.name} auswählen`}
                      />
                      <FileText size={19} />
                      <button
                        className="document-name"
                        type="button"
                        onClick={() => document.status === "ready" && setSelected(document.id)}
                      >
                        <strong>{document.name}</strong>
                        <small>
                          {formatSize(document.size)} · {shortDate(document.createdAt)}
                        </small>
                      </button>
                      <span className={`file-state file-state--${document.status}`}>
                        {document.status === "ready"
                          ? "Bereit"
                          : document.status === "extracting"
                            ? "Wird gelesen"
                            : "Fehler"}
                      </span>
                      {run && (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setDetailId(run.id)}
                        >
                          Letzter Lauf <ChevronRight size={15} />
                        </button>
                      )}
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
              </div>
            </section>
            <section className="run-composer">
              <div className="section-heading">
                <h2>Prüfung konfigurieren</h2>
              </div>
              <div className="control-grid">
                <label>
                  <span>Anbieter</span>
                  <select
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as ProviderId)}
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
                <ModelPicker provider={provider} value={model} onChange={setModel} />
                <label>
                  <span>Council-Modus</span>
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as CouncilMode)}
                  >
                    <option value="auto">Automatisch</option>
                    <option value="quick">Quick</option>
                    <option value="standard">Standard</option>
                    <option value="deep">Deep</option>
                  </select>
                  <small>Auto wählt nach Risiko und Umfang.</small>
                </label>
                <label>
                  <span>Erste Darstellung</span>
                  <select
                    value={format}
                    onChange={(event) => setFormat(event.target.value as PresentationKind)}
                  >
                    <option value="text">HTML / Nur Text</option>
                    <option value="newspaper">QA-Zeitung</option>
                    <option value="onepaper">One-Paper</option>
                  </select>
                  <small>Weitere Ansichten sind später möglich.</small>
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
              <footer className="composer-actions">
                <span>
                  {selectedDocument
                    ? `${selectedDocument.name} wird geprüft`
                    : "Bitte eine bereite Datei auswählen"}
                </span>
                <button
                  className="button button--primary button--go"
                  type="button"
                  disabled={!selected || !providerConfigured || !model}
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
            <header className="page-heading">
              <h1>Läufe</h1>
              <p>Alle Prüfungen, Rückfragen und Ergebnisse in zeitlicher Reihenfolge.</p>
            </header>
            <div className="runs-table">
              <div className="runs-table__head">
                <span>Dokument</span>
                <span>Anbieter / Modell</span>
                <span>Format</span>
                <span>Status</span>
                <span></span>
              </div>
              {runs.map((run) => (
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
                      onClick={() => setDetailId(run.id)}
                    >
                      Details
                    </button>
                    {run.status === "completed" && (
                      <button
                        className="button button--primary"
                        type="button"
                        onClick={() => setResultId(run.id)}
                      >
                        Resultat
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {runs.length === 0 && (
                <div className="empty">
                  <Newspaper size={24} />
                  <p>Noch kein Council-Lauf.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      {detailId && (
        <DetailsDrawer
          id={detailId}
          onClose={() => setDetailId(null)}
          onResult={() => {
            setResultId(detailId);
            setDetailId(null);
          }}
        />
      )}
    </div>
  );
}
