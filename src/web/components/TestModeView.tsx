import { ChevronRight, CircleX, FlaskConical, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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
    <div className="test-mode-page mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Anbieter vergleichen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ein Dokument wird mit denselben Einstellungen getrennt durch alle erreichbaren Anbieter
          geprüft. Diese Läufe erscheinen ausschließlich hier.
        </p>
      </header>

      {message && (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Vergleich nicht möglich</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-5">
          <label
            className={cn(
              "upload-zone flex cursor-pointer items-center gap-4 rounded-lg border-2 border-dashed bg-card p-5 transition-colors",
              testFileDrop.dragging
                ? "upload-zone--dragging border-primary bg-accent/60"
                : "border-border hover:border-ring",
              uploading && "pointer-events-none opacity-70",
            )}
            onDragEnter={testFileDrop.onDragEnter}
            onDragOver={testFileDrop.onDragOver}
            onDragLeave={testFileDrop.onDragLeave}
            onDrop={testFileDrop.onDrop}
          >
            <input
              type="file"
              className="sr-only"
              aria-label="Vergleichsdokument hochladen"
              accept=".md,.txt,.pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.xls,.xlsx,.ods,.html,.htm"
              disabled={uploading}
              onChange={(event) => {
                void uploadTestFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {uploading ? (
              <Spinner className="size-6 text-muted-foreground" />
            ) : (
              <Upload className="size-6 text-muted-foreground" />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <strong className="truncate text-sm">
                {document?.name ?? "Vergleichsdokument hochladen"}
              </strong>
              <small className="text-xs text-muted-foreground">
                {document
                  ? `${formatSize(document.size)} · hochgeladen · Extraktion startet mit den Läufen`
                  : "Auswählen oder hier ablegen · Markdown, Text, PDF, DOCX oder HTML · maximal 50 MB"}
              </small>
            </span>
            <span className={cn(buttonVariants({ variant: "outline" }))}>
              {document ? "Datei wechseln" : "Datei wählen"}
            </span>
          </label>

          <div className="grid gap-4 lg:grid-cols-3">
            {TEST_PROVIDERS.map((provider) => {
              const configured = settings.providers[provider].configured;
              return (
                <Card
                  key={provider}
                  className={cn(
                    "test-provider gap-3 py-4",
                    enabled[provider] && "border-primary/40 ring-1 ring-primary/20",
                  )}
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
                    <label
                      htmlFor={`test-provider-${provider}`}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <Switch
                        id={`test-provider-${provider}`}
                        checked={enabled[provider]}
                        disabled={!configured}
                        onCheckedChange={(checked) =>
                          setEnabled((current) => ({ ...current, [provider]: checked === true }))
                        }
                      />
                      <span className="text-sm font-medium">{PROVIDER_NAMES[provider]}</span>
                    </label>
                    {!configured ? (
                      <Badge variant="outline">nicht konfiguriert</Badge>
                    ) : available[provider] ? (
                      <Badge
                        variant="outline"
                        className="border-primary/25 bg-primary/10 text-primary"
                      >
                        erreichbar
                      </Badge>
                    ) : enabled[provider] ? (
                      <Badge variant="secondary">
                        <Spinner /> wird geprüft
                      </Badge>
                    ) : (
                      <Badge variant="secondary">deaktiviert</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="px-4">
                    <ModelPicker
                      provider={provider}
                      value={models[provider]}
                      deferLoad={!enabled[provider] || !configured}
                      onChange={(model) =>
                        setModels((current) => ({ ...current, [provider]: model }))
                      }
                      onAvailabilityChange={(value) =>
                        setAvailable((current) =>
                          current[provider] === value ? current : { ...current, [provider]: value },
                        )
                      }
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid items-end gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="test-mode">Council-Modus</FieldLabel>
              <Select
                value={mode}
                onValueChange={(value) => value && setMode(value as CouncilMode)}
              >
                <SelectTrigger id="test-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard · 2 Council-Runden</SelectItem>
                  <SelectItem value="quick">Quick · 1 Council-Runde</SelectItem>
                  <SelectItem value="deep">Deep · 3 Council-Runden</SelectItem>
                  <SelectItem value="auto">Automatisch · Architekten-Empfehlung</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="test-presentation">Startansicht</FieldLabel>
              <Select
                value={presentation}
                onValueChange={(value) => value && setPresentation(value as PresentationKind)}
              >
                <SelectTrigger id="test-presentation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newspaper">QA-Tageszeitung</SelectItem>
                  <SelectItem value="onepaper">Visual Report</SelectItem>
                  <SelectItem value="text">HTML / Nur Text</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="test-focus">Optionaler gemeinsamer Fokus</FieldLabel>
              <Input
                id="test-focus"
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                placeholder="Für alle Anbieter identisch"
              />
            </Field>
            <Button
              disabled={
                !document || document.status === "extracting" || selectedCount === 0 || starting
              }
              onClick={() => void startComparison()}
            >
              {starting ? <Spinner /> : <FlaskConical />}
              {selectedCount} Anbieter starten
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Nach dem fertigen Report prüft der Server HTML, CSS-Klassen und unerlaubtes JavaScript
            statisch. Nur bei Befunden erhält der jeweilige Report-Agent einmalig eine
            Korrekturrunde.
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <header className="flex items-center gap-2">
          <FlaskConical className="size-4 text-muted-foreground" />
          <h2 className="font-heading text-lg font-semibold">Vergleichsläufe</h2>
          <Badge variant="secondary">{comparisons.length}</Badge>
        </header>
        {comparisons.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConical />
              </EmptyMedia>
              <EmptyTitle>Noch kein Anbietervergleich.</EmptyTitle>
              <EmptyDescription>
                Oben ein Dokument hochladen und mindestens einen Anbieter aktivieren.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {comparisons.map((comparison) => (
              <button
                type="button"
                key={comparison.id}
                className="flex items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                onClick={() => onOpen(comparison.id)}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{comparison.documentName}</span>
                  <span className="text-xs text-muted-foreground">
                    {shortDate(comparison.createdAt)} · {comparison.mode} ·{" "}
                    {FORMAT_NAMES[comparison.presentation]}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {comparison.runs.map((run) => (
                    <span key={run.id} className="flex items-center gap-1.5 text-xs">
                      {PROVIDER_NAMES[run.provider]} <Status run={run} />
                    </span>
                  ))}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
