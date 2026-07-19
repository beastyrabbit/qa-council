import { ArrowLeft, Copy, Download, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ArtifactRecord, RunDetails, RunStatus } from "../../shared/types";
import { api } from "../lib/api";
import { SanitizedMarkdown } from "./SanitizedMarkdown";

const ATTEMPT_STATUS_NAMES: Record<RunStatus, string> = {
  queued: "Wartet",
  running: "Läuft",
  cancelling: "Wird abgebrochen",
  cancelled: "Abgebrochen",
  waiting_for_input: "Rückfrage",
  completed: "Fertig",
  failed: "Fehler",
};

export function FileReader({
  runId,
  artifactId,
  initialAttempt,
  onBack,
  onFileChange,
}: {
  runId: string;
  artifactId: string;
  initialAttempt?: number;
  onBack: () => void;
  onFileChange: (artifactId: string, attempt: number) => void;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [attempt, setAttempt] = useState(initialAttempt ?? 0);
  const [files, setFiles] = useState<ArtifactRecord[]>([]);
  const [content, setContent] = useState<ArtifactRecord | null>(null);
  const [error, setError] = useState("");

  const loadIndex = useCallback(async () => {
    const run = await api<RunDetails>(`/api/runs/${runId}${attempt ? `?attempt=${attempt}` : ""}`);
    const selected = attempt || run.run.currentAttempt;
    const items = await api<ArtifactRecord[]>(`/api/runs/${runId}/files?attempt=${selected}`);
    setDetails(run);
    setAttempt(selected);
    setFiles(items);
  }, [attempt, runId]);

  useEffect(() => {
    void loadIndex().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [loadIndex]);

  useEffect(() => {
    setContent(null);
    void api<ArtifactRecord>(`/api/runs/${runId}/files/${artifactId}`)
      .then(setContent)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [artifactId, runId]);

  const phases = [...new Set(files.map((file) => file.phase))];

  return (
    <div className="file-reader flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Lauf
        </Button>
        <div className="min-w-0 flex-1">
          <strong className="block truncate font-heading text-sm">
            {details?.run.documentName ?? "Datei"}
          </strong>
          <span className="block text-xs text-muted-foreground">
            Audit-Dateien · Versuch {attempt || "…"}
          </span>
        </div>
        {details && details.attempts.length > 1 && (
          <Select
            value={String(attempt)}
            onValueChange={(value) => {
              if (!value) return;
              const nextAttempt = Number(value);
              setAttempt(nextAttempt);
              setContent(null);
              void api<ArtifactRecord[]>(`/api/runs/${runId}/files?attempt=${nextAttempt}`)
                .then((items) => {
                  setFiles(items);
                  const nextArtifactId =
                    items.find((item) => item.id === artifactId)?.id ?? items[0]?.id;
                  if (nextArtifactId) onFileChange(nextArtifactId, nextAttempt);
                })
                .catch((reason) =>
                  setError(reason instanceof Error ? reason.message : String(reason)),
                );
            }}
          >
            <SelectTrigger size="sm" aria-label="Versuch wählen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {details.attempts.map((item) => (
                <SelectItem key={item.attempt} value={String(item.attempt)}>
                  Versuch {item.attempt} · {ATTEMPT_STATUS_NAMES[item.status] ?? item.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>
      {error && (
        <Alert variant="destructive" className="mx-4 mt-4">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav
          className="file-reader__nav border-b lg:border-r lg:border-b-0"
          aria-label="Audit-Dateien"
        >
          <ScrollArea className="h-full max-h-[40vh] lg:max-h-[calc(100svh-57px)]">
            <div className="flex flex-col gap-3 p-3">
              {phases.map((phase) => (
                <div key={phase}>
                  <p className="px-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                    {phase}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {files
                      .filter((file) => file.phase === phase)
                      .map((file) => (
                        <button
                          type="button"
                          key={file.id}
                          className={cn(
                            "flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                            file.id === artifactId
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted/60",
                          )}
                          onClick={() => onFileChange(file.id, attempt)}
                        >
                          <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex min-w-0 flex-col">
                            <strong className="truncate text-xs font-medium">{file.title}</strong>
                            <small className="truncate text-[11px] text-muted-foreground">
                              {file.role ?? file.kind}
                            </small>
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </nav>
        <main className="file-reader__content min-w-0 p-5 lg:p-8">
          {content ? (
            <>
              <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                    {content.phase}
                  </span>
                  <h1 className="mt-0.5 font-heading text-xl font-bold">{content.title}</h1>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    Versuch {content.originAttempt} · {content.sha256.slice(0, 12)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(content.content ?? "");
                      toast.success("Inhalt kopiert.");
                    }}
                  >
                    <Copy /> Kopieren
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={`/api/runs/${runId}/files/${content.id}?download=1`} />}
                  >
                    <Download /> Download
                  </Button>
                </div>
              </header>
              {content.contentHtml ? (
                <SanitizedMarkdown html={content.contentHtml} />
              ) : (
                <pre className="overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {content.content}
                </pre>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Datei wird geladen …</p>
          )}
        </main>
      </div>
    </div>
  );
}
