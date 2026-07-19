import { CircleCheck, CircleX, FileText, Newspaper, Play, Settings2, Upload } from "lucide-react";
import { type Dispatch, type ReactNode, type SetStateAction, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AppSettings,
  CouncilMode,
  DocumentRecord,
  PresentationKind,
  ProviderId,
  RunRecord,
} from "../../shared/types";
import {
  DOCUMENT_STATUS_NAMES,
  FORMAT_NAMES,
  ModelPicker,
  PROVIDER_NAMES,
  shortDate,
  type useFileDrop,
} from "./ViewShared";

const MODE_LABELS: Record<CouncilMode, string> = {
  auto: "Automatisch",
  quick: "Quick",
  standard: "Standard",
  deep: "Deep",
};

function ReadinessItem({ ok, label, action }: { ok: boolean; label: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CircleCheck className="size-4 shrink-0 text-primary" />
      ) : (
        <CircleX className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
      {action}
    </div>
  );
}

export function ReviewComposerView({
  uploading,
  reviewFileDrop,
  uploadFile,
  message,
  selectedDocument,
  documents,
  runs,
  selectDocument,
  clearSelected,
  openRunResult,
  openSettings,
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
  documents: DocumentRecord[];
  runs: RunRecord[];
  selectDocument: (id: string) => void;
  clearSelected: () => void;
  openRunResult: (id: string) => Promise<void>;
  openSettings: () => void;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const recentResults = runs
    .filter((run) => run.status === "completed" && run.hasResult && !run.archivedAt)
    .slice(0, 4);

  return (
    <div className="review-page mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Dokument prüfen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ein Council-Lauf erzeugt zuerst das vollständige Fachresultat und danach die gewählte
          Darstellung.
        </p>
      </header>

      <label
        className={cn(
          "upload-zone flex cursor-pointer items-center gap-4 rounded-lg border-2 border-dashed bg-card p-5 transition-colors",
          reviewFileDrop.dragging
            ? "upload-zone--dragging border-primary bg-accent/60"
            : "border-border hover:border-ring",
          uploading && "pointer-events-none opacity-70",
        )}
        onDragEnter={reviewFileDrop.onDragEnter}
        onDragOver={reviewFileDrop.onDragOver}
        onDragLeave={reviewFileDrop.onDragLeave}
        onDrop={reviewFileDrop.onDrop}
      >
        <input
          type="file"
          className="sr-only"
          aria-label="Prüfdokument hochladen"
          onChange={(event) => {
            void uploadFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
          disabled={uploading}
        />
        {uploading ? (
          <Spinner className="size-6 text-muted-foreground" />
        ) : (
          <Upload className="size-6 text-muted-foreground" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="text-sm">
            {uploading ? "Datei wird hochgeladen …" : "Datei hochladen"}
          </strong>
          <small className="text-xs text-muted-foreground">
            Auswählen oder hier ablegen · Text, Markdown, PDF, Office, OpenDocument, RTF oder MSG ·
            maximal 50 MB
          </small>
        </span>
        <span className={cn(buttonVariants({ variant: "outline" }))}>Auswählen</span>
      </label>

      {message && (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Upload fehlgeschlagen</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Prüfung konfigurieren</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="selected-document flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-muted-foreground">
                Ausgewähltes Dokument
                {selectedDocument ? ` · ${DOCUMENT_STATUS_NAMES[selectedDocument.status]}` : ""}
              </span>
              <strong className="truncate text-sm">
                {selectedDocument?.name ?? "Noch kein Dokument ausgewählt"}
              </strong>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                {selectedDocument ? "Ändern" : "Dokument wählen"}
              </Button>
              {selectedDocument && (
                <Button variant="ghost" size="sm" onClick={clearSelected}>
                  Auswahl leeren
                </Button>
              )}
            </div>
          </div>

          {selectedDocument?.status === "failed" && (
            <Alert variant="destructive">
              <CircleX />
              <AlertTitle>Extraktion fehlgeschlagen</AlertTitle>
              <AlertDescription>
                {selectedDocument.error ??
                  "Die Extraktion dieses Dokuments ist fehlgeschlagen. Bitte die Datei erneut hochladen."}
              </AlertDescription>
            </Alert>
          )}

          <Accordion multiple={false} className="border-none">
            <AccordionItem value="optionen" className="rounded-lg border">
              <AccordionTrigger className="px-4">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Settings2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">Optionen</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {PROVIDER_NAMES[provider]} · {model || "kein Modell"} · {MODE_LABELS[mode]} ·{" "}
                    {FORMAT_NAMES[format]}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="flex flex-col gap-5 pt-1">
                  <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                    <Field>
                      <FieldLabel htmlFor="composer-provider">Anbieter</FieldLabel>
                      <Select
                        value={provider}
                        onValueChange={(nextProvider) => {
                          if (nextProvider && nextProvider !== provider) {
                            setModelAvailable(false);
                            setProvider(nextProvider as ProviderId);
                          }
                        }}
                      >
                        <SelectTrigger id="composer-provider" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PROVIDER_NAMES) as ProviderId[]).map((id) => (
                            <SelectItem value={id} key={id}>
                              {PROVIDER_NAMES[id]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription
                        className={providerConfigured ? "text-primary" : "text-destructive"}
                      >
                        {providerConfigured
                          ? "Zugang konfiguriert"
                          : "Zugang in Einstellungen fehlt"}
                      </FieldDescription>
                    </Field>
                    <ModelPicker
                      provider={provider}
                      value={model}
                      onChange={setModel}
                      onAvailabilityChange={setModelAvailable}
                    />
                    <Field>
                      <FieldLabel htmlFor="composer-mode">Council-Modus</FieldLabel>
                      <Select
                        value={mode}
                        onValueChange={(value) => value && setMode(value as CouncilMode)}
                      >
                        <SelectTrigger id="composer-mode" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Automatisch · Architekten-Empfehlung</SelectItem>
                          <SelectItem value="quick">Quick · 1 Council-Runde</SelectItem>
                          <SelectItem value="standard">Standard · 2 Council-Runden</SelectItem>
                          <SelectItem value="deep">Deep · 3 Council-Runden</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Der QA-Architekt wählt die RACI-Mitglieder; der Modus steuert nur die
                        Abschlussrunden.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="composer-format">Erste Darstellung</FieldLabel>
                      <Select
                        value={format}
                        onValueChange={(value) => value && setFormat(value as PresentationKind)}
                      >
                        <SelectTrigger id="composer-format" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">HTML / Nur Text</SelectItem>
                          <SelectItem value="newspaper">QA-Tageszeitung</SelectItem>
                          <SelectItem value="onepaper">Visual Report</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Tageszeitung und Visual Report entstehen immer; hier wählst du die
                        Startansicht.
                      </FieldDescription>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="composer-focus">Optionaler Fokus</FieldLabel>
                    <Textarea
                      id="composer-focus"
                      rows={3}
                      value={focus}
                      onChange={(event) => setFocus(event.target.value)}
                      placeholder="Zum Beispiel: besondere regulatorische Risiken oder Release-Entscheidung"
                    />
                  </Field>
                  {provider === "aibox" ? (
                    <label
                      htmlFor="composer-comfyui-image"
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3",
                        canUseComfyUiImage ? "cursor-pointer" : "opacity-60",
                      )}
                    >
                      <Checkbox
                        id="composer-comfyui-image"
                        checked={useComfyUiImage}
                        disabled={!canUseComfyUiImage}
                        onCheckedChange={(checked) => setUseComfyUiImage(checked === true)}
                        className="mt-0.5"
                      />
                      <span className="flex flex-col">
                        <strong className="text-sm">Titelbild mit ComfyUI erzeugen</strong>
                        <small className="text-xs text-muted-foreground">
                          {canUseComfyUiImage
                            ? `${settings?.comfyui.checkpoint} · wird im Live-Log protokolliert`
                            : "ComfyUI zuerst in den Einstellungen aktivieren und konfigurieren."}
                        </small>
                      </span>
                    </label>
                  ) : (
                    <div className="flex items-start gap-3 rounded-lg border p-3">
                      <span className="flex flex-col">
                        <strong className="text-sm">
                          {provider === "codex"
                            ? "Editorialmotiv mit OpenAI GPT Image"
                            : "Editorialmotiv über OpenRouter"}
                        </strong>
                        <small className="text-xs text-muted-foreground">
                          {provider === "codex"
                            ? settings?.providers.codex.imageConfigured
                              ? "OpenAI Bild-API ist konfiguriert; bei Fehlern übernimmt das lokale ComfyUI."
                              : settings?.comfyui.configured
                                ? "OpenAI API-Key fehlt; das konfigurierte lokale ComfyUI erzeugt die Reportbilder."
                                : "OpenAI API-Key fehlt und ComfyUI ist nicht vollständig konfiguriert."
                            : "Native Bildausgabe bei geeignetem Modell, andernfalls ComfyUI-Fallback."}
                        </small>
                      </span>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-4 border-t">
          <div className="flex flex-col gap-1.5">
            <ReadinessItem ok={Boolean(selected)} label="Dokument ausgewählt" />
            <ReadinessItem
              ok={providerConfigured}
              label="Anbieter-Zugang"
              action={
                providerConfigured ? undefined : (
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={openSettings}>
                    Einstellungen öffnen
                  </Button>
                )
              }
            />
            <ReadinessItem ok={modelAvailable} label="Modell verfügbar" />
          </div>
          <Button
            size="lg"
            disabled={!selected || !providerConfigured || !modelAvailable}
            onClick={() => void startRun()}
          >
            <Play fill="currentColor" /> Go
          </Button>
        </CardFooter>
      </Card>

      {recentResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <Newspaper className="size-4 text-muted-foreground" /> Letzte Ergebnisse
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {recentResults.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{run.documentName}</span>
                  <span className="text-xs text-muted-foreground">
                    {shortDate(run.createdAt)} · {PROVIDER_NAMES[run.provider]}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void openRunResult(run.id)}>
                  Ergebnis öffnen
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">Dokument wählen</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Dokument suchen" />
            <CommandList>
              <CommandEmpty>Kein Dokument gefunden.</CommandEmpty>
              <CommandGroup>
                {documents
                  .filter((document) => document.status !== "extracting")
                  .map((document) => (
                    <CommandItem
                      key={document.id}
                      value={document.name}
                      onSelect={() => {
                        selectDocument(document.id);
                        setPickerOpen(false);
                      }}
                    >
                      <FileText className="text-muted-foreground" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{document.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {shortDate(document.createdAt)} · {DOCUMENT_STATUS_NAMES[document.status]}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
