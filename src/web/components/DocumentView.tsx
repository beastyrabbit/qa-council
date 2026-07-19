import { ArrowLeft, ChevronRight, Copy, Download, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DocumentDetails, RunRecord } from "../../shared/types";
import { api } from "../lib/api";
import { RunStatus as Status } from "./RunStatus";
import { FORMAT_NAMES, formatSize, shortDate } from "./ViewShared";

export function DocumentView({
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
  const [showFullText, setShowFullText] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      Promise.all([api<DocumentDetails>(`/api/documents/${id}`), api<RunRecord[]>("/api/runs")])
        .then(([details, allRuns]) => {
          if (!active) return;
          setDocument(details);
          setRuns(allRuns.filter((run) => run.documentId === id));
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id]);

  const extractedText =
    document?.status === "uploaded"
      ? "Gerade hochgeladen. Die Extraktion startet als erster Schritt nach „Go“."
      : document?.status === "extracting"
        ? "Die Extraktion läuft gerade in einem Council-Lauf."
        : (document?.extractedText ?? document?.error ?? "Kein extrahierter Text vorhanden.");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8 lg:py-10">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Dokumente
        </Button>
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            Dokument
          </span>
          <strong className="block truncate font-heading text-lg">
            {document?.name ?? "Wird geladen …"}
          </strong>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<a href={`/api/documents/${id}/download`} />}>
            <Download /> Original
          </Button>
          <Button size="sm" onClick={() => onReview(id)}>
            <Play /> Erneut prüfen
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {document && (
        <main className="document-detail flex flex-col gap-5">
          <Card className="gap-2 py-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
              <p className="text-sm text-muted-foreground">
                {formatSize(document.size)} · {document.mimeType} · {shortDate(document.createdAt)}
              </p>
              <button
                type="button"
                className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                title={document.sha256}
                onClick={() => {
                  void navigator.clipboard.writeText(document.sha256);
                  toast.success("SHA-256 kopiert.");
                }}
              >
                {document.sha256.slice(0, 12)}… <Copy className="size-3" />
              </button>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-3!">
              <CardTitle className="font-heading text-sm">Extrahierter Inhalt</CardTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(extractedText);
                    toast.success("Extrahierter Inhalt kopiert.");
                  }}
                >
                  <Copy /> Kopieren
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowFullText(!showFullText)}>
                  {showFullText ? "Weniger anzeigen" : "Vollständig anzeigen"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <pre
                className={cn(
                  "overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap",
                  showFullText ? "max-h-none" : "max-h-[480px]",
                )}
              >
                {extractedText}
              </pre>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-4 py-3!">
              <CardTitle className="font-heading text-sm">Bisherige Läufe</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col divide-y">
                {runs.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    className="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                    onClick={() => onRun(run.id)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <strong className="text-sm font-medium">
                        {FORMAT_NAMES[run.presentation]}
                      </strong>
                      <small className="truncate text-xs text-muted-foreground">
                        {shortDate(run.createdAt)} · {run.model}
                      </small>
                    </span>
                    <Status run={run} />
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {runs.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    Noch kein Lauf für dieses Dokument.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      )}
    </div>
  );
}
