/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { ArrowLeft } from "lucide-react";
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
    <div className="comparison-page">
      <header className="comparison-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Testmodus
        </button>
        <div>
          <span>ANBIETERVERGLEICH</span>
          <strong>{comparison.documentName}</strong>
        </div>
        <small>{shortDate(comparison.createdAt)}</small>
      </header>
      <section className="comparison-summary">
        <span>Gleiche Quelle</span>
        <strong>{comparison.mode}</strong>
        <span>{FORMAT_NAMES[comparison.presentation]}</span>
        <span>{comparison.runs.length} erreichbare Anbieter</span>
      </section>
      <div className="comparison-columns">
        {comparison.runs.map((run) => (
          <article className="comparison-provider" key={run.id}>
            <header>
              <div>
                <strong>{PROVIDER_NAMES[run.provider]}</strong>
                <small>{run.model}</small>
              </div>
              <Status run={run} />
            </header>
            <div className="comparison-provider__stage">
              <span>{run.currentStage ?? "Initialisierung"}</span>
              <b>{run.progress}%</b>
            </div>
            <progress max="100" value={run.progress} />
            {run.error && <p className="comparison-error">{run.error}</p>}
            <footer>
              <button className="button button--quiet" type="button" onClick={() => onRun(run.id)}>
                Worklog
              </button>
              <button
                className="button button--primary"
                type="button"
                disabled={!run.hasResult}
                onClick={() => onResult(run.id)}
              >
                {run.status === "completed" ? "Resultat" : "Text-Ergebnis"}
              </button>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
