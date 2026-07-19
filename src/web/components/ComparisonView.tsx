import { ArrowLeft, CircleX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ComparisonRecord } from "../../shared/types";
import { RunStatus as Status } from "./RunStatus";
import { FORMAT_NAMES, PROVIDER_NAMES, shortDate } from "./ViewShared";

export function ComparisonView({
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
    <div className="comparison-page mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Testmodus
        </Button>
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            Anbietervergleich
          </span>
          <strong className="block truncate font-heading text-lg">{comparison.documentName}</strong>
        </div>
        <span className="text-xs text-muted-foreground">{shortDate(comparison.createdAt)}</span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Gleiche Quelle</Badge>
        <Badge variant="secondary">{comparison.mode}</Badge>
        <Badge variant="outline">{FORMAT_NAMES[comparison.presentation]}</Badge>
        <Badge variant="outline">{comparison.runs.length} erreichbare Anbieter</Badge>
      </div>

      <div className="comparison-columns grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {comparison.runs.map((run) => (
          <Card className="comparison-provider gap-3 py-4" key={run.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
              <div className="min-w-0">
                <strong className="block truncate text-sm">{PROVIDER_NAMES[run.provider]}</strong>
                <small className="block truncate text-xs text-muted-foreground">{run.model}</small>
              </div>
              <Status run={run} />
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">
                  {run.currentStage ?? "Initialisierung"}
                </span>
                <b className="font-mono">{run.progress}%</b>
              </div>
              <Progress value={run.progress} />
              {run.error && (
                <Alert variant="destructive" className="mt-1">
                  <CircleX />
                  <AlertTitle>Fehlgeschlagen</AlertTitle>
                  <AlertDescription className="break-words">{run.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="justify-end gap-2 px-4">
              <Button variant="outline" size="sm" onClick={() => onRun(run.id)}>
                Details
              </Button>
              <Button size="sm" disabled={!run.hasResult} onClick={() => onResult(run.id)}>
                {run.status === "completed" ? "Resultat" : "Text-Ergebnis"}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
