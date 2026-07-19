import { Archive, ArchiveRestore, MoreHorizontal, Newspaper, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RunRecord } from "../../shared/types";
import { RunStatus as Status } from "./RunStatus";
import { FORMAT_NAMES, PROVIDER_NAMES, shortDate } from "./ViewShared";

export type RunsTab = "active" | "archive";

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "waiting_for_input"]);
const STOPPED_STATUSES = new Set(["completed", "failed", "cancelled"]);

function elapsedSince(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `seit ${minutes} min`;
  return `seit ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

type StatusFilter = "alle" | "aktiv" | "fertig" | "fehler";

function matchesFilter(run: RunRecord, filter: StatusFilter) {
  if (filter === "alle") return true;
  if (filter === "aktiv") return ACTIVE_STATUSES.has(run.status);
  if (filter === "fertig") return run.status === "completed";
  return run.status === "failed" || run.status === "cancelled";
}

export function RunsListView({
  runs,
  tab,
  onTabChange,
  archiveAllRuns,
  openRun,
  openRunResult,
  archiveRun,
  deleteStoppedRun,
}: {
  runs: RunRecord[];
  tab: RunsTab;
  onTabChange: (tab: RunsTab) => void;
  archiveAllRuns: () => Promise<void>;
  openRun: (id: string) => void;
  openRunResult: (id: string) => Promise<void>;
  archiveRun: (run: RunRecord, archived: boolean) => Promise<void>;
  deleteStoppedRun: (run: RunRecord) => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>("alle");
  const archivedCount = runs.filter((run) => run.archivedAt).length;
  const visibleRuns =
    tab === "archive"
      ? runs.filter((run) => run.archivedAt)
      : runs.filter((run) => !run.archivedAt && matchesFilter(run, filter));

  return (
    <div className="runs-page mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Läufe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "archive"
              ? "Abgelegte Läufe öffnen, wiederherstellen oder fehlgeschlagene Läufe löschen."
              : "Aktive und noch nicht archivierte Prüfungen in zeitlicher Reihenfolge."}
          </p>
        </div>
        {tab === "active" && (
          <Button
            variant="outline"
            disabled={!runs.some((run) => !run.archivedAt && STOPPED_STATUSES.has(run.status))}
            onClick={() => void archiveAllRuns()}
          >
            <Archive /> Alle abgeschlossenen archivieren
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as RunsTab)}>
          <TabsList>
            <TabsTrigger value="active">Aktiv</TabsTrigger>
            <TabsTrigger value="archive">
              Archiv
              {archivedCount > 0 && (
                <Badge variant="secondary" className="ml-1.5">
                  {archivedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "active" && (
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[filter]}
            onValueChange={(value) => setFilter((value[0] as StatusFilter | undefined) ?? "alle")}
          >
            <ToggleGroupItem value="alle">Alle</ToggleGroupItem>
            <ToggleGroupItem value="aktiv">Läuft</ToggleGroupItem>
            <ToggleGroupItem value="fertig">Fertig</ToggleGroupItem>
            <ToggleGroupItem value="fehler">Fehler</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {visibleRuns.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {tab === "archive" ? <Archive /> : <Newspaper />}
            </EmptyMedia>
            <EmptyTitle>
              {tab === "archive" ? "Das Archiv ist leer." : "Noch kein Council-Lauf."}
            </EmptyTitle>
            <EmptyDescription>
              {tab === "archive"
                ? "Abgeschlossene Läufe lassen sich aus der Aktiv-Liste hierher verschieben."
                : "Starte unter „Prüfen“ eine erste Analyse."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dokument</TableHead>
                <TableHead>Anbieter / Modell</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRuns.map((run) => (
                <TableRow
                  key={run.id}
                  className={`cursor-pointer ${tab === "archive" ? "archive-row" : ""}`}
                  onClick={() => openRun(run.id)}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{run.documentName}</span>
                      <span className="text-xs text-muted-foreground">
                        {shortDate(run.createdAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{PROVIDER_NAMES[run.provider]}</span>
                      <span className="max-w-56 truncate text-xs text-muted-foreground">
                        {run.model}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {FORMAT_NAMES[run.presentation]}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Status run={run} />
                      <span className="max-w-64 truncate text-xs text-muted-foreground">
                        {run.status === "running"
                          ? `${elapsedSince(run.createdAt)}${run.currentStage ? ` · ${run.currentStage}` : ""}`
                          : (run.currentStage ?? "")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {tab === "active" ? (
                        <>
                          {run.hasResult && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void openRunResult(run.id)}
                            >
                              {run.status === "completed" ? "Resultat" : "Text-Ergebnis"}
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon-sm" aria-label="Aktionen" />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openRun(run.id)}>
                                Details öffnen
                              </DropdownMenuItem>
                              {STOPPED_STATUSES.has(run.status) && (
                                <DropdownMenuItem onClick={() => void archiveRun(run, true)}>
                                  <Archive /> Archivieren
                                </DropdownMenuItem>
                              )}
                              {["failed", "cancelled"].includes(run.status) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => deleteStoppedRun(run)}
                                  >
                                    <Trash2 /> Dauerhaft löschen
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void archiveRun(run, false)}
                          >
                            <ArchiveRestore /> Wiederherstellen
                          </Button>
                          {["failed", "cancelled"].includes(run.status) && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Beendeten Lauf löschen"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteStoppedRun(run)}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
