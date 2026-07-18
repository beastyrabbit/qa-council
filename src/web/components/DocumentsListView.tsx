import { FileText, FolderOpen, Trash2 } from "lucide-react";
import type { DocumentRecord, RunRecord } from "../../shared/types";
import { DOCUMENT_STATUS_NAMES, formatSize, shortDate } from "./ViewShared";

export function DocumentsListView({
  documents,
  latestRunByDocument,
  openDocument,
  reviewDocument,
  removeDocument,
}: {
  documents: DocumentRecord[];
  latestRunByDocument: Map<string, RunRecord>;
  openDocument: (id: string) => void;
  reviewDocument: (id: string) => void;
  removeDocument: (id: string) => Promise<void>;
}) {
  return (
    <div className="documents-page">
      <header className="page-heading">
        <h1>Dokumente</h1>
        <p>Hochgeladene Quellen öffnen, erneut prüfen oder entfernen.</p>
      </header>
      <div className="documents-table">
        {documents.map((document) => {
          const latestRun = latestRunByDocument.get(document.id);
          return (
            <div className="documents-row" key={document.id}>
              <FileText size={19} />
              <div>
                <strong>{document.name}</strong>
                <small>
                  {formatSize(document.size)} · {shortDate(document.createdAt)}
                  {latestRun ? ` · letzter Lauf ${shortDate(latestRun.createdAt)}` : ""}
                </small>
              </div>
              <span className={`file-state file-state--${document.status}`}>
                {DOCUMENT_STATUS_NAMES[document.status]}
              </span>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => openDocument(document.id)}
              >
                Öffnen
              </button>
              <button
                className="button button--primary"
                type="button"
                disabled={document.status === "extracting"}
                onClick={() => reviewDocument(document.id)}
              >
                Erneut prüfen
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={`${document.name} löschen`}
                onClick={() => void removeDocument(document.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        {documents.length === 0 && (
          <div className="empty">
            <FolderOpen size={24} />
            <p>Noch keine Dokumente hochgeladen.</p>
          </div>
        )}
      </div>
    </div>
  );
}
