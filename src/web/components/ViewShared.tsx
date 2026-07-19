/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { Check, ChevronsUpDown, Search } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
  const [open, setOpen] = useState(false);
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

  const selectedModel = models.find((model) => model.id === value);

  function modelMeta(model: ProviderModel) {
    const parts: string[] = [];
    if (provider === "openrouter") {
      parts.push(
        `↑ ${formatModelPrice(model.inputPricePerMillion)} / ↓ ${formatModelPrice(
          model.outputPricePerMillion,
        )} je 1M`,
      );
    }
    if (model.contextWindow) {
      parts.push(
        `${Math.round(model.contextWindow / 1024)}k Kontext${
          model.maximumContextWindow && model.maximumContextWindow > model.contextWindow
            ? ` effektiv / ${Math.round(model.maximumContextWindow / 1024)}k Modellmaximum`
            : ""
        }`,
      );
    }
    return parts.join(" · ");
  }

  return (
    <div className="model-picker flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`model-${provider}`}>Modell</Label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setLoadRequested(true);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={`model-${provider}`}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="search-input w-full justify-between font-normal"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {loading
                ? "Modelle werden geladen …"
                : (selectedModel?.name ?? (value || "Modell wählen"))}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Name oder ID" />
            <CommandList>
              <CommandEmpty>
                {loading ? "Modelle werden geladen …" : "Kein Modell gefunden."}
              </CommandEmpty>
              <CommandGroup>
                {models.map((model) => {
                  const meta = modelMeta(model);
                  return (
                    <CommandItem
                      key={model.id}
                      value={`${model.name} ${model.id}`}
                      onSelect={() => {
                        onChange(model.id);
                        setOpen(false);
                      }}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{model.name}</span>
                        {meta && (
                          <span className="truncate text-xs text-muted-foreground">{meta}</span>
                        )}
                      </div>
                      <Check
                        className={cn(
                          "ml-auto shrink-0",
                          value === model.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedModel && modelMeta(selectedModel) && (
        <p className="text-xs text-muted-foreground">{modelMeta(selectedModel)}</p>
      )}
      {provider === "aibox" && !loading && !loadError && (
        <p className="text-xs text-muted-foreground">
          Nur textfähige Modelle; Thinking wird bei kompatiblen Modellen automatisch auf hoch
          gesetzt.
        </p>
      )}
      {provider === "openrouter" && !loading && !loadError && (
        <p className="text-xs text-muted-foreground">
          ↑ Eingabe · ↓ Ausgabe · aktuelle OpenRouter-Preise pro 1 Mio. Token.
        </p>
      )}
      {loadError && (
        <p className="text-xs text-destructive">Modelle nicht verfügbar: {loadError}</p>
      )}
      {replacedModel && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          „{replacedModel}“ ist nicht mehr verfügbar. Ein verfügbares Modell wurde ausgewählt.
        </p>
      )}
    </div>
  );
}

const _TEST_PROVIDERS: ProviderId[] = ["codex", "openrouter", "aibox"];
