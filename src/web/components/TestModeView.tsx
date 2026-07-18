/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { ChevronRight, FlaskConical, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AppSettings,
  ComparisonRecord,
  CouncilMode,
  DocumentRecord,
  PresentationKind,
  ProviderId,
} from "../../shared/types";
import { api } from "../lib/api";
import { RunStatus as Status } from "./RunStatus";

import {
  FORMAT_NAMES,
  formatSize,
  ModelPicker,
  PROVIDER_NAMES,
  shortDate,
  useFileDrop,
} from "./ViewShared";

const TEST_PROVIDERS: ProviderId[] = ["codex", "openrouter", "aibox"];

export function TestModeView({
  settings,
  documents,
  comparisons,
  onChanged,
  onOpen,
}: {
  settings: AppSettings;
  documents: DocumentRecord[];
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

  useEffect(() => {
    if (!document) return;
    const updated = documents.find((item) => item.id === document.id);
    if (updated && updated !== document) setDocument(updated);
  }, [document, documents]);

  async function uploadTestFile(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage("");
    const body = new FormData();
    body.append("file", file);
    try {
      const uploaded = await api<DocumentRecord>("/api/documents", { method: "POST", body });
      setDocument(uploaded);
      if (uploaded.status === "failed") {
        setMessage(uploaded.error ?? "Die vorherige Extraktion war fehlgeschlagen.");
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
            aria-label="Vergleichsdokument hochladen"
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
                ? `${formatSize(document.size)} · hochgeladen · Extraktion startet mit den Läufen`
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
                  deferLoad
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
            disabled={
              !document || document.status === "extracting" || selectedCount === 0 || starting
            }
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
