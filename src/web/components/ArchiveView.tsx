import { Archive, Trash2 } from "lucide-react";
import type { RunRecord } from "../../shared/types";
import { RunStatus as Status } from "./RunStatus";
import { FORMAT_NAMES, PROVIDER_NAMES, shortDate } from "./ViewShared";

export function ArchiveView({
  runs,
  openRun,
  archiveRun,
  deleteStoppedRun,
}: {
  runs: RunRecord[];
  openRun: (id: string) => void;
  archiveRun: (run: RunRecord, archived: boolean) => Promise<void>;
  deleteStoppedRun: (run: RunRecord) => void;
}) {
  return (
    <div className="archive-page">
      <header className="page-heading">
        <h1>Archiv</h1>
        <p>Abgelegte Läufe öffnen, wiederherstellen oder fehlgeschlagene Läufe löschen.</p>
      </header>
      <div className="archive-list">
        {runs
          .filter((run) => run.archivedAt)
          .map((run) => (
            <div className="archive-row" key={run.id}>
              <div>
                <strong>{run.documentName}</strong>
                <small>
                  {shortDate(run.createdAt)} · {PROVIDER_NAMES[run.provider]} · {run.model}
                </small>
              </div>
              <span>{FORMAT_NAMES[run.presentation]}</span>
              <Status run={run} />
              <button
                className="button button--quiet"
                type="button"
                onClick={() => openRun(run.id)}
              >
                Öffnen
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => void archiveRun(run, false)}
              >
                Wiederherstellen
              </button>
              {["failed", "cancelled"].includes(run.status) && (
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  aria-label="Beendeten Lauf löschen"
                  onClick={() => void deleteStoppedRun(run)}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        {!runs.some((run) => run.archivedAt) && (
          <div className="empty">
            <Archive size={24} />
            <p>Das Archiv ist leer.</p>
          </div>
        )}
      </div>
    </div>
  );
}
