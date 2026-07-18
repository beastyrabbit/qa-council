import { FileText, LoaderCircle, Play, Upload } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  CouncilMode,
  DocumentRecord,
  PresentationKind,
  ProviderId,
} from "../../shared/types";
import { DOCUMENT_STATUS_NAMES, ModelPicker, PROVIDER_NAMES, type useFileDrop } from "./ViewShared";

export function ReviewComposerView({
  uploading,
  reviewFileDrop,
  uploadFile,
  message,
  selectedDocument,
  navigateDocuments,
  clearSelected,
  provider,
  setProvider,
  setModelAvailable,
  providerConfigured,
  model,
  setModel,
  mode,
  setMode,
  format,
  setFormat,
  focus,
  setFocus,
  canUseComfyUiImage,
  useComfyUiImage,
  setUseComfyUiImage,
  settings,
  selected,
  modelAvailable,
  startRun,
}: {
  uploading: boolean;
  reviewFileDrop: ReturnType<typeof useFileDrop>;
  uploadFile: (file?: File) => Promise<void>;
  message: string;
  selectedDocument?: DocumentRecord;
  navigateDocuments: () => void;
  clearSelected: () => void;
  provider: ProviderId;
  setProvider: Dispatch<SetStateAction<ProviderId>>;
  setModelAvailable: Dispatch<SetStateAction<boolean>>;
  providerConfigured: boolean;
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
  mode: CouncilMode;
  setMode: Dispatch<SetStateAction<CouncilMode>>;
  format: PresentationKind;
  setFormat: Dispatch<SetStateAction<PresentationKind>>;
  focus: string;
  setFocus: Dispatch<SetStateAction<string>>;
  canUseComfyUiImage: boolean;
  useComfyUiImage: boolean;
  setUseComfyUiImage: Dispatch<SetStateAction<boolean>>;
  settings: AppSettings | null;
  selected: string;
  modelAvailable: boolean;
  startRun: () => Promise<void>;
}) {
  const navigateView = (_view: "documents") => navigateDocuments();
  const setSelected = (_value: string) => clearSelected();
  return (
    <div className="review-page">
      <header className="page-heading">
        <h1>Dokument prüfen</h1>
        <p>
          Ein Council-Lauf erzeugt zuerst das vollständige Fachresultat und danach die gewählte
          Darstellung.
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
          aria-label="Prüfdokument hochladen"
          onChange={(event) => {
            void uploadFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
          disabled={uploading}
        />
        {uploading ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
        <span>
          <strong>{uploading ? "Datei wird hochgeladen …" : "Datei hochladen"}</strong>
          <small>
            Auswählen oder hier ablegen · Text, Markdown, PDF, Office, OpenDocument, RTF oder MSG ·
            maximal 50 MB
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
            <span>
              Ausgewähltes Dokument
              {selectedDocument ? ` · ${DOCUMENT_STATUS_NAMES[selectedDocument.status]}` : ""}
            </span>
            <strong>{selectedDocument?.name ?? "Noch kein Dokument ausgewählt"}</strong>
          </div>
          <div className="selected-document__actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={() => navigateView("documents")}
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
                const nextProvider = event.target.value as ProviderId;
                if (nextProvider !== provider) {
                  setModelAvailable(false);
                  setProvider(nextProvider);
                }
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
            <select value={mode} onChange={(event) => setMode(event.target.value as CouncilMode)}>
              <option value="auto">Automatisch · Architekten-Empfehlung</option>
              <option value="quick">Quick · 1 Council-Runde</option>
              <option value="standard">Standard · 2 Council-Runden</option>
              <option value="deep">Deep · 3 Council-Runden</option>
            </select>
            <small>
              Der QA-Architekt wählt die RACI-Mitglieder; der Modus steuert nur die Abschlussrunden.
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
          <label className={`image-option ${canUseComfyUiImage ? "" : "image-option--disabled"}`}>
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
  );
}
