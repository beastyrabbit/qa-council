import { Check, Circle, GitBranch, LoaderCircle, X } from "lucide-react";
import type { RunStageRecord } from "../../shared/types";

type WorkflowPhaseId =
  | "extraction"
  | "evidence"
  | "routing"
  | "role-reviews"
  | "peer-reviews"
  | "joint-review"
  | "debate"
  | "council-rounds"
  | "synthesis"
  | "reports";

const WORKFLOW_PHASES: Array<{
  id: WorkflowPhaseId;
  title: string;
  description: string;
  parallel?: boolean;
}> = [
  {
    id: "extraction",
    title: "Dokument erschließen",
    description: "Originaldatei extrahieren und verlässlich lokalisieren",
  },
  {
    id: "evidence",
    title: "Dokumentweit voranalysieren",
    description: "Chunks zusammenfassen und entfernte Zusammenhänge verknüpfen",
  },
  {
    id: "routing",
    title: "RACI festlegen",
    description: "Betroffene Aktivitäten und Fachrollen bestimmen",
  },
  {
    id: "role-reviews",
    title: "Rollenreviews",
    description: "Ein dokumentweites Review je Rolle",
    parallel: true,
  },
  {
    id: "peer-reviews",
    title: "Cross-Reviews",
    description: "Anonyme Gegenprüfung und Rangfolge",
    parallel: true,
  },
  {
    id: "joint-review",
    title: "Gemeinsamer Stand",
    description: "Befunde zusammenführen, ohne Dissens zu verlieren",
  },
  {
    id: "debate",
    title: "Pro und Contra",
    description: "Ankläger und Verteidiger prüfen nacheinander",
  },
  {
    id: "council-rounds",
    title: "Council-Runden",
    description: "Rollen beraten parallel, danach folgt die Zusammenführung",
    parallel: true,
  },
  {
    id: "synthesis",
    title: "Synthese und Dissens",
    description: "Finale Aussage und unabhängiger Verlustcheck",
  },
  {
    id: "reports",
    title: "Ausgaben bauen",
    description: "Text, Newspaper und One-Paper veröffentlichen",
    parallel: true,
  },
];

export function workflowPhaseForStage(name: string): WorkflowPhaseId | null {
  if (name === "Dokumentextraktion") return "extraction";
  if (name === "Dokumentweite Voranalyse" || name.startsWith("Belegkarte ")) return "evidence";
  if (name.startsWith("QA-Architekt · RACI-Routing")) return "routing";
  if (name.startsWith("Einzelreview · ")) return "role-reviews";
  if (name.startsWith("Cross-Review · ")) return "peer-reviews";
  if (name === "Council · gemeinsames Review") return "joint-review";
  if (name.startsWith("Council-Debatte · ")) return "debate";
  if (name.startsWith("Council-Runde ")) return "council-rounds";
  if (name === "Finale Council-Synthese" || name === "Dissens-Audit") return "synthesis";
  if (name.startsWith("Report-")) return "reports";
  return null;
}

function statusLabel(status: RunStageRecord["status"]) {
  if (status === "running") return "läuft";
  if (status === "completed") return "fertig";
  if (status === "failed") return "fehlgeschlagen";
  return "abgebrochen";
}

function StageStatusIcon({ status }: { status: RunStageRecord["status"] }) {
  if (status === "running") return <LoaderCircle className="spin" aria-hidden="true" />;
  if (status === "completed") return <Check aria-hidden="true" />;
  if (status === "failed") return <X aria-hidden="true" />;
  return <Circle aria-hidden="true" />;
}

function shortStageName(stage: RunStageRecord) {
  const [, detail] = stage.name.split(" · ", 2);
  return detail ?? stage.name;
}

export function RunWorkflowGraph({
  stages,
  roles,
  selectedStageId,
  onSelectStage,
}: {
  stages: RunStageRecord[];
  roles: string[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string | null) => void;
}) {
  const stagesByPhase = new Map<WorkflowPhaseId, RunStageRecord[]>();
  for (const phase of WORKFLOW_PHASES) stagesByPhase.set(phase.id, []);
  for (const stage of stages) {
    const phaseId = workflowPhaseForStage(stage.name);
    if (phaseId) stagesByPhase.get(phaseId)?.push(stage);
  }
  const startedPhaseIndexes = WORKFLOW_PHASES.map((phase, index) =>
    (stagesByPhase.get(phase.id)?.length ?? 0) > 0 ? index : -1,
  ).filter((index) => index >= 0);
  const latestStartedPhase = Math.max(-1, ...startedPhaseIndexes);

  return (
    <section className="workflow-map" aria-labelledby="workflow-map-title">
      <header className="workflow-map__header">
        <div>
          <GitBranch size={18} aria-hidden="true" />
          <div>
            <h2 id="workflow-map-title">Ablaufgrafik</h2>
            <p>Ein Element öffnet unten das zugehörige echte Agentenprotokoll.</p>
          </div>
        </div>
        {selectedStageId && (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onSelectStage(null)}
          >
            Gesamten Log zeigen
          </button>
        )}
      </header>
      <ol className="workflow-map__phases">
        {WORKFLOW_PHASES.map((phase, phaseIndex) => {
          const phaseStages = stagesByPhase.get(phase.id) ?? [];
          const expectedRoles =
            phase.id === "role-reviews" && phaseStages.length === 0 ? roles : [];
          const phaseState = phaseStages.some((stage) => stage.status === "running")
            ? "running"
            : phaseStages.some((stage) => stage.status === "failed")
              ? "failed"
              : phaseStages.length > 0 && phaseStages.every((stage) => stage.status === "completed")
                ? "completed"
                : phaseIndex < latestStartedPhase
                  ? "completed"
                  : "future";

          return (
            <li
              className={`workflow-phase workflow-phase--${phaseState}`}
              key={phase.id}
              data-parallel={phase.parallel ? "true" : undefined}
            >
              <div className="workflow-phase__label">
                <span>{String(phaseIndex + 1).padStart(2, "0")}</span>
                <div>
                  <h3>
                    {phase.title}
                    <small>{phase.parallel ? "parallel" : "sequenziell"}</small>
                  </h3>
                  <p>{phase.description}</p>
                </div>
              </div>
              <div
                className={`workflow-phase__nodes ${
                  phase.parallel ? "workflow-phase__nodes--parallel" : ""
                }`}
              >
                {phaseStages.map((stage) => (
                  <button
                    className={`workflow-node workflow-node--${stage.status}`}
                    type="button"
                    key={stage.id}
                    aria-pressed={selectedStageId === stage.id}
                    onClick={() => onSelectStage(selectedStageId === stage.id ? null : stage.id)}
                  >
                    <StageStatusIcon status={stage.status} />
                    <span>
                      <strong>{shortStageName(stage)}</strong>
                      <small>
                        {stage.role ? `${stage.role} · ` : ""}
                        {statusLabel(stage.status)}
                      </small>
                    </span>
                  </button>
                ))}
                {expectedRoles.map((role) => (
                  <div className="workflow-node workflow-node--queued" key={role}>
                    <Circle aria-hidden="true" />
                    <span>
                      <strong>{role}</strong>
                      <small>wartet auf RACI-Abschluss</small>
                    </span>
                  </div>
                ))}
                {phaseStages.length === 0 && expectedRoles.length === 0 && (
                  <div
                    className={`workflow-node ${
                      phaseState === "completed"
                        ? "workflow-node--completed"
                        : "workflow-node--empty"
                    }`}
                  >
                    {phaseState === "completed" ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Circle aria-hidden="true" />
                    )}
                    <span>
                      <strong>
                        {phaseState === "completed" ? "Abgeschlossen" : "Noch nicht gestartet"}
                      </strong>
                      <small>
                        {phaseState === "completed"
                          ? "ohne eigene Agentenstufe"
                          : "folgt nach der vorherigen Phase"}
                      </small>
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
