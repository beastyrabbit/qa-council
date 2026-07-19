/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { Search } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  DocumentRecord,
  PresentationKind,
  ProviderId,
  ProviderModel,
} from "../../shared/types";
import { api } from "../lib/api";

export function useFileDrop(onFile: (file?: File) => void, disabled = false) {
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

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  codex: "Codex (serverseitig)",
  openrouter: "OpenRouter",
  aibox: "Lokale AI Box",
};

export const FORMAT_NAMES: Record<PresentationKind, string> = {
  text: "HTML / Nur Text",
  newspaper: "QA-Tageszeitung",
  onepaper: "Visual Report",
};

export function shortDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const DOCUMENT_STATUS_NAMES: Record<DocumentRecord["status"], string> = {
  uploaded: "Gerade hochgeladen",
  extracting: "Extraktion läuft",
  ready: "Extrahiert",
  failed: "Extraktion fehlgeschlagen",
};

export function formatModelPrice(value: number | undefined) {
  if (value === undefined) return "–";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => void | Promise<void>;
}

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description ? (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant={(request?.destructive ?? true) ? "destructive" : "default"}
            disabled={busy}
            onClick={() => {
              if (!request) return;
              setBusy(true);
              void Promise.resolve(request.action())
                .catch((reason) =>
                  toast.error(reason instanceof Error ? reason.message : String(reason)),
                )
                .finally(() => {
                  setBusy(false);
                  onClose();
                });
            }}
          >
            {request?.confirmLabel ?? "Bestätigen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ModelPicker({
  provider,
  value,
  onChange,
  onAvailabilityChange,
  deferLoad = false,
}: {
  provider: ProviderId;
  value: string;
  onChange: (value: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
  deferLoad?: boolean;
}) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [replacedModel, setReplacedModel] = useState("");
  const [loadRequested, setLoadRequested] = useState(!deferLoad);
  const availabilityCallback = useRef(onAvailabilityChange);

  useEffect(() => {
    availabilityCallback.current = onAvailabilityChange;
  }, [onAvailabilityChange]);

  useEffect(() => {
    setLoadRequested(!deferLoad);
  }, [deferLoad]);

  useEffect(() => {
    if (!loadRequested) {
      setModels([]);
      setLoading(false);
      availabilityCallback.current?.(false);
      return;
    }
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
  }, [loadRequested, provider]);

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
            onFocus={() => setLoadRequested(true)}
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
        onFocus={() => setLoadRequested(true)}
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
      {!loadRequested && (
        <button
          className="button button--quiet"
          type="button"
          onClick={() => setLoadRequested(true)}
        >
          Modelle dieses Anbieters prüfen
        </button>
      )}
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

const _TEST_PROVIDERS: ProviderId[] = ["codex", "openrouter", "aibox"];
