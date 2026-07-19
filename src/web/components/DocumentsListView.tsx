import { FileText, FolderOpen, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DocumentRecord, RunRecord } from "../../shared/types";
import { DOCUMENT_STATUS_NAMES, formatSize, shortDate } from "./ViewShared";

export function DocumentStatusBadge({ status }: { status: DocumentRecord["status"] }) {
  if (status === "ready")
    return (
      <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
        {DOCUMENT_STATUS_NAMES.ready}
      </Badge>
    );
  if (status === "failed")
    return <Badge variant="destructive">{DOCUMENT_STATUS_NAMES.failed}</Badge>;
  if (status === "extracting")
    return (
      <Badge variant="secondary">
        <Spinner /> {DOCUMENT_STATUS_NAMES.extracting}
      </Badge>
    );
  return <Badge variant="secondary">{DOCUMENT_STATUS_NAMES.uploaded}</Badge>;
}

export function DocumentsListView({
  documents,
  latestRunByDocument,
  openDocument,
  reviewDocument,
  removeDocument,
  openRunResult,
}: {
  documents: DocumentRecord[];
  latestRunByDocument: Map<string, RunRecord>;
  openDocument: (id: string) => void;
  reviewDocument: (id: string) => void;
  removeDocument: (id: string) => void;
  openRunResult: (id: string) => Promise<void>;
}) {
  return (
    <div className="documents-page mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Dokumente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hochgeladene Quellen öffnen, erneut prüfen oder entfernen.
        </p>
      </header>
      {documents.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>Noch keine Dokumente hochgeladen.</EmptyTitle>
            <EmptyDescription>
              Unter „Prüfen“ lässt sich die erste Datei hochladen.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dokument</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Letzter Lauf</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => {
                const latestRun = latestRunByDocument.get(document.id);
                return (
                  <TableRow
                    key={document.id}
                    className="cursor-pointer"
                    onClick={() => openDocument(document.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{document.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatSize(document.size)} · {shortDate(document.createdAt)}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DocumentStatusBadge status={document.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {latestRun ? shortDate(latestRun.createdAt) : "–"}
                    </TableCell>
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {latestRun?.hasResult && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void openRunResult(latestRun.id)}
                          >
                            Letztes Ergebnis
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={document.status === "extracting"}
                          onClick={() => reviewDocument(document.id)}
                        >
                          Erneut prüfen
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${document.name} löschen`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeDocument(document.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
