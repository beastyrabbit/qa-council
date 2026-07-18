/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { ArrowLeft, ChevronRight, Download, Play } from "lucide-react";
import { useEffect, useState } from "react";
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

  return (
    <div className="document-detail-page">
      <header className="document-detail-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Dokumente
        </button>
        <div>
          <span>DOKUMENT</span>
          <strong>{document?.name ?? "Wird geladen …"}</strong>
        </div>
        <div>
          <a className="button button--quiet" href={`/api/documents/${id}/download`}>
            <Download size={16} /> Original
          </a>
          <button className="button button--primary" type="button" onClick={() => onReview(id)}>
            <Play size={16} /> Erneut prüfen
          </button>
        </div>
      </header>
      {error && <p className="notice notice--error">{error}</p>}
      {document && (
        <main className="document-detail">
          <header>
            <div>
              <h1>{document.name}</h1>
              <p>
                {formatSize(document.size)} · {document.mimeType} · {shortDate(document.createdAt)}
              </p>
            </div>
            <code>{document.sha256}</code>
          </header>
          <section>
            <h2>Extrahierter Inhalt</h2>
            <pre>
              {document.status === "uploaded"
                ? "Gerade hochgeladen. Die Extraktion startet als erster Schritt nach „Go“."
                : document.status === "extracting"
                  ? "Die Extraktion läuft gerade in einem Council-Lauf."
                  : document.extractedText || document.error || "Kein extrahierter Text vorhanden."}
            </pre>
          </section>
          <section>
            <h2>Bisherige Läufe</h2>
            <div className="document-runs">
              {runs.map((run) => (
                <button type="button" key={run.id} onClick={() => onRun(run.id)}>
                  <span>
                    <strong>{FORMAT_NAMES[run.presentation]}</strong>
                    <small>
                      {shortDate(run.createdAt)} · {run.model}
                    </small>
                  </span>
                  <Status run={run} />
                  <ChevronRight size={16} />
                </button>
              ))}
              {runs.length === 0 && <p className="muted">Noch kein Lauf für dieses Dokument.</p>}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
