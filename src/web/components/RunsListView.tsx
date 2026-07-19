import { Archive, Newspaper, Trash2 } from "lucide-react";
import type { RunRecord } from "../../shared/types";
import { RunStatus as Status } from "./RunStatus";
import { FORMAT_NAMES, PROVIDER_NAMES, shortDate } from "./ViewShared";

export function RunsListView({
  runs,
  message,
  archiveAllRuns,
  openRun,
  openRunResult,
  archiveRun,
  deleteStoppedRun,
}: {
  runs: RunRecord[];
  message: string;
  archiveAllRuns: () => Promise<void>;
  openRun: (id: string) => void;
  openRunResult: (id: string) => Promise<void>;
  archiveRun: (run: RunRecord, archived: boolean) => Promise<void>;
  deleteStoppedRun: (run: RunRecord) => void;
}) {
  return (
    <div className="runs-page">
      <header className="page-heading page-heading--actions">
        <div>
          <h1>Läufe</h1>
          <p>Aktive und noch nicht archivierte Prüfungen in zeitlicher Reihenfolge.</p>
        </div>
        <button
          className="button button--quiet"
          type="button"
          disabled={
            !runs.some(
              (run) => !run.archivedAt && ["completed", "failed", "cancelled"].includes(run.status),
            )
          }
          onClick={() => void archiveAllRuns()}
        >
          <Archive size={16} /> Alle abgeschlossenen archivieren
        </button>
      </header>
      {message && <p className="notice">{message}</p>}
      <div className="runs-table">
        <div className="runs-table__head">
          <span>Dokument</span>
          <span>Anbieter / Modell</span>
          <span>Format</span>
          <span>Status</span>
          <span></span>
        </div>
        {runs
          .filter((run) => !run.archivedAt)
          .map((run) => (
            <div className="runs-row" key={run.id}>
              <div>
                <strong>{run.documentName}</strong>
                <small>{shortDate(run.createdAt)}</small>
              </div>
              <div>
                <span>{PROVIDER_NAMES[run.provider]}</span>
                <small>{run.model}</small>
              </div>
              <span>{FORMAT_NAMES[run.presentation]}</span>
              <div>
                <Status run={run} />
                <small>{run.currentStage}</small>
              </div>
              <div className="row-actions">
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => openRun(run.id)}
                >
                  Details
                </button>
                {run.hasResult && (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => void openRunResult(run.id)}
                  >
                    {run.status === "completed" ? "Resultat" : "Text-Ergebnis"}
                  </button>
                )}
                {["completed", "failed", "cancelled"].includes(run.status) && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Lauf archivieren"
                    title="Archivieren"
                    onClick={() => void archiveRun(run, true)}
                  >
                    <Archive size={16} />
                  </button>
                )}
                {["failed", "cancelled"].includes(run.status) && (
                  <button
                    className="icon-button icon-button--danger"
                    type="button"
                    aria-label="Beendeten Lauf löschen"
                    title="Löschen"
                    onClick={() => void deleteStoppedRun(run)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        {runs.filter((run) => !run.archivedAt).length === 0 && (
          <div className="empty">
            <Newspaper size={24} />
            <p>Noch kein Council-Lauf.</p>
          </div>
        )}
      </div>
    </div>
  );
}
