import type { RunRecord } from "../../shared/types";

export function RunStatus({ run }: { run: RunRecord }) {
  if (run.status === "completed") return <span className="status status--done">Fertig</span>;
  if (run.status === "failed") return <span className="status status--error">Fehler</span>;
  if (run.status === "cancelling")
    return <span className="status status--cancelled">Wird abgebrochen …</span>;
  if (run.status === "cancelled")
    return <span className="status status--cancelled">Abgebrochen</span>;
  if (run.status === "waiting_for_input")
    return <span className="status status--wait">Rückfrage</span>;
  return <span className="status">{run.status === "queued" ? "Wartet" : `${run.progress} %`}</span>;
}
